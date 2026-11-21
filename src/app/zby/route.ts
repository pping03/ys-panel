import { NextResponse } from 'next/server';

// 直播源聚合：ys.999095.xyz/zby
// 只聚合各上游公开发布的直播订阅地址（指针），不解开、不转换、不合并
// 任何一条具体的流地址，不含任何凭证。App 里「我的 → 直播源管理 →
// TVBox 订阅」粘贴 https://ys.999095.xyz/zby，一次导入全部 30 条。
// 上游文件本身每天/每 6 小时更新；本路由只提供地址，每周重新生成一次。
// 2026-11-21：文件里的 13 条（vbskycn / fanmingming / CCSH / iptv-org /
// Free-TV / YanG）+ 搜索补的 17 条，逐条实测 HTTP 200 且为有效播放列表。
// 剔除：PizazzGY（404）、vbskycn/zbds iptv6（近空，仅剩更新时间戳）、
// develop202 migu（仅剩表头，无频道）。

const REVALIDATE_SECONDS = 7 * 24 * 60 * 60; // 604800

export const revalidate = REVALIDATE_SECONDS;

type Live = { name: string; url: string };

const LIVES: Live[] = [
  // ---- 文件里的（13 条）----
  { name: 'vbskycn IPTV4（高清）', url: 'https://vbskycn.github.io/iptv/tv/iptv4.m3u' },
  { name: 'vbskycn IPTV4（txt）', url: 'https://vbskycn.github.io/iptv/tv/iptv4.txt' },
  { name: 'fanmingming 直播（带回看）', url: 'https://live.fanmingming.com/tv/m3u/index.m3u' },
  { name: 'fanmingming IPv6', url: 'https://live.fanmingming.com/tv/m3u/ipv6.m3u' },
  { name: 'fanmingming ITV', url: 'https://live.fanmingming.com/tv/m3u/itv.m3u' },
  { name: 'fanmingming 演示', url: 'https://live.fanmingming.com/tv/m3u/demo.m3u' },
  { name: 'CCSH 全量（含付费频道）', url: 'https://raw.githubusercontent.com/CCSH/IPTV/master/live.txt' },
  { name: 'iptv-org 全球全量', url: 'https://iptv-org.github.io/iptv/index.m3u' },
  { name: 'iptv-org 中国', url: 'https://iptv-org.github.io/iptv/countries/cn.m3u' },
  { name: 'Free-TV 全球精选', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8' },
  { name: 'Free-TV 中国', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_china.m3u8' },
  { name: 'YanG 聚合（咪咕/特色）', url: 'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u' },
  { name: 'YanG 咪咕', url: 'https://raw.githubusercontent.com/YanG-1989/m3u/main/Migu.m3u' },
  // ---- 搜索补的（17 条）----
  { name: 'lilei6900s 去重版（央视卫视港澳台日韩）', url: 'https://raw.githubusercontent.com/lilei6900s/iptv/main/iptv.m3u' },
  { name: 'lilei6900s 全频道（未去重）', url: 'https://raw.githubusercontent.com/lilei6900s/iptv/main/IPTV-%E5%85%A8%E9%A2%91%E9%81%93-%E5%A4%AE%E8%A7%86%E5%8D%AB%E8%A7%86%E6%B8%AF%E6%BE%B3%E5%8F%B0%E6%97%A5%E9%9F%A9.m3u' },
  { name: 'lilei6900s 备用（jsDelivr）', url: 'https://cdn.jsdelivr.net/gh/lilei6900s/iptv@main/iptv.m3u' },
  { name: 'Guovin 测速优选', url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u' },
  { name: 'Guovin 测速优选 IPv4', url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv4/result.m3u' },
  { name: 'Guovin 测速优选 IPv6', url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/ipv6/result.m3u' },
  { name: 'Guovin 备用（jsDelivr）', url: 'https://cdn.jsdelivr.net/gh/Guovin/iptv-api@gd/output/result.m3u' },
  { name: 'myIPTV IPv4', url: 'https://raw.githubusercontent.com/suxuang/myIPTV/refs/heads/main/ipv4.m3u' },
  { name: 'myIPTV IPv6', url: 'https://raw.githubusercontent.com/suxuang/myIPTV/refs/heads/main/ipv6.m3u' },
  { name: 'BurningC4 央视 IPv4', url: 'https://raw.githubusercontent.com/BurningC4/Chinese-IPTV/master/TV-IPV4.m3u' },
  { name: '直播电视 IPTV4（zbds）', url: 'https://live.zbds.top/tv/iptv4.m3u' },
  { name: '直播电视 IPTV4 txt（zbds）', url: 'https://live.zbds.top/tv/iptv4.txt' },
  { name: '北京联通 IPTV', url: 'https://raw.githubusercontent.com/qwerttvv/Beijing-IPTV/master/IPTV-Unicom.m3u' },
  { name: '北京移动 IPTV', url: 'https://raw.githubusercontent.com/qwerttvv/Beijing-IPTV/master/IPTV-Mobile.m3u' },
  { name: '游魂直播源', url: 'https://www.iyouhun.com/tv/zb' },
  { name: '月光宝盒直播', url: 'https://3043.kstore.space/bhvip/bhzb.txt' },
  { name: 'iptv-org 华语频道', url: 'https://iptv-org.github.io/iptv/languages/zho.m3u' },
];

export async function GET() {
  return NextResponse.json({ lives: LIVES });
}
