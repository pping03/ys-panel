import { NextResponse } from 'next/server';

import { ApiSite, getAvailableApiSites, getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import {
  NO_STORE_HEADERS,
  readJsonBody,
  resolveApiSites,
} from '@/lib/userSources.server';

export const runtime = 'edge';

async function runDetail(
  id: string | null,
  sourceCode: string | null,
  loadSites: () => Promise<ApiSite[]>,
  loadHeaders: () => Promise<Record<string, string>>
) {
  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
  }

  try {
    const apiSites = await loadSites();
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    const result = await getDetailFromApi(apiSite, id);
    return NextResponse.json(result, { headers: await loadHeaders() });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return runDetail(
    searchParams.get('id'),
    searchParams.get('source'),
    getAvailableApiSites,
    async () => {
      const cacheTime = await getCacheTime();
      return {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      };
    }
  );
}

// 带用户自定义播放源的详情：播放源随 body 传入，结果不缓存
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return runDetail(
    typeof body.id === 'string' ? body.id : null,
    typeof body.source === 'string' ? body.source : null,
    () => resolveApiSites(body.sources),
    async () => NO_STORE_HEADERS
  );
}
