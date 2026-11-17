/* eslint-disable @typescript-eslint/no-explicit-any */

// 用户自定义播放源：保存在浏览器 localStorage，请求时随 POST body 发给服务端。
// 本文件不依赖任何服务端模块，浏览器与 edge 运行时均可引用。

export interface UserSource {
  key: string;
  name: string;
  api: string;
  detail?: string;
  disabled?: boolean;
}

export const USER_SOURCES_STORAGE_KEY = 'ys_user_sources';
export const USER_SOURCES_EVENT = 'ysUserSourcesUpdated';

export const MAX_USER_SOURCES = 50;
export const MAX_SOURCE_NAME_LEN = 40;
export const MAX_SOURCE_URL_LEN = 300;
export const MAX_SOURCE_KEY_LEN = 40;

const KEY_PATTERN = /^[\w-]+$/;

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * 基础 SSRF 防护：拦截回环、内网、链路本地等主机名。
 * 只做主机名层面的判断，不做 DNS 解析（edge 运行时无法解析）。
 */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return true;

  if (host.includes(':')) {
    // IPv6 字面量：只放行全球单播 2000::/3，且排除 6to4 / NAT64 等可内嵌 IPv4 的前缀
    if (!/^[23][0-9a-f]{3}:/.test(host)) return true;
    if (host.startsWith('2002:') || host.startsWith('2001:0:')) return true;
    return false;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isPrivateIPv4(host);
  }

  if (!host.includes('.')) return true; // 单标签主机名（localhost、内网机器名）
  const blockedSuffixes = [
    '.localhost',
    '.local',
    '.internal',
    '.lan',
    '.home',
    '.corp',
    '.intranet',
    '.home.arpa',
  ];
  return blockedSuffixes.some((suffix) => host.endsWith(suffix));
}

/**
 * 校验播放源地址。合法返回 null，否则返回中文错误说明。
 */
export function validateSourceUrl(
  raw: string,
  allowPrivate = false
): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return '地址不能为空';
  const value = raw.trim();
  if (value.length > MAX_SOURCE_URL_LEN) {
    return `地址过长（最多 ${MAX_SOURCE_URL_LEN} 个字符）`;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '地址格式不正确';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '地址只支持 http 或 https';
  }
  if (url.username || url.password) return '地址不能包含账号密码';
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    return '不允许使用本机或内网地址';
  }
  return null;
}

export function generateSourceKey(): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `u${Date.now().toString(36)}${rand}`;
}

function normalizeKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const key = raw
    .trim()
    .replace(/[^\w-]/g, '_')
    .slice(0, MAX_SOURCE_KEY_LEN);
  return KEY_PATTERN.test(key) ? key : '';
}

export interface SanitizeResult {
  sources: UserSource[];
  errors: string[];
}

/**
 * 清洗并校验一组播放源。浏览器保存前、服务端收到请求后都会调用。
 */
export function sanitizeUserSources(
  input: unknown,
  options: { allowPrivate?: boolean } = {}
): SanitizeResult {
  const errors: string[] = [];
  const sources: UserSource[] = [];
  if (!Array.isArray(input)) return { sources, errors };

  const seen = new Set<string>();
  for (const item of input as any[]) {
    if (sources.length >= MAX_USER_SOURCES) {
      errors.push(`最多 ${MAX_USER_SOURCES} 个播放源，多出的已忽略`);
      break;
    }
    if (!item || typeof item !== 'object') continue;

    const name =
      typeof item.name === 'string'
        ? item.name.trim().slice(0, MAX_SOURCE_NAME_LEN)
        : '';
    const api = typeof item.api === 'string' ? item.api.trim() : '';
    const detail = typeof item.detail === 'string' ? item.detail.trim() : '';
    const label = name || api || '未命名';

    if (!name) {
      errors.push(`「${label}」缺少名称`);
      continue;
    }
    const apiError = validateSourceUrl(api, options.allowPrivate);
    if (apiError) {
      errors.push(`「${label}」接口${apiError}`);
      continue;
    }
    if (detail) {
      const detailError = validateSourceUrl(detail, options.allowPrivate);
      if (detailError) {
        errors.push(`「${label}」详情${detailError}`);
        continue;
      }
    }

    let key = normalizeKey(item.key) || generateSourceKey();
    while (seen.has(key)) key = generateSourceKey();
    seen.add(key);

    const source: UserSource = { key, name, api };
    if (detail) source.detail = detail;
    if (item.disabled === true) source.disabled = true;
    sources.push(source);
  }
  return { sources, errors };
}

/** 转成 config.json 的 api_site 形状，用于导出 */
export function toApiSiteMap(sources: UserSource[]): Record<string, any> {
  const map: Record<string, any> = {};
  sources.forEach((s) => {
    const entry: Record<string, any> = { api: s.api, name: s.name };
    if (s.detail) entry.detail = s.detail;
    if (s.disabled) entry.disabled = true;
    map[s.key] = entry;
  });
  return map;
}

/** 解析导入文本：接受 api_site 形状，或带 api_site 字段的完整 config.json */
export function parseApiSiteJson(text: string): any[] {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON 需要是一个对象');
  }
  if (Array.isArray(parsed)) return parsed;
  const map =
    parsed.api_site && typeof parsed.api_site === 'object'
      ? parsed.api_site
      : parsed;
  return Object.keys(map)
    .filter((key) => map[key] && typeof map[key] === 'object')
    .map((key) => ({ ...map[key], key }));
}

// ---------------- 浏览器端 ----------------

export function loadUserSources(): UserSource[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_SOURCES_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeUserSources(JSON.parse(raw)).sources;
  } catch {
    return [];
  }
}

export function saveUserSources(sources: UserSource[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_SOURCES_STORAGE_KEY, JSON.stringify(sources));
  window.dispatchEvent(new CustomEvent(USER_SOURCES_EVENT));
}

export function getEnabledUserSources(): UserSource[] {
  return loadUserSources()
    .filter((s) => !s.disabled)
    .map(({ key, name, api, detail }) =>
      detail ? { key, name, api, detail } : { key, name, api }
    );
}

/**
 * 请求搜索 / 详情接口：有自定义播放源时走 POST 并带上播放源（不经任何缓存），
 * 没有时保持原来的 GET。
 */
export function fetchWithUserSources(
  path: '/api/search' | '/api/detail',
  params: Record<string, string>
): Promise<Response> {
  const sources = getEnabledUserSources();
  if (sources.length === 0) {
    return fetch(`${path}?${new URLSearchParams(params).toString()}`);
  }
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ ...params, sources }),
  });
}
