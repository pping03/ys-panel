'use client';

import { useEffect } from 'react';

// layout.tsx 会将运行时配置注入 window.RUNTIME_CONFIG
declare global {
  interface Window {
    RUNTIME_CONFIG?: { STORAGE_TYPE?: string };
  }
}

/**
 * 用户活跃上报组件：
 * 在非 localstorage 存储模式下，定时向服务端发送心跳，
 * 用于管理界面的「使用时长 / 最近活跃」统计。
 * 挂载在 PageLayout 中，全站页面生效。
 */
const ActivityReporter = () => {
  useEffect(() => {
    const storageType =
      window.RUNTIME_CONFIG?.STORAGE_TYPE ||
      process.env.NEXT_PUBLIC_STORAGE_TYPE ||
      'localstorage';
    if (storageType === 'localstorage') return;

    // 仅在用户已登录（cookie 中有签名）时上报
    const hasAuth = document.cookie
      .split(';')
      .some((c) => c.trim().startsWith('auth='));
    if (!hasAuth) return;

    const report = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/user/activity', { method: 'POST' }).catch(() => {
        // 上报失败静默忽略
      });
    };

    // 挂载时立即上报一次
    report();

    const timer = setInterval(report, 60 * 1000); // 每分钟一次
    return () => clearInterval(timer);
  }, []);

  return null;
};

export default ActivityReporter;
