/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getUserDeviceLimit } from '@/lib/config';
import { getStorage } from '@/lib/db';

// 需要读取管理配置（Docker 部署下配置来自 config.json，用到 node 的 fs），
// edge 运行时下 getConfig 会抛错，导致设备上限恒被当成「不限制」。
export const runtime = 'nodejs';

// 登录设备会话校验（供 middleware 内部调用）
// 设备上限按用户在管理后台的单独配置（device_limit，0 = 不限制）
// 返回该次登录的会话是否仍然有效（未被更新的设备挤出、未超过7天）
export async function GET(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      // 本地存储模式无设备限制
      return NextResponse.json({ valid: true });
    }

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('u');
    const timestamp = Number(searchParams.get('t'));
    const deviceId = searchParams.get('d') || undefined;

    if (!username || !Number.isFinite(timestamp) || timestamp <= 0) {
      return NextResponse.json({ valid: false });
    }

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ valid: true });
    }

    const limit = await getUserDeviceLimit(username);
    const valid = await storage.hasUserSession(
      username,
      timestamp,
      deviceId,
      limit
    );
    return NextResponse.json(
      { valid },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    console.error('会话校验失败:', err);
    // 校验服务异常时放行，避免存储故障导致全员无法访问
    return NextResponse.json({ valid: true });
  }
}
