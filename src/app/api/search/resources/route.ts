import { NextResponse } from 'next/server';

import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import {
  NO_STORE_HEADERS,
  readJsonBody,
  resolveApiSites,
} from '@/lib/userSources.server';

export const runtime = 'edge';

// OrionTV 兼容接口
export async function GET() {
  try {
    const apiSites = await getAvailableApiSites();
    const cacheTime = await getCacheTime();

    return NextResponse.json(apiSites, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}

// 合并用户自定义播放源后的可用列表（不缓存）
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const apiSites = await resolveApiSites(body.sources);
    return NextResponse.json(apiSites, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
