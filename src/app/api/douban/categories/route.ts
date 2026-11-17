import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

async function fetchDoubanData(
  url: string
): Promise<DoubanCategoryApiResponse> {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://movie.douban.com',
    },
  };

  try {
    // 尝试直接访问豆瓣API
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const runtime = 'edge';

// 服务端短期缓存：首页热门列表是每次进站都会请求的热点，缓存后同一批数据只有第一个请求
// 真正回源豆瓣，后续请求直接命中内存；豆瓣偶发超时/限流时也能秒开（并可用过期数据兜底）。
const MEMORY_CACHE_TTL = 10 * 60 * 1000;
const MEMORY_CACHE_MAX = 200;
const memoryCache = new Map<string, { data: DoubanResult; expires: number }>();

// 首页列表的缓存时长来自管理配置，读取失败时退回默认值，避免整个接口 500
let cacheTimeMemo = { value: 7200, expires: 0 };
async function getSafeCacheTime(): Promise<number> {
  const now = Date.now();
  if (cacheTimeMemo.expires > now) return cacheTimeMemo.value;
  try {
    const value = await getCacheTime();
    cacheTimeMemo = { value, expires: now + 5 * 60 * 1000 };
    return value;
  } catch {
    return 7200;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 }
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 }
    );
  }

  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;

  const cacheTime = await getSafeCacheTime();
  const cacheHeaders = {
    'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
    'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
  };

  const now = Date.now();
  const hit = memoryCache.get(target);
  if (hit && hit.expires > now) {
    return NextResponse.json(hit.data, { headers: cacheHeaders });
  }

  try {
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData(target);

    // 转换数据格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    if (memoryCache.size >= MEMORY_CACHE_MAX) memoryCache.clear();
    memoryCache.set(target, {
      data: response,
      expires: now + MEMORY_CACHE_TTL,
    });

    return NextResponse.json(response, { headers: cacheHeaders });
  } catch (error) {
    // 回源失败但有旧数据时先用旧数据顶上，避免首页直接空白
    if (hit) {
      return NextResponse.json(hit.data, { headers: cacheHeaders });
    }
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
