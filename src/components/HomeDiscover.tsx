/* eslint-disable no-console */

'use client';

import { ChevronRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DISCOVER_SECTIONS, DiscoverSection } from '@/lib/discover';
import { getDoubanCategories, getDoubanList } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import VideoCard from '@/components/VideoCard';

const STORAGE_KEY = 'ys_home_section';
const PAGE_LIMIT = 24;

type LoadState = {
  status: 'loading' | 'done' | 'error';
  list: DoubanItem[];
};

async function loadSection(section: DiscoverSection): Promise<DoubanItem[]> {
  if (section.mode === 'categories') {
    const data = await getDoubanCategories({
      kind: section.kind,
      category: section.category,
      type: section.type,
      pageLimit: PAGE_LIMIT,
    });
    return data.code === 200 ? data.list : [];
  }
  if (section.mode === 'list') {
    const data = await getDoubanList({
      type: section.doubanType,
      tag: section.tag,
      pageLimit: PAGE_LIMIT,
    });
    return data.code === 200 ? data.list : [];
  }
  return [];
}

export default function HomeDiscover() {
  const [activeKey, setActiveKey] = useState<string>(DISCOVER_SECTIONS[0].key);
  const [states, setStates] = useState<Record<string, LoadState>>({});
  // 已发起过请求的分区，避免重复请求
  const requestedRef = useRef<Set<string>>(new Set());

  // 恢复上次选择的分区
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DISCOVER_SECTIONS.some((s) => s.key === saved)) {
        setActiveKey(saved);
      }
    } catch (_) {
      // ignore
    }
  }, []);

  const fetchSection = useCallback((section: DiscoverSection) => {
    if (section.mode === 'shortcut') return;
    requestedRef.current.add(section.key);
    setStates((prev) => ({
      ...prev,
      [section.key]: { status: 'loading', list: [] },
    }));
    loadSection(section)
      .then((list) =>
        setStates((prev) => ({
          ...prev,
          [section.key]: { status: 'done', list },
        }))
      )
      .catch((err) => {
        console.error(`获取「${section.label}」失败:`, err);
        setStates((prev) => ({
          ...prev,
          [section.key]: { status: 'error', list: [] },
        }));
      });
  }, []);

  const active =
    DISCOVER_SECTIONS.find((s) => s.key === activeKey) || DISCOVER_SECTIONS[0];

  useEffect(() => {
    if (!requestedRef.current.has(active.key)) {
      fetchSection(active);
    }
  }, [active, fetchSection]);

  const handleSelect = (key: string) => {
    setActiveKey(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch (_) {
      // ignore
    }
  };

  const state = states[active.key];

  return (
    <section className='mb-8'>
      {/* 分区选择：窄屏可横向滑动 */}
      <div className='mb-4 -mx-2 px-2 overflow-x-auto scrollbar-hide'>
        <div className='flex gap-2 w-max'>
          {DISCOVER_SECTIONS.map((section) => {
            const isActive = section.key === active.key;
            return (
              <button
                key={section.key}
                onClick={() => handleSelect(section.key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-green-600 text-white shadow'
                    : 'bg-gray-200/70 text-gray-700 hover:bg-gray-300/70 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 标题行 */}
      <div className='mb-4 flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
            {active.label}
          </h2>
          {active.note && (
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              {active.note}
            </p>
          )}
        </div>
        {active.mode !== 'shortcut' && active.moreHref && (
          <Link
            href={active.moreHref}
            className='flex flex-shrink-0 items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          >
            查看更多
            <ChevronRight className='w-4 h-4 ml-1' />
          </Link>
        )}
      </div>

      {active.mode === 'shortcut' ? (
        <div className='flex flex-wrap gap-3'>
          {active.keywords.map((kw) => (
            <Link
              key={kw}
              href={`/search?q=${encodeURIComponent(kw)}`}
              className='inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:border-green-500 hover:text-green-600 dark:border-gray-700 dark:text-gray-300 dark:hover:border-green-500 dark:hover:text-green-400 transition-colors'
            >
              <Search className='w-4 h-4' />
              搜索「{kw}」
            </Link>
          ))}
        </div>
      ) : (
        <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
          {(!state || state.status === 'loading') &&
            Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className='w-full'>
                <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'></div>
                <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
              </div>
            ))}

          {state?.status === 'done' &&
            state.list.map((item, index) => (
              <div key={`${item.id}-${index}`} className='w-full'>
                <VideoCard
                  from='douban'
                  title={item.title}
                  poster={item.poster}
                  douban_id={item.id}
                  rate={item.rate}
                  year={item.year}
                  type={active.cardType || ''}
                />
              </div>
            ))}

          {state?.status === 'done' && state.list.length === 0 && (
            <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
              暂无数据
            </div>
          )}

          {state?.status === 'error' && (
            <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
              <p>列表加载失败（豆瓣接口暂时不可达）</p>
              <button
                onClick={() => fetchSection(active)}
                className='mt-3 px-4 py-1.5 rounded-full text-sm bg-green-600 text-white hover:bg-green-700 transition-colors'
              >
                重试
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
