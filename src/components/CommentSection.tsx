'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { COMMENT_MAX_LENGTH } from '@/lib/comment';
import {
  fetchVideoComments,
  postVideoComment,
  removeVideoComment,
} from '@/lib/db.client';
import { VideoComment } from '@/lib/types';

interface CommentSectionProps {
  title: string; // 作品标题（用于生成评论区标识）
  year: string; // 作品年份
  episodeIndex: number; // 当前集数（1 基），发表时随评论记录
}

type Role = 'owner' | 'admin' | 'user';

const PAGE_SIZE = 20;

// 相对时间：刚刚/X分钟前/X小时前/X天前，超过 7 天显示日期（悬停可看完整时间）
function formatRelativeTime(seconds: number): string {
  const diff = Date.now() - seconds * 1000;
  if (diff < 60 * 1000) return '刚刚';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatFullTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function RoleBadge({ role }: { role?: Role }) {
  if (role === 'owner') {
    return (
      <span className='flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'>
        站长
      </span>
    );
  }
  if (role === 'admin') {
    return (
      <span className='flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'>
        管理
      </span>
    );
  }
  return null;
}

export default function CommentSection({
  title,
  year,
  episodeIndex,
}: CommentSectionProps) {
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [myUsername, setMyUsername] = useState('');
  const [myRole, setMyRole] = useState<Role | undefined>(undefined);

  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const episodeIndexRef = useRef(episodeIndex);

  // 集数实时同步（切换集数不需要重新拉取评论，仅发表时记录所在集）
  episodeIndexRef.current = episodeIndex;

  // 初始化身份信息与存储模式标识
  useEffect(() => {
    const runtimeConfig = (
      window as {
        RUNTIME_CONFIG?: { STORAGE_TYPE?: string };
      }
    ).RUNTIME_CONFIG;
    setIsLocalMode(
      (runtimeConfig?.STORAGE_TYPE || 'localstorage') === 'localstorage'
    );
    const auth = getAuthInfoFromBrowserCookie();
    setMyUsername(auth?.username || '');
    setMyRole(auth?.role);
  }, []);

  // 加载指定页评论
  const loadPage = useCallback(
    async (page: number, replace: boolean) => {
      if (!title) return;
      try {
        const res = await fetchVideoComments(title, year, page, PAGE_SIZE);
        pageRef.current = page;
        hasMoreRef.current = res.has_more;
        setHasMore(res.has_more);
        setTotal(res.total);
        setComments((prev) =>
          replace ? res.comments : [...prev, ...res.comments]
        );
      } catch (err) {
        setError('评论加载失败，请稍后重试');
      }
    },
    [title, year]
  );

  // 作品变化时重置并加载第一页
  useEffect(() => {
    if (!title) return;
    setComments([]);
    setTotal(0);
    setHasMore(false);
    hasMoreRef.current = false;
    setError('');
    setInitialLoading(true);
    loadPage(1, true).finally(() => setInitialLoading(false));
  }, [title, year, loadPage]);

  // 滚动加载：底部哨兵进入视口时拉取下一页
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadPage(pageRef.current + 1, false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [loadPage]);

  useEffect(() => {
    if (initialLoading || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '200px 0px' } // 提前 200px 预加载
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [initialLoading, hasMore, loadMore]);

  // 发表评论
  const handleSubmit = async () => {
    const text = content.trim();
    if (!text || submitting) return;
    if (text.length > COMMENT_MAX_LENGTH) {
      setError(`评论最多 ${COMMENT_MAX_LENGTH} 字`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const comment = await postVideoComment(
        title,
        year,
        text,
        episodeIndexRef.current
      );
      setComments((prev) => [comment, ...prev]);
      setTotal((t) => t + 1);
      setContent('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429')) {
        setError('评论太频繁了，稍后再试');
      } else if (msg.includes('400')) {
        setError('评论内容不合法');
      } else {
        setError('发表失败，请重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 删除评论（本人或 owner/admin；服务端会再次校验）
  const canDelete = (c: VideoComment) => {
    if (isLocalMode) return true; // 本地模式的评论都是自己的
    if (myRole === 'owner' || myRole === 'admin') return true;
    return !!myUsername && c.username === myUsername;
  };

  const handleDelete = async (c: VideoComment) => {
    if (!window.confirm('确定删除这条评论吗？')) return;
    try {
      await removeVideoComment(title, year, c.id);
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      setError('删除失败，请重试');
    }
  };

  if (!title) return null;

  return (
    <div className='mt-4 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm'>
      <div className='p-4'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between mb-3'>
          <h2 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
            评论
            {total > 0 && (
              <span className='ml-2 text-xs font-normal text-gray-500 dark:text-gray-400'>
                {total} 条
              </span>
            )}
          </h2>
        </div>

        {/* 本地模式提示 */}
        {isLocalMode && (
          <div className='mb-3 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200/60 dark:border-yellow-700/50 text-xs text-yellow-700 dark:text-yellow-300'>
            本地存储模式：评论仅保存在本设备，其他设备/其他用户不可见
          </div>
        )}

        {/* 输入区 */}
        <div className='mb-4'>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder='来说点什么吧…（最多 500 字）'
            rows={3}
            maxLength={COMMENT_MAX_LENGTH}
            className='w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900/60 border border-gray-200/60 dark:border-gray-700/60 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/40 resize-none transition-colors'
          />
          <div className='mt-2 flex items-center justify-between'>
            <span className='text-xs text-gray-400 dark:text-gray-500'>
              {content.length}/{COMMENT_MAX_LENGTH}
            </span>
            <button
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className='px-4 py-1.5 rounded-full text-sm font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors'
            >
              {submitting ? '发表中…' : '发表'}
            </button>
          </div>
          {error && (
            <p className='mt-2 text-xs text-red-500 dark:text-red-400'>
              {error}
            </p>
          )}
        </div>

        {/* 评论列表 */}
        <div className='space-y-3'>
          {initialLoading ? (
            <div className='py-6 text-center text-sm text-gray-400 dark:text-gray-500'>
              正在加载评论…
            </div>
          ) : comments.length === 0 ? (
            <div className='py-6 text-center text-sm text-gray-400 dark:text-gray-500'>
              暂无评论，快来抢沙发～
            </div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className='flex items-start gap-2.5 group'>
                {/* 头像（用户名首字） */}
                <div className='flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-semibold text-gray-600 dark:text-gray-300'>
                  {(c.username || '我').charAt(0).toUpperCase()}
                </div>

                <div className='flex-1 min-w-0'>
                  {/* 评论人 · 集数标签 · 时间 */}
                  <div className='flex items-center gap-1.5 flex-wrap'>
                    <span className='text-sm font-medium text-gray-700 dark:text-gray-300 truncate max-w-[10rem]'>
                      {c.username || '我'}
                    </span>
                    <RoleBadge role={c.role} />
                    {c.episode_index != null && (
                      <span className='flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'>
                        第{c.episode_index}集
                      </span>
                    )}
                    <span
                      className='text-xs text-gray-400 dark:text-gray-500'
                      title={formatFullTime(c.created_at)}
                    >
                      {formatRelativeTime(c.created_at)}
                    </span>
                  </div>

                  {/* 内容 */}
                  <p className='mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words'>
                    {c.content}
                  </p>
                </div>

                {/* 删除按钮（本人/管理员可见） */}
                {canDelete(c) && (
                  <button
                    onClick={() => handleDelete(c)}
                    className='flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400'
                    title='删除评论'
                  >
                    删除
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* 滚动加载哨兵与状态 */}
        <div ref={sentinelRef} className='h-1' />
        {loadingMore && (
          <div className='py-3 text-center text-xs text-gray-400 dark:text-gray-500'>
            正在加载更多…
          </div>
        )}
        {!initialLoading && !hasMore && comments.length > 0 && (
          <div className='py-3 text-center text-xs text-gray-400 dark:text-gray-500'>
            没有更多评论了
          </div>
        )}
      </div>
    </div>
  );
}
