/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  buildCommentKey,
  COMMENT_MAX_LENGTH,
  COMMENT_MIN_INTERVAL_MS,
  COMMENT_PAGE_SIZE,
  COMMENT_PAGE_SIZE_MAX,
} from '@/lib/comment';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { VideoComment, VideoCommentList } from '@/lib/types';

export const runtime = 'edge';

// 简单内存节流：同一用户两次评论的最小间隔（按实例独立，重启即清零）
const lastCommentAt = new Map<string, number>();

// 判定用户角色（owner = 部署环境变量账号，admin = 管理配置中的管理员）
function resolveRole(
  config: AdminConfig,
  username: string
): 'owner' | 'admin' | 'user' {
  if (username && username === process.env.USERNAME) return 'owner';
  const entry = config.UserConfig.Users.find((u) => u.username === username);
  return entry?.role === 'admin' ? 'admin' : 'user';
}

// 构建用户名 -> 角色映射，用于给评论列表富化角色徽标
function buildRoleMap(
  config: AdminConfig
): Map<string, 'owner' | 'admin' | 'user'> {
  const roleMap = new Map<string, 'owner' | 'admin' | 'user'>();
  if (process.env.USERNAME) roleMap.set(process.env.USERNAME, 'owner');
  config.UserConfig.Users.forEach((u) => {
    if (!roleMap.has(u.username)) {
      roleMap.set(u.username, u.role === 'admin' ? 'admin' : 'user');
    }
  });
  return roleMap;
}

function enrichComments(
  list: VideoCommentList,
  roleMap: Map<string, 'owner' | 'admin' | 'user'>
): VideoCommentList {
  return {
    ...list,
    comments: list.comments.map((c) => ({
      ...c,
      role: roleMap.get(c.username) || 'user',
    })),
  };
}

// GET：分页读取某作品的评论（新的在前）
export async function GET(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      // 本地存储模式下评论保存在浏览器本地，由客户端直接读写
      return NextResponse.json(
        { error: '本地存储模式下评论保存在浏览器本地' },
        { status: 400 }
      );
    }

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const title = (searchParams.get('title') || '').trim();
    if (!title) {
      return NextResponse.json({ error: '缺少作品标题' }, { status: 400 });
    }
    const year = searchParams.get('year') || '';
    const page = Math.max(
      1,
      parseInt(searchParams.get('page') || '1', 10) || 1
    );
    const pageSize = Math.min(
      COMMENT_PAGE_SIZE_MAX,
      Math.max(
        1,
        parseInt(
          searchParams.get('pageSize') || String(COMMENT_PAGE_SIZE),
          10
        ) || COMMENT_PAGE_SIZE
      )
    );

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: '存储不可用' }, { status: 500 });
    }

    const videoKey = buildCommentKey(title, year);
    const list = await storage.getVideoComments(videoKey, page, pageSize);

    const config = await getConfig();
    return NextResponse.json(enrichComments(list, buildRoleMap(config)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('获取评论失败:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// POST：发表评论（用户名一律取自 cookie，不信任前端）
export async function POST(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '本地存储模式下评论保存在浏览器本地' },
        { status: 400 }
      );
    }

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const title = String((body as any).title || '').trim();
    if (!title) {
      return NextResponse.json({ error: '缺少作品标题' }, { status: 400 });
    }
    const year = String((body as any).year || '');
    const content = String((body as any).content || '').trim();
    if (!content) {
      return NextResponse.json({ error: '评论内容不能为空' }, { status: 400 });
    }
    if (content.length > COMMENT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `评论最多 ${COMMENT_MAX_LENGTH} 字` },
        { status: 400 }
      );
    }

    // 节流：同一用户 10 秒内只能发一条
    const now = Date.now();
    const last = lastCommentAt.get(username) || 0;
    if (now - last < COMMENT_MIN_INTERVAL_MS) {
      return NextResponse.json(
        { error: '评论太频繁了，稍后再试' },
        { status: 429 }
      );
    }

    // 集数（1 基整数）
    const rawEpisode = Number((body as any).episodeIndex);
    const episodeIndex =
      Number.isInteger(rawEpisode) && rawEpisode >= 1 ? rawEpisode : undefined;

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: '存储不可用' }, { status: 500 });
    }

    const videoKey = buildCommentKey(title, year);
    const comment: VideoComment = {
      id: crypto.randomUUID(),
      username,
      video_key: videoKey,
      episode_index: episodeIndex,
      content,
      created_at: Math.floor(now / 1000),
    };

    await storage.saveVideoComment(videoKey, comment);
    lastCommentAt.set(username, now);

    const config = await getConfig();
    const role = resolveRole(config, username);
    return NextResponse.json({ comment: { ...comment, role } });
  } catch (err) {
    console.error('发表评论失败:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// DELETE：删除评论（本人，或 owner/admin 删任何人的）
export async function DELETE(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '本地存储模式下评论保存在浏览器本地' },
        { status: 400 }
      );
    }

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const body = await request.json().catch(() => null);
    const title = String(body?.title || '').trim();
    const year = String(body?.year || '');
    const commentId = String(body?.id || '').trim();
    if (!title || !commentId) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const storage = getStorage();
    if (!storage) {
      return NextResponse.json({ error: '存储不可用' }, { status: 500 });
    }

    const videoKey = buildCommentKey(title, year);
    const existing = await storage.getVideoComment(videoKey, commentId);
    if (!existing) {
      return NextResponse.json({ error: '评论不存在' }, { status: 404 });
    }

    const config = await getConfig();
    const role = resolveRole(config, username);
    if (existing.username !== username && role === 'user') {
      return NextResponse.json({ error: '无权删除该评论' }, { status: 403 });
    }

    await storage.deleteVideoComment(videoKey, commentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('删除评论失败:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
