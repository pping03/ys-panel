/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import { MAX_COMMENTS_PER_VIDEO } from './comment';
import {
  DeviceSessionInfo,
  Favorite,
  IStorage,
  PlayRecord,
  SkipConfig,
  UserAccessRecord,
  UserAccessSummary,
  VideoComment,
  VideoCommentList,
} from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() => this.client.set(this.prKey(userName, key), record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), favorite)
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() => this.client.set(this.userPwdKey(userName), password));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() =>
      this.client.set(this.userPwdKey(userName), newPassword)
    );
  }

  // ---------- 用户访问记录 ----------
  private accessKey(user: string) {
    return `u:${user}:access`; // u:username:access
  }

  private usageKey(user: string) {
    return `u:${user}:usage`; // u:username:usage
  }

  async saveUserAccess(
    userName: string,
    record: UserAccessRecord
  ): Promise<void> {
    const key = this.accessKey(userName);
    await withRetry(() => this.client.lpush(key, JSON.stringify(record)));
    // 只保留最近 10 条
    await withRetry(() => this.client.ltrim(key, 0, 9));
  }

  async updateUserActivity(
    userName: string,
    nowSeconds: number
  ): Promise<void> {
    const key = this.accessKey(userName);
    const raw = await withRetry(() => this.client.lindex(key, 0));
    if (!raw) return;

    try {
      const record: UserAccessRecord =
        typeof raw === 'string' ? JSON.parse(raw) : raw;
      const delta = Math.min(Math.max(nowSeconds - record.last_active, 0), 180);
      if (delta > 1) {
        // 累计使用时长（心跳间隔上限180秒，防止时间偏差导致虚增）
        await withRetry(() =>
          this.client.incrby(this.usageKey(userName), Math.round(delta))
        );
      }
      record.last_active = nowSeconds;
      await withRetry(() => this.client.lset(key, 0, JSON.stringify(record)));
    } catch (err) {
      console.error('更新用户活跃状态失败:', err);
    }
  }

  async getUserAccessSummary(userName: string): Promise<UserAccessSummary> {
    const rawList = await withRetry(() =>
      this.client.lrange(this.accessKey(userName), 0, -1)
    );
    const logs: UserAccessRecord[] = [];
    (rawList || []).forEach((raw: unknown) => {
      try {
        logs.push(
          typeof raw === 'string' ? JSON.parse(raw) : (raw as UserAccessRecord)
        );
      } catch {
        // 忽略损坏的记录
      }
    });

    const usage = await withRetry(() =>
      this.client.get<number>(this.usageKey(userName))
    );
    const usageTotal = usage ? Number(usage) : 0;

    return { logs, usage_total: isNaN(usageTotal) ? 0 : usageTotal };
  }

  // ---------- 登录设备会话 ----------
  // ZSET: member = deviceId, score = 最近登录时间（毫秒）
  private sessionKey(user: string) {
    return `u:${user}:devices`;
  }
  // HASH: device_id -> 设备描述（由 UA 解析）
  private deviceMetaKey(user: string) {
    return `u:${user}:device_meta`;
  }

  async saveUserSession(
    userName: string,
    timestampMs: number,
    deviceId?: string,
    ua?: string,
    limit?: number
  ): Promise<void> {
    if (!deviceId) return; // 无设备标识不登记（不占设备名额）

    const key = this.sessionKey(userName);
    const metaKey = this.deviceMetaKey(userName);
    const maxDevices = limit && limit > 0 ? Math.floor(limit) : 0;

    // 同一设备重复登录：原地更新会话时间，不额外占名额
    await withRetry(() =>
      this.client.zadd(key, { score: timestampMs, member: deviceId })
    );
    if (ua) {
      await withRetry(() => this.client.hset(metaKey, { [deviceId]: ua }));
    }

    if (maxDevices === 0) return; // 不限制设备数量，只登记不淘汰

    // 超过设备上限时，最早登录的设备被挤出（其登录cookie随即失效）
    const evicted = await withRetry(() =>
      this.client.zrange(key, 0, -(maxDevices + 1))
    );
    const evictedList = (Array.isArray(evicted) ? evicted : []).map((m) =>
      typeof m === 'string' ? m : String((m as any)?.member ?? m)
    );
    if (evictedList.length > 0) {
      await withRetry(() =>
        this.client.zremrangebyrank(key, 0, -(maxDevices + 1))
      );
      for (const evictedId of evictedList) {
        await withRetry(() => this.client.hdel(metaKey, evictedId));
      }
    }
  }

  async hasUserSession(
    userName: string,
    timestampMs: number,
    deviceId?: string,
    limit?: number
  ): Promise<boolean> {
    const maxDevices = limit && limit > 0 ? Math.floor(limit) : 0;
    // 无设备标识的旧cookie：不限制时视为有效，有限制时视为失效（重新登录即可恢复）
    if (!deviceId) return maxDevices === 0;

    const key = this.sessionKey(userName);
    const score = await withRetry(() => this.client.zscore(key, deviceId));
    // 未登记：不限制时放行，有限制时视为已被挤出
    if (score === null || score === undefined) return maxDevices === 0;

    const loginTime = Number(score);
    if (isNaN(loginTime) || loginTime !== timestampMs) return false; // 该设备已在别处重新登录，旧cookie失效

    if (maxDevices === 0) return true; // 不限制设备数量

    // 检查是否仍在上限名额内（按最近登录时间排名）
    const rank = await withRetry(() => this.client.zrevrank(key, deviceId));
    return rank !== null && rank !== undefined && rank < maxDevices;
  }

  async getUserDevices(userName: string): Promise<DeviceSessionInfo[]> {
    const key = this.sessionKey(userName);
    const metaKey = this.deviceMetaKey(userName);

    // 兼容 withScores 的两种返回形态：[{member, score}] 或 [member, score, ...]
    const raw = await withRetry(() =>
      this.client.zrange(key, 0, -1, { withScores: true })
    );
    const pairs: Array<{ id: string; score: number }> = [];
    if (Array.isArray(raw)) {
      if (
        raw.length > 0 &&
        typeof raw[0] === 'object' &&
        raw[0] !== null &&
        'member' in (raw[0] as any)
      ) {
        for (const item of raw as any[]) {
          pairs.push({ id: String(item.member), score: Number(item.score) });
        }
      } else {
        for (let i = 0; i < raw.length; i += 2) {
          pairs.push({
            id:
              typeof raw[i] === 'string'
                ? raw[i]
                : String((raw[i] as any)?.member ?? raw[i]),
            score: Number(raw[i + 1]),
          });
        }
      }
    }

    const metas = (await withRetry(() =>
      this.client.hgetall(metaKey)
    )) as Record<string, string>;

    return pairs
      .filter((p) => !isNaN(p.score))
      .map((p) => ({
        device_id: p.id,
        ua: metas?.[p.id] || '未知设备',
        session_time: p.score,
      }))
      .sort((a, b) => b.session_time - a.session_time);
  }

  // ---------- 视频评论 ----------
  // HASH 存评论内容（commentId -> JSON），ZSET 存时间索引（score=评论时间），分页/淘汰走 ZSET
  private commentHashKey(videoKey: string) {
    return `c:v:${videoKey}`;
  }
  private commentIndexKey(videoKey: string) {
    return `c:v:${videoKey}:idx`;
  }

  async getVideoComments(
    videoKey: string,
    page: number,
    pageSize: number
  ): Promise<VideoCommentList> {
    const hashKey = this.commentHashKey(videoKey);
    const idxKey = this.commentIndexKey(videoKey);

    const total = Number(
      (await withRetry(() => this.client.zcard(idxKey))) || 0
    );
    const start = (page - 1) * pageSize;
    const stop = start + pageSize - 1;

    // rev: true 表示按下标从新到旧取（score 降序）
    const ids =
      total > start
        ? await withRetry(() =>
            this.client.zrange(idxKey, start, stop, { rev: true })
          )
        : [];
    const cleanIds = (Array.isArray(ids) ? ids : [])
      .map((id) =>
        typeof id === 'string' ? id : String((id as any)?.member ?? id)
      )
      .filter(Boolean);
    const raws = cleanIds.length
      ? await withRetry(() => this.client.hmget(hashKey, ...cleanIds))
      : [];

    const comments = (Array.isArray(raws) ? raws : [])
      .filter(Boolean)
      .map((raw) => {
        try {
          return JSON.parse(ensureString(raw)) as VideoComment;
        } catch {
          return null;
        }
      })
      .filter((c): c is VideoComment => !!c && !!c.id);

    return { comments, total, has_more: stop + 1 < total };
  }

  async getVideoComment(
    videoKey: string,
    commentId: string
  ): Promise<VideoComment | null> {
    const raw = await withRetry(() =>
      this.client.hget(this.commentHashKey(videoKey), commentId)
    );
    if (!raw) return null;
    try {
      return JSON.parse(ensureString(raw)) as VideoComment;
    } catch {
      return null;
    }
  }

  async saveVideoComment(
    videoKey: string,
    comment: VideoComment
  ): Promise<void> {
    const hashKey = this.commentHashKey(videoKey);
    const idxKey = this.commentIndexKey(videoKey);

    await withRetry(() =>
      this.client.hset(hashKey, { [comment.id]: JSON.stringify(comment) })
    );
    await withRetry(() =>
      this.client.zadd(idxKey, {
        score: comment.created_at,
        member: comment.id,
      })
    );

    // 超过单作品上限时，淘汰最早的评论
    const total = Number(
      (await withRetry(() => this.client.zcard(idxKey))) || 0
    );
    if (total > MAX_COMMENTS_PER_VIDEO) {
      const overflow = total - MAX_COMMENTS_PER_VIDEO;
      const evicted = await withRetry(() =>
        this.client.zrange(idxKey, 0, overflow - 1)
      );
      const evictedIds = (Array.isArray(evicted) ? evicted : []).map((m) =>
        typeof m === 'string' ? m : String((m as any)?.member ?? m)
      );
      for (const id of evictedIds) {
        await withRetry(() => this.client.zrem(idxKey, id));
        await withRetry(() => this.client.hdel(hashKey, id));
      }
    }
  }

  async deleteVideoComment(videoKey: string, commentId: string): Promise<void> {
    await withRetry(() =>
      this.client.zrem(this.commentIndexKey(videoKey), commentId)
    );
    await withRetry(() =>
      this.client.hdel(this.commentHashKey(videoKey), commentId)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 删除登录设备会话
    await withRetry(() => this.client.del(this.sessionKey(userName)));
    await withRetry(() => this.client.del(this.deviceMetaKey(userName)));

    // 删除访问记录与使用时长统计
    await withRetry(() => this.client.del(this.accessKey(userName)));
    await withRetry(() => this.client.del(this.usageKey(userName)));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await withRetry(() => this.client.del(...playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(...favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await withRetry(() => this.client.del(...skipConfigKeys));
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, ensureString(keyword)));
    // 限制最大长度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await withRetry(() => this.client.keys('u:*:pwd'));
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? ensureString(match[1]) : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() => this.client.set(this.adminConfigKey(), config));
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.skipConfigKey(userName, source, id), config)
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量获取所有配置
    const values = await withRetry(() => this.client.mget(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = value as SkipConfig;
        }
      }
    });

    return configs;
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__NOVATV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可选配置
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
