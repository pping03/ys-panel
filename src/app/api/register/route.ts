/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getConfig, getUserDeviceLimit } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import { parseDeviceDescription } from '@/lib/device';

export const runtime = 'edge';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'd1'
    | 'upstash'
    | undefined) || 'localstorage';

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
  username: string,
  timestamp?: number,
  deviceId?: string
): Promise<string> {
  const authData: any = {
    role: 'user',
    username,
    timestamp: timestamp || Date.now(),
  };

  // 使用process.env.PASSWORD作为签名密钥，而不是用户密码
  const signingKey = process.env.PASSWORD || '';
  const signature = await generateSignature(username, signingKey);
  authData.signature = signature;
  if (deviceId) {
    authData.device_id = deviceId; // 登录设备标识（用于设备数量限制）
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    // localstorage 模式下不支持注册
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    // 校验是否开放注册
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

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

    // 检查是否和管理员重复
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      // 检查用户是否已存在
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      await db.registerUser(username, password);

      // 添加到配置中并保存
      config.UserConfig.Users.push({
        username,
        role: 'user',
      });
      await db.saveAdminConfig(config);

      // 注册成功，设置认证cookie（时间戳同时作为会话标识登记，保证设备数量限制生效）
      const loginTime = Date.now();
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        username,
        loginTime,
        deviceId
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改为 lax 以支持 PWA
        httpOnly: false, // PWA 需要客户端可访问
        secure: false, // 根据协议自动设置
      });

      // 登记登录会话（超过该用户的设备上限时最早的设备cookie失效）
      try {
        const storage = getStorage();
        if (storage) {
          const limit = await getUserDeviceLimit(username);
          await storage.saveUserSession(
            username,
            loginTime,
            deviceId,
            deviceDesc,
            limit
          );
        }
      } catch (err) {
        console.error('登记登录会话失败:', err);
      }

      return response;
    } catch (err) {
      console.error('数据库注册失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
