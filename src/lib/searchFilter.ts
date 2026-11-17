/**
 * 搜索结果相关性判断
 *
 * 背景：部分资源站在关键词无命中时不会返回空列表，而是返回整页热门内容
 * （体育赛事、综艺、短剧等），聚合搜索后就会混进大量与关键词无关的条目。
 * 这里用「归一化后包含」+「关键词二元组覆盖率」两级判断做过滤：
 * - 标题包含关键词（或关键词包含标题）直接保留
 * - 否则统计关键词的二元组有多少出现在标题里，达到阈值才保留
 */

const NOISE_PATTERN =
  /[\s\u3000·・:：,，.。!！?？'"“”‘’()（）【】[\]《》〈〉<>｛｝{}~～\-—_/\\|+*&#@^$%`]/g;

/** 归一化文本：小写、去空白与常见标点符号，只留下文字和数字 */
export function normalizeSearchText(input?: string | null): string {
  if (!input) return '';
  return input.toLowerCase().replace(NOISE_PATTERN, '');
}

/** 取二元组（中文没有分词，双字组合足够判断相关性） */
function toBigrams(text: string): string[] {
  if (text.length <= 2) return text ? [text] : [];
  const grams: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    grams.push(text.slice(i, i + 2));
  }
  return grams;
}

/**
 * 判断搜索结果的标题是否与关键词相关
 * @param title 结果标题
 * @param query 搜索关键词
 */
export function isTitleRelevantToQuery(title: string, query: string): boolean {
  const t = normalizeSearchText(title);
  const q = normalizeSearchText(query);
  // 任一方无法判断时放行，避免误删正常结果
  if (!t || !q) return true;
  if (t.includes(q) || q.includes(t)) return true;
  // 一到两个字的关键词只认包含关系，否则太容易误匹配
  if (q.length <= 2) return false;

  const grams = toBigrams(q);
  const hit = grams.filter((gram) => t.includes(gram)).length;
  return hit / grams.length >= 0.4;
}
