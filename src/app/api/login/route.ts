/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig, getUserDeviceLimit } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import { parseDeviceDescription } from '@/lib/device';

export const runtime = 'edge';

// 从请求头提取客户端真实 IP（支持反向代理/CDN 场景）
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    '未知'
  );
}

// 登记登录会话（超过该用户的设备上限时最早的设备被挤出，其登录cookie随即失效）
async function saveUserSessionSafe(
  username: string,
  loginTime: number,
  deviceId: string,
  ua: string
) {
  try {
    const storage = getStorage();
    if (!storage) return;
    const limit = await getUserDeviceLimit(username);
    await storage.saveUserSession(username, loginTime, deviceId, ua, limit);
  } catch (err) {
    console.error('登记登录会话失败:', err);
  }
}

// 记录一次上线（登录成功时调用）
async function recordUserAccess(username: string, request: NextRequest) {
  try {
    const storage = getStorage();
    if (!storage) return;
    const now = Math.floor(Date.now() / 1000);
    await storage.saveUserAccess(username, {
      login_time: now,
      ip: getClientIp(request),
      last_active: now,
    });
  } catch (err) {
    console.error('记录用户上线信息失败:', err);
  }
}

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | 'upstash'
    | undefined) || 'localstorage';

// localstorage 模式登录会话签名前缀（需与 middleware 保持一致）
const LOCAL_SESSION_PREFIX = 'ys-local-session:';

// 生成签名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 生成签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为十六进制字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  username?: string,
  password?: string,
  role?: 'owner' | 'admin' | 'user',
  includePassword = false,
  timestamp?: number,
  deviceId?: string
): Promise<string> {
  const authData: any = { role: role || 'user' };

  // 只在需要时包含 password
  if (includePassword && password) {
    authData.password = password;
  }

  if (username && process.env.PASSWORD) {
    authData.username = username;
    // 使用密码作为密钥对用户名进行签名
    const signature = await generateSignature(username, process.env.PASSWORD);
    authData.signature = signature;
    authData.timestamp = timestamp || Date.now(); // 添加时间戳防重放攻击（同时作为登录会话标识）
    if (deviceId) {
      authData.device_id = deviceId; // 登录设备标识（用于设备数量限制）
    }
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    // 本地 / localStorage 模式——仅校验固定密码
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未配置 PASSWORD 时直接放行
      if (!envPassword) {
        const response = NextResponse.json({ ok: true });

        // 清除可能存在的认证cookie
        response.cookies.set('auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax', // 改为 lax 以支持 PWA
          httpOnly: false, // PWA 需要客户端可访问
          secure: false, // 根据协议自动设置
        });

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      // localstorage 模式：cookie 里不再存放明文密码，
      // 改为存放「登录时间戳 + 用 PASSWORD 做密钥的 HMAC 签名」，由 middleware 验签
      const loginTimestamp = Date.now();
      const sessionSignature = await generateSignature(
        `${LOCAL_SESSION_PREFIX}${loginTimestamp}`,
        envPassword
      );
      const cookieValue = encodeURIComponent(
        JSON.stringify({
          role: 'user',
          signature: sessionSignature,
          timestamp: loginTimestamp,
        })
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure:
          req.headers.get('x-forwarded-proto') === 'https' ||
          req.nextUrl.protocol === 'https:', // https 下仅通过加密连接发送
      });

      return response;
    }

    // 数据库 / redis 模式——校验用户名并尝试连接数据库
    const body = await req.json();
    const { username, password } = body;
    // 设备标识：客户端（登录页）持久保存的 deviceId；缺失时服务端兜底生成，保证 cookie 始终携带设备标识
    const deviceId: string = body.deviceId || crypto.randomUUID();
    const deviceDesc = parseDeviceDescription(req.headers.get('user-agent'));
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }
    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      // 验证成功，设置认证cookie（时间戳同时作为会话标识登记，保证设备数量限制生效）
      const loginTime = Date.now();
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        username,
        password,
        'owner',
        false,
        loginTime,
        deviceId
      ); // 数据库模式不包含 password
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure: false, // 根据协议自动设置
      });

      // 登记登录会话（超过设备上限时最早的设备cookie失效）并记录上线信息
      await saveUserSessionSafe(username, loginTime, deviceId, deviceDesc);
      await recordUserAccess(username, req);

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    // 校验用户密码
    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      // 验证成功，设置认证cookie（时间戳同时作为会话标识登记，保证设备数量限制生效）
      const loginTime = Date.now();
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        username,
        password,
        user?.role || 'user',
        false,
        loginTime,
        deviceId
      ); // 数据库模式不包含 password
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure: false, // 根据协议自动设置
      });

      // 登记登录会话（超过设备上限时最早的设备cookie失效）并记录上线信息
      await saveUserSessionSafe(username, loginTime, deviceId, deviceDesc);
      await recordUserAccess(username, req);

      return response;
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
