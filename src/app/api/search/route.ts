import { NextResponse } from 'next/server';

import { ApiSite, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApiDetailed } from '@/lib/downstream';
import { isTitleRelevantToQuery } from '@/lib/searchFilter';
import {
  failureResult,
  SourceProbeResult,
  SourceSearchStatus,
} from '@/lib/sourceProbe';
import { SearchResult } from '@/lib/types';
import {
  NO_STORE_HEADERS,
  readJsonBody,
  resolveApiSites,
} from '@/lib/userSources.server';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

interface SiteSearchOutcome {
  site: ApiSite;
  items: SearchResult[];
  latencyMs: number;
  probe: SourceProbeResult;
}

async function searchSiteWithTimeout(
  site: ApiSite,
  query: string
): Promise<SiteSearchOutcome> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timeout')), 4500);
  });
  try {
    const { results, probe } = await Promise.race([
      searchFromApiDetailed(site, query),
      timeoutPromise,
    ]);
    return {
      site,
      items: results || [],
      latencyMs: probe.ok ? Date.now() - start : Infinity,
      probe,
    };
  } catch {
    return {
      site,
      items: [],
      latencyMs: Infinity,
      probe: failureResult('timeout'),
    };
  } finally {
    if (timer) clearTimeout(timer);
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
    const outcomes = await Promise.all(
      apiSites.map((site) => searchSiteWithTimeout(site, query))
    );

    // 每个播放源本次请求的状态：区分「接口不可用」与「接口正常但没搜到」
    const sourceStatus: SourceSearchStatus[] = outcomes.map((o) => {
      const entry: SourceSearchStatus = {
        key: o.site.key,
        name: o.site.name,
        ok: o.probe.ok,
        count: o.items.length,
        status: o.probe.status,
      };
      if (!o.probe.ok) entry.error = o.probe.message;
      return entry;
    });
    const allFailed =
      sourceStatus.length > 0 && sourceStatus.every((s) => !s.ok);

    const successfulResults = outcomes
      .filter((o) => o.items.length > 0)
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

    // 播放源全部失败时不缓存，免得恢复后还读到旧的空结果
    return NextResponse.json(
      { results: flattenedResults, sourceStatus },
      { headers: allFailed ? NO_STORE_HEADERS : headers }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const headers = cacheHeaders(await getCacheTime());

  if (!query) {
    return NextResponse.json({ results: [], sourceStatus: [] }, { headers });
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
    return NextResponse.json(
      { results: [], sourceStatus: [] },
      { headers: NO_STORE_HEADERS }
    );
  }

  const apiSites = await resolveApiSites(body.sources);
  return runSearch(query, apiSites, NO_STORE_HEADERS);
}
