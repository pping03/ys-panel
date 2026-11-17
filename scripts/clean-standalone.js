#!/usr/bin/env node
/* eslint-disable */
// 构建前清理 .next/standalone
//
// 背景：next.config.js 里开了 output: 'standalone'，它会在
// .next/standalone/node_modules 下生成指回真实依赖的绝对符号链接
// （例如 next -> <项目>/node_modules/.pnpm/next@x/node_modules/next）。
//
// 而下一次 next build 启动时会调用 next/dist/lib/recursive-delete.js 清理
// .next 目录，该函数会把「指向目录的符号链接」当成目录继续递归删除，
// 结果顺着链接把真实的 node_modules/.pnpm 内容删空，导致构建报
// Cannot find module './impl' 之类的错误。
//
// fs.rmSync 不会跟随符号链接（只删除链接本身），因此在 next build
// 动手之前先把 standalone 目录清掉即可避免。

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  process.exit(0);
}

try {
  fs.rmSync(standaloneDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  console.log('[clean-standalone] 已清理 .next/standalone');
} catch (error) {
  console.error('[clean-standalone] 清理失败:', error.message);
  process.exit(1);
}
