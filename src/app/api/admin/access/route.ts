/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { DeviceSessionInfo, UserAccessSummary } from '@/lib/types';

export const runtime = 'edge';

// 返回所有用户的访问统计（使用时长、上线时间、访问IP，最近10条）
// 仅站长和管理员可调用
export async function GET(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存储进行管理员配置' },
        { status: 400 }
      );
    }

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminConfig = await getConfig();
    const username = authInfo.username;

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin' | null = null;
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (userEntry && userEntry.role === 'admin') {
        operatorRole = 'admin';
      }
    }
    if (!operatorRole) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: '存储不可用' }, { status: 500 });
    }

    // 汇总所有用户的访问统计与登录设备
    const users: {
      [key: string]: UserAccessSummary & { devices: DeviceSessionInfo[] };
    } = {};
    await Promise.all(
      adminConfig.UserConfig.Users.map(async (u) => {
        try {
          const [summary, devices] = await Promise.all([
            storage.getUserAccessSummary(u.username),
            storage.getUserDevices(u.username),
          ]);
          users[u.username] = { ...summary, devices };
        } catch (err) {
          console.error(`获取用户 ${u.username} 访问统计失败:`, err);
          users[u.username] = { logs: [], usage_total: 0, devices: [] };
        }
      })
    );

    return NextResponse.json(
      { users },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    console.error('获取访问统计失败:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
