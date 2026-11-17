/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApiSite, getAvailableApiSites } from '@/lib/config';
import { sanitizeUserSources } from '@/lib/userSources';

// 仅供本地测试用：默认严格拦截本机 / 内网地址
function allowPrivateSources(): boolean {
  return process.env.YS_ALLOW_PRIVATE_SOURCES === 'true';
}

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

/** 读取 POST body，解析失败返回空对象 */
export async function readJsonBody(
  request: Request
): Promise<Record<string, any>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

/**
 * 合并 config.json 里的播放源与请求带来的用户播放源，key 冲突时用户的优先。
 */
export async function resolveApiSites(rawSources: unknown): Promise<ApiSite[]> {
  const configSites = await getAvailableApiSites();
  const { sources } = sanitizeUserSources(rawSources, {
    allowPrivate: allowPrivateSources(),
  });
  const userSites: ApiSite[] = sources
    .filter((s) => !s.disabled)
    .map((s) => ({ key: s.key, name: s.name, api: s.api, detail: s.detail }));

  const userKeys = new Set(userSites.map((s) => s.key));
  return [...configSites.filter((s) => !userKeys.has(s.key)), ...userSites];
}
