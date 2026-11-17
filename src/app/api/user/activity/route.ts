/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

// 用户活跃心跳：由前端定时调用，用于累计使用时长并刷新最近活跃时间
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username || !authInfo.signature) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      // 本地存储模式无管理员/统计功能
      return NextResponse.json({ ok: true });
    }

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ ok: true });
    }

    await storage.updateUserActivity(
      authInfo.username,
      Math.floor(Date.now() / 1000)
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('记录用户活跃状态失败:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
