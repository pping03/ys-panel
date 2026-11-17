import { NextResponse } from 'next/server';

import { ApiSite, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { isTitleRelevantToQuery } from '@/lib/searchFilter';
import { SearchResult } from '@/lib/types';
import {
  NO_STORE_HEADERS,
  readJsonBody,
  resolveApiSites,
} from '@/lib/userSources.server';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

async function searchSiteWithTimeout(
  site: ApiSite,
  query: string
): Promise<{ items: SearchResult[]; latencyMs: number }> {
  const start = Date.now();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), 4500)
  );
  try {
    const items = await Promise.race([
      searchFromApi(site, query),
      timeoutPromise,
    ]);
    return { items: items || [], latencyMs: Date.now() - start };
  } catch {
    return { items: [], latencyMs: Infinity };
  }
}

function cacheHeaders(cacheTime: number) {
  return {
    'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
  };
}

async function runSearch(
  query: string,
  apiSites: ApiSite[],
  headers: Record<string, string>
) {
  const config = await getConfig();

  try {
    const settledResults = await Promise.allSettled(
      apiSites.map((site) => searchSiteWithTimeout(site, query))
    );

    const successfulResults = settledResults
      .filter(
        (
          res
        ): res is PromiseFulfilledResult<{
          items: SearchResult[];
          latencyMs: number;
        }> => res.status === 'fulfilled' && res.value.items.length > 0
      )
      .map((res) => res.value)
      .sort((a, b) => a.latencyMs - b.latencyMs);

    let flattenedResults = successfulResults.flatMap((res) => res.items);

    // 过滤与关键词无关的条目：部分站点无命中时会返回整页热门内容
    flattenedResults = flattenedResults.filter((result) =>
      isTitleRelevantToQuery(result.title, query)
    );

    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    return NextResponse.json({ results: flattenedResults }, { headers });
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const headers = cacheHeaders(await getCacheTime());

  if (!query) {
    return NextResponse.json({ results: [] }, { headers });
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);
  return runSearch(query, apiSites, headers);
}

// 带用户自定义播放源的搜索：播放源随 body 传入，结果不缓存
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const query = typeof body.q === 'string' ? body.q.trim() : '';

  if (!query) {
    return NextResponse.json({ results: [] }, { headers: NO_STORE_HEADERS });
  }

  const apiSites = await resolveApiSites(body.sources);
  return runSearch(query, apiSites, NO_STORE_HEADERS);
}
