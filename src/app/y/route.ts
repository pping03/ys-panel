import { NextResponse } from 'next/server';

// TVBox 多仓订阅聚合：ys.999095.xyz/y
// 只聚合各上游公开发布的订阅地址（指针），不解开、不转换任何一条具体的
// 采集站接口、解析线路或 spider，不含任何凭证。
// 上游文件每周重新拉取一次（revalidate 7 天），各上游内容本身每天更新。

const REVALIDATE_SECONDS = 7 * 24 * 60 * 60; // 604800

export const revalidate = REVALIDATE_SECONDS;

// 每天自动更新的多仓订阅文件（上游）
const UPSTREAMS = [
  // Lightconer/tvbox-ysc-config：多仓订阅（9 个，饭太硬上次更新失败未收录）
  'https://raw.githubusercontent.com/Lightconer/tvbox-ysc-config/main/output/%E5%A4%9A%E4%BB%93%E8%AE%A2%E9%98%85.json',
  // jifeng250/tvbox-sources：多仓 urls
  'https://raw.githubusercontent.com/jifeng250/tvbox-sources/main/urls.json',
  // hengge345666/tvbox-subs：订阅索引（8 条，含自有镜像仓；每周探测维护）
  'https://raw.githubusercontent.com/hengge345666/tvbox-subs/main/subs.json',
];

// 固定单条订阅（本身就是订阅地址，不随上游文件变化）
const EXTRA: { name: string; url: string }[] = [
  {
    name: 'hebijunge推荐订阅',
    url: 'https://raw.githubusercontent.com/hebijunge/tvbox-config/main/tvbox_recommended.json',
  },
  {
    name: 'Lightconer直播',
    url: 'https://raw.githubusercontent.com/Lightconer/TVBox-Sources/main/output/tvbox.json',
  },
  {
    // jifeng250 精选仓（62 站，人工精选；不在其 urls.json 里）
    name: 'jifeng250精选仓',
    url: 'https://raw.githubusercontent.com/jifeng250/tvbox-sources/main/curated.json',
  },
  // 2026-11-20 第二批：最近更新、响应快、带 4K/高清站（均已实测可拉取、格式有效）
  {
    // hanyurn/tvbox-config：每日聚合，98 站，实测 0.46s
    name: 'hanyurn聚合',
    url: 'https://raw.githubusercontent.com/hanyurn/tvbox-config/main/agg_true.json',
  },
  {
    // easytv：135 站，其中 45 个站名带 4K/蓝光/1080/超清/原画，实测 1.57s
    name: 'easytv-4K蓝光',
    url: 'https://15318.kstore.space/easytv.jpg',
  },
  {
    // 二月红：31 站，其中 10 个 4K/高清站，实测 1.86s
    name: '二月红',
    url: 'https://700sjro44343.vicp.fun/eggp/0211/tv.json',
  },
  {
    // cluntop/tvbox 主仓：101 站，实测 0.71s（文件带 // 注释头，TVBox 可认）
    name: 'cluntop主仓',
    url: 'https://raw.githubusercontent.com/cluntop/tvbox/main/box.json',
  },
  {
    // 安忆：187 站，其中 18 个 4K/高清站，实测 2.14s（文件带 // 注释头，TVBox 可认）
    name: '安忆',
    url: 'https://cnb.cool/ayrjk/tvbox/-/git/raw/main/api.json',
  },
];

type Entry = { name: string; url: string };

async function fetchEntries(src: string): Promise<Entry[]> {
  try {
    const res = await fetch(src, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const urls = (data as { urls?: unknown })?.urls;
    if (!Array.isArray(urls)) return [];
    return urls.filter(
      (u): u is Entry =>
        !!u &&
        typeof u === 'object' &&
        typeof (u as Entry).name === 'string' &&
        typeof (u as Entry).url === 'string',
    );
  } catch {
    return [];
  }
}

export async function GET() {
  const lists = await Promise.all(UPSTREAMS.map(fetchEntries));
  const merged: Entry[] = [];
  const seen = new Set<string>();
  for (const list of [...lists, EXTRA]) {
    for (const entry of list) {
      // 上游自己标记失效的条目不同步；同一地址只保留一次
      if (entry.name.startsWith('❌') || seen.has(entry.url)) continue;
      seen.add(entry.url);
      merged.push(entry);
    }
  }
  if (merged.length === 0) {
    return NextResponse.json({ error: 'upstream unavailable' }, { status: 503 });
  }
  return NextResponse.json({ urls: merged });
}
