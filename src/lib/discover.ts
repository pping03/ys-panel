// 首页「发现」分区定义。
// 所有列表只是豆瓣公开的影视元数据（海报 / 片名 / 评分），不含任何片源；
// 点击条目后走本站自己的搜索，在你自行配置的片源里查找。

export type DiscoverSection =
  | {
      key: string;
      label: string;
      // 豆瓣「近期热门」接口：/api/douban/categories
      mode: 'categories';
      kind: 'tv' | 'movie';
      category: string;
      type: string;
      cardType?: 'movie';
      moreHref?: string;
      // 说明文字：数据口径，或近似替代的说明
      note?: string;
    }
  | {
      key: string;
      label: string;
      // 豆瓣「按标签选片（推荐排序）」接口：/api/douban
      mode: 'list';
      doubanType: 'tv' | 'movie';
      tag: string;
      cardType?: 'movie';
      moreHref?: string;
      note?: string;
    }
  | {
      key: string;
      label: string;
      // 没有可靠的公开榜单：只提供搜索快捷入口，不伪造列表
      mode: 'shortcut';
      keywords: string[];
      note: string;
    };

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  {
    key: 'hot_tv',
    label: '热播剧',
    mode: 'categories',
    kind: 'tv',
    category: 'tv',
    type: 'tv',
    moreHref: '/douban?type=tv',
    note: '豆瓣 · 近期热门剧集',
  },
  {
    key: 'rec_tv',
    label: '推荐剧',
    mode: 'list',
    doubanType: 'tv',
    tag: '热门',
    moreHref: '/douban?type=tv',
    note: '豆瓣 · 选剧「热门」标签按推荐排序（可能混入少量综艺）',
  },
  {
    key: 'movie',
    label: '电影',
    mode: 'categories',
    kind: 'movie',
    category: '热门',
    type: '全部',
    cardType: 'movie',
    moreHref: '/douban?type=movie',
    note: '豆瓣 · 近期热门电影',
  },
  {
    key: 'show',
    label: '综艺',
    mode: 'categories',
    kind: 'tv',
    category: 'show',
    type: 'show',
    moreHref: '/douban?type=show',
    note: '豆瓣 · 近期热门综艺',
  },
  {
    key: 'anime',
    label: '动漫',
    mode: 'categories',
    kind: 'tv',
    category: 'tv',
    type: 'tv_animation',
    moreHref: '/douban?type=tv',
    note: '豆瓣 · 近期热门动画剧集（不含动画电影）',
  },
  {
    key: 'web_drama',
    label: '网剧',
    mode: 'categories',
    kind: 'tv',
    category: 'tv',
    type: 'tv_domestic',
    moreHref: '/douban?type=tv',
    note: '近似：豆瓣没有「网剧」分类，这里显示的是「国产剧」近期热门',
  },
  {
    key: 'ai_short',
    label: 'AI短剧',
    mode: 'shortcut',
    keywords: ['AI短剧', '短剧', '微短剧'],
    note: '豆瓣没有「AI短剧 / 短剧」榜单，这里不提供列表，只提供搜索快捷入口：点关键词会在你自己配置的片源里按片名搜索，有没有结果取决于你的片源。',
  },
];
