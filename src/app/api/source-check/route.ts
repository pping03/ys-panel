import { NextResponse } from 'next/server';

import { API_CONFIG } from '@/lib/config';
import {
  classifyBody,
  failureResult,
  SourceProbeResult,
} from '@/lib/sourceProbe';
import { validateSourceUrl } from '@/lib/userSources';
import {
  allowPrivateSources,
  NO_STORE_HEADERS,
  readJsonBody,
} from '@/lib/userSources.server';

export const runtime = 'edge';

const PROBE_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readBodyCapped(response: Response): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  if (total >= MAX_BODY_BYTES) {
    try {
      await reader.cancel();
    } catch {
      // 读取已够用，取消失败可以忽略
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

async function probeSource(api: string): Promise<SourceProbeResult> {
  const allowPrivate = allowPrivateSources();
  if (validateSourceUrl(api, allowPrivate)) {
    return failureResult('invalid_url');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // 与搜索接口同样的请求形状：<api>?ac=videolist&wd=<关键词>
    let target = api + API_CONFIG.search.path;
    let response: Response | null = null;

    // 手动跟随跳转，每一跳都重新做地址校验，避免被跳转带到内网
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(target, {
        headers: API_CONFIG.search.headers,
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, target).toString();
      if (validateSourceUrl(next, allowPrivate)) {
        return failureResult('unreachable');
      }
      target = next;
      response = null;
    }

    if (!response) return failureResult('unreachable');
    if (!response.ok) {
      return failureResult('http_error', { httpStatus: response.status });
    }
    return classifyBody(await readBodyCapped(response));
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return failureResult(aborted ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// 测试一个播放源接口是否可用（位于密码门之后，结果不缓存）
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const api = typeof body.api === 'string' ? body.api.trim() : '';

  const urlError = validateSourceUrl(api, allowPrivateSources());
  if (urlError) {
    const result = failureResult('invalid_url');
    result.message = `接口${urlError}`;
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  }

  const result = await probeSource(api);
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}
