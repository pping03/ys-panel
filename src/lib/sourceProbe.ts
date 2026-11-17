/* eslint-disable @typescript-eslint/no-explicit-any */

// 播放源可用性判断。不依赖服务端模块，浏览器与 edge 运行时均可引用。

export type SourceProbeStatus =
  | 'ok'
  | 'tvbox_subscription'
  | 'not_json'
  | 'bad_shape'
  | 'http_error'
  | 'timeout'
  | 'unreachable'
  | 'invalid_url';

export interface SourceProbeResult {
  status: SourceProbeStatus;
  ok: boolean;
  /** 给用户看的中文说明 */
  message: string;
  /** status 为 ok 时：接口这一页返回的条目数 */
  count?: number;
  /** status 为 http_error 时：HTTP 状态码 */
  httpStatus?: number;
}

/** 搜索时每个播放源的结果，随 /api/search 的响应返回 */
export interface SourceSearchStatus {
  key: string;
  name: string;
  ok: boolean;
  count: number;
  status: SourceProbeStatus;
  error?: string;
}

export const TVBOX_MESSAGE =
  '这是 TVBox 订阅地址，不是苹果CMS接口，网页端无法使用';

export function probeMessage(
  status: SourceProbeStatus,
  extra: { count?: number; httpStatus?: number } = {}
): string {
  switch (status) {
    case 'ok':
      return typeof extra.count === 'number'
        ? `可用（接口返回 ${extra.count} 条）`
        : '可用';
    case 'tvbox_subscription':
      return TVBOX_MESSAGE;
    case 'not_json':
      return '接口返回的不是 JSON（可能是网页或 XML 接口），无法使用';
    case 'bad_shape':
      return '接口返回的 JSON 里没有 list 字段，不是苹果CMS V10 接口';
    case 'http_error':
      return `接口返回 HTTP ${extra.httpStatus ?? '错误'}`;
    case 'timeout':
      return '连接超时';
    case 'unreachable':
      return '连接失败';
    case 'invalid_url':
      return '地址不合法';
  }
}

/**
 * 判断一段已解析的 JSON 是不是 TVBox 的订阅 / 配置：
 * 多仓 {urls:[...]}、仓库索引 {storeHouse:[...]}、单仓配置 {sites:[...], spider}。
 */
export function isTvboxShape(parsed: any): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  if (Array.isArray(parsed.urls) || Array.isArray(parsed.storeHouse)) {
    return true;
  }
  if (Array.isArray(parsed.sites)) {
    if (typeof parsed.spider === 'string') return true;
    if (Array.isArray(parsed.parses) || Array.isArray(parsed.lives)) {
      return true;
    }
    // 没有 spider 字段的精简配置：sites 里的条目带 TVBox 特有的 type + api
    return parsed.sites.some(
      (s: any) =>
        s &&
        typeof s === 'object' &&
        typeof s.type === 'number' &&
        typeof s.api === 'string'
    );
  }
  return false;
}

/** 接口地址本身看起来像订阅文件（.json / raw 文件）时的提示，不发请求 */
export function looksLikeSubscriptionUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return /\.(json|txt|m3u8?|jar)$/i.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

function parseLoose(text: string): { parsed: any } | null {
  const body = (text || '').replace(/^\uFEFF/, '').trim();
  try {
    return { parsed: JSON.parse(body) };
  } catch {
    // TVBox 配置里常见整行 // 注释，去掉后再试一次
  }
  const stripped = body
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
    .trim();
  if (stripped === body) return null;
  try {
    return { parsed: JSON.parse(stripped) };
  } catch {
    return null;
  }
}

/**
 * 根据接口返回的正文分类，并带回解析后的数据。
 * 只负责正文，HTTP 状态与网络错误由调用方处理。
 */
export function classifyBodyWithData(text: string): {
  probe: SourceProbeResult;
  data: any;
} {
  const loose = parseLoose(text);
  if (!loose) {
    return {
      probe: {
        status: 'not_json',
        ok: false,
        message: probeMessage('not_json'),
      },
      data: null,
    };
  }
  const parsed = loose.parsed;

  if (isTvboxShape(parsed)) {
    return {
      probe: {
        status: 'tvbox_subscription',
        ok: false,
        message: probeMessage('tvbox_subscription'),
      },
      data: null,
    };
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray(parsed.list)
  ) {
    const count = parsed.list.length;
    return {
      probe: {
        status: 'ok',
        ok: true,
        count,
        message: probeMessage('ok', { count }),
      },
      data: parsed,
    };
  }

  return {
    probe: {
      status: 'bad_shape',
      ok: false,
      message: probeMessage('bad_shape'),
    },
    data: null,
  };
}

export function classifyBody(text: string): SourceProbeResult {
  return classifyBodyWithData(text).probe;
}

/** 尝试把一段文本当 JSON 解析（容忍 BOM 与整行注释），失败返回 undefined */
export function parseJsonLoose(text: string): any {
  const loose = parseLoose(text);
  return loose ? loose.parsed : undefined;
}

export function failureResult(
  status: Exclude<SourceProbeStatus, 'ok'>,
  extra: { httpStatus?: number } = {}
): SourceProbeResult {
  const result: SourceProbeResult = {
    status,
    ok: false,
    message: probeMessage(status, extra),
  };
  if (typeof extra.httpStatus === 'number') {
    result.httpStatus = extra.httpStatus;
  }
  return result;
}
