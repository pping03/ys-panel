import { NextResponse } from 'next/server';

import { ApiSite, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  NO_STORE_HEADERS,
  readJsonBody,
  resolveApiSites,
} from '@/lib/userSources.server';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

function cacheHeaders(cacheTime: number) {
  return {
    'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
  };
}

async function runSearchOne(
  query: string | null,
  resourceId: string | null,
  loadSites: () => Promise<ApiSite[]>,
  headers: Record<string, string>
) {
  if (!query || !resourceId) {
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
      { headers }
    );
  }

  const config = await getConfig();

  try {
    // 根据 resourceId 查找对应的 API 站点
    const apiSites = await loadSites();
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 }
      );
    }

    const results = await searchFromApi(targetSite, query);
    let result = results.filter((r) => r.title === query);
    if (!config.SiteConfig.DisableYellowFilter) {
      result = result.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ results: result }, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 }
    );
  }
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const config = await getConfig();
  return runSearchOne(
    searchParams.get('q'),
    searchParams.get('resourceId'),
    async () => config.SourceConfig.filter((site) => !site.disabled),
    cacheHeaders(await getCacheTime())
  );
}

// 带用户自定义播放源的单源搜索（不缓存）
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return runSearchOne(
    typeof body.q === 'string' ? body.q : null,
    typeof body.resourceId === 'string' ? body.resourceId : null,
    () => resolveApiSites(body.sources),
    NO_STORE_HEADERS
  );
}
