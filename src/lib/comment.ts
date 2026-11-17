/**
 * 视频评论的公共逻辑。
 *
 * 评论区的作品标识采用「归一化标题 + 年份」：
 * - 同一部作品在不同采集源（source+id 不同）共享同一个评论区；
 * - 同名但不同年份的作品（翻拍、剧影同名）自动分开。
 * 归一化规则只在服务端/公共库这一处实现，前端不自行拼键，避免规则不一致。
 */

/** 每部作品最多保留的评论条数（超出时淘汰最早的评论） */
export const MAX_COMMENTS_PER_VIDEO = 500;

/** 评论内容最大长度（字符） */
export const COMMENT_MAX_LENGTH = 500;

/** 评论分页默认/最大条数 */
export const COMMENT_PAGE_SIZE = 20;
export const COMMENT_PAGE_SIZE_MAX = 50;

/** 同一用户两次发表评论的最小间隔（毫秒），防止刷屏 */
export const COMMENT_MIN_INTERVAL_MS = 10 * 1000;

/**
 * 归一化作品标识：去首尾空格 + 内部空白折叠 + 英文转小写，再拼上年份。
 * 例：'  流浪地球2 ' + 2023 -> '流浪地球2|2023'；'Friends' + 1994 -> 'friends|1994'
 */
export function buildCommentKey(title: string, year?: string | number): string {
  const normalizedTitle = (title || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const normalizedYear = String(year || '').trim();
  return `${normalizedTitle}|${normalizedYear}`;
}
