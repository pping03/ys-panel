import { SearchResult } from '@/lib/types';

export async function probeM3u8Latency(
  url: string,
  timeoutMs = 3000
): Promise<number> {
  if (!url) return Infinity;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    // 使用 no-cors 模式探测，与 getVideoResolutionFromM3u8 的跨域策略保持一致，
    // 避免因缺少 CORS 头导致把可播放的源误判为失效。
    // opaque 响应无法读取状态码，只要请求在时限内得到响应即视为源存活。
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return performance.now() - start;
  } catch {
    // 超时（abort）、DNS 失败、网络不可达等均视为源失效
    return Infinity;
  } finally {
    clearTimeout(timer);
  }
}

export async function rankSourcesByLatency(
  sources: SearchResult[],
  timeoutMs = 3000
): Promise<(SearchResult & { latency: number })[]> {
  const results = await Promise.all(
    sources.map(async (source) => {
      const sourceWithUrl = source as SearchResult & { url?: string };
      const url =
        sourceWithUrl.url ||
        (source.episodes && source.episodes.length > 0
          ? source.episodes[0]
          : '');
      const latency = url ? await probeM3u8Latency(url, timeoutMs) : Infinity;
      return {
        ...source,
        latency,
      };
    })
  );

  return results.sort((a, b) => a.latency - b.latency);
}
