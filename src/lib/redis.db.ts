/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

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

// 添加Redis操作重试包装器
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
        err.code === 'EPIPE';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

        // 尝试重新连接
        try {
          const client = getRedisClient();
          if (!client.isOpen) {
            await client.connect();
          }
        } catch (reconnectErr) {
          console.error('Failed to reconnect:', reconnectErr);
        }

        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class RedisStorage implements IStorage {
  private client: RedisClientType;

  constructor() {
    this.client = getRedisClient();
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
    return val ? (JSON.parse(val) as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.prKey(userName, key), JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await withRetry(() => this.client.mGet(keys));
    const result: Record<string, PlayRecord> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const rec = JSON.parse(raw) as PlayRecord;
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = rec;
      }
    });
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
    return val ? (JSON.parse(val) as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await withRetry(() => this.client.mGet(keys));
    const result: Record<string, Favorite> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const fav = JSON.parse(raw) as Favorite;
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = fav;
      }
    });
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
    await withRetry(() => this.client.lPush(key, JSON.stringify(record)));
    // 只保留最近 10 条
    await withRetry(() => this.client.lTrim(key, 0, 9));
  }

  async updateUserActivity(
    userName: string,
    nowSeconds: number
  ): Promise<void> {
    const key = this.accessKey(userName);
    const raw = await withRetry(() => this.client.lIndex(key, 0));
    if (!raw) return;

    try {
      const record: UserAccessRecord = JSON.parse(ensureString(raw));
      const delta = Math.min(Math.max(nowSeconds - record.last_active, 0), 180);
      if (delta > 1) {
        // 累计使用时长（心跳间隔上限180秒，防止时间偏差导致虚增）
        await withRetry(() =>
          this.client.incrBy(this.usageKey(userName), Math.round(delta))
        );
      }
      record.last_active = nowSeconds;
      await withRetry(() => this.client.lSet(key, 0, JSON.stringify(record)));
    } catch (err) {
      console.error('更新用户活跃状态失败:', err);
    }
  }

  async getUserAccessSummary(userName: string): Promise<UserAccessSummary> {
    const rawList = await withRetry(() =>
      this.client.lRange(this.accessKey(userName), 0, -1)
    );
    const logs: UserAccessRecord[] = [];
    ensureStringArray(rawList as any[]).forEach((raw) => {
      try {
        logs.push(JSON.parse(raw));
      } catch {
        // 忽略损坏的记录
      }
    });

    const usage = await withRetry(() =>
      this.client.get(this.usageKey(userName))
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
      this.client.zAdd(key, [{ score: timestampMs, value: deviceId }])
    );
    if (ua) {
      await withRetry(() => this.client.hSet(metaKey, deviceId, ua));
    }

    if (maxDevices === 0) return; // 不限制设备数量，只登记不淘汰

    // 超过设备上限时，最早登录的设备被挤出（其登录cookie随即失效）
    const evicted = await withRetry(() =>
      this.client.zRange(key, 0, -(maxDevices + 1))
    );
    if (evicted && evicted.length > 0) {
      await withRetry(() =>
        this.client.zRemRangeByRank(key, 0, -(maxDevices + 1))
      );
      for (const evictedId of evicted) {
        await withRetry(() =>
          this.client.hDel(metaKey, ensureString(evictedId))
        );
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
    const score = await withRetry(() => this.client.zScore(key, deviceId));
    // 未登记：不限制时放行，有限制时视为已被挤出
    if (score === null || score === undefined) return maxDevices === 0;

    const loginTime = Number(ensureString(score));
    if (isNaN(loginTime) || loginTime !== timestampMs) return false; // 该设备已在别处重新登录，旧cookie失效

    if (maxDevices === 0) return true; // 不限制设备数量

    // 检查是否仍在上限名额内（按最近登录时间排名）
    const rank = await withRetry(() => this.client.zRevRank(key, deviceId));
    return rank !== null && rank !== undefined && rank < maxDevices;
  }

  async getUserDevices(userName: string): Promise<DeviceSessionInfo[]> {
    const key = this.sessionKey(userName);
    const metaKey = this.deviceMetaKey(userName);

    const members = await withRetry(() =>
      this.client.zRangeWithScores(key, 0, -1)
    );
    const metas = await withRetry(() => this.client.hGetAll(metaKey));
    const metaMap: Record<string, string> = metas || {};

    return (members || [])
      .map((item) => ({
        device_id: ensureString((item as any).value ?? item),
        ua: metaMap[ensureString((item as any).value ?? item)] || '未知设备',
        session_time: Number((item as any).score),
      }))
      .filter((d) => !isNaN(d.session_time))
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

    const total = (await withRetry(() => this.client.zCard(idxKey))) || 0;
    const start = (page - 1) * pageSize;
    const stop = start + pageSize - 1;

    const ids =
      total > start
        ? await withRetry(() => this.client.zRange(idxKey, start, stop))
        : [];
    // ZSET 按 score 升序（旧->新），切片后反转即新的在前
    const cleanIds = ensureStringArray(ids as any[]).reverse();
    const raws = cleanIds.length
      ? await withRetry(() => this.client.hmGet(hashKey, cleanIds))
      : [];

    const comments = (raws as any[])
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
      this.client.hGet(this.commentHashKey(videoKey), commentId)
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
      this.client.hSet(hashKey, comment.id, JSON.stringify(comment))
    );
    await withRetry(() =>
      this.client.zAdd(idxKey, [
        { score: comment.created_at, value: comment.id },
      ])
    );

    // 超过单作品上限时，淘汰最早的评论
    const total = (await withRetry(() => this.client.zCard(idxKey))) || 0;
    if (total > MAX_COMMENTS_PER_VIDEO) {
      const overflow = total - MAX_COMMENTS_PER_VIDEO;
      const evicted = await withRetry(() =>
        this.client.zRange(idxKey, 0, overflow - 1)
      );
      for (const id of ensureStringArray(evicted as any[])) {
        await withRetry(() => this.client.zRem(idxKey, id));
        await withRetry(() => this.client.hDel(hashKey, id));
      }
    }
  }

  async deleteVideoComment(videoKey: string, commentId: string): Promise<void> {
    await withRetry(() =>
      this.client.zRem(this.commentIndexKey(videoKey), commentId)
    );
    await withRetry(() =>
      this.client.hDel(this.commentHashKey(videoKey), commentId)
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
      await withRetry(() => this.client.del(playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await withRetry(() => this.client.del(skipConfigKeys));
    }
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大长度
    await withRetry(() => this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
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
    return val ? (JSON.parse(val) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config))
    );
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
    return val ? (JSON.parse(val) as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(
        this.skipConfigKey(userName, source, id),
        JSON.stringify(config)
      )
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
    const values = await withRetry(() => this.client.mGet(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = JSON.parse(value as string) as SkipConfig;
        }
      }
    });

    return configs;
  }
}

// 单例 Redis 客户端
function getRedisClient(): RedisClientType {
  const globalKey = Symbol.for('__NOVATV_REDIS_CLIENT__');
  let client: RedisClientType | undefined = (global as any)[globalKey];

  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL env variable not set');
    }

    // 创建客户端，配置重连策略
    client = createClient({
      url,
      socket: {
        // 重连策略：指数退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(`Redis reconnection attempt ${retries + 1}`);
          if (retries > 10) {
            console.error('Redis max reconnection attempts exceeded');
            return false; // 停止重连
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避，最大30秒
        },
        connectTimeout: 10000, // 10秒连接超时
        // 设置no delay，减少延迟
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持连接活跃
    });

    // 添加错误事件监听
    client.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    client.on('connect', () => {
      console.log('Redis connected');
    });

    client.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });

    client.on('ready', () => {
      console.log('Redis ready');
    });

    // 初始连接，带重试机制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log('Redis connected successfully');
      } catch (err) {
        console.error('Redis initial connection failed:', err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalKey] = client;
  }

  return client;
}
