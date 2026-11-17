/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

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

// D1 数据库接口
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1ExecResult>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = any>(): Promise<D1Result<T>>;
}

interface D1Result<T = any> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    last_row_id: number;
    duration: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

// 获取全局D1数据库实例
function getD1Database(): D1Database {
  return (process.env as any).DB as D1Database;
}

export class D1Storage implements IStorage {
  private db: D1Database | null = null;

  private async getDatabase(): Promise<D1Database> {
    if (!this.db) {
      this.db = getD1Database();
    }
    return this.db;
  }

  // 播放记录相关
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        index: result.index_episode,
        total_episodes: result.total_episodes,
        play_time: result.play_time,
        total_time: result.total_time,
        save_time: result.save_time,
        search_title: result.search_title || undefined,
      };
    } catch (err) {
      console.error('Failed to get play record:', err);
      throw err;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO play_records 
          (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          record.title,
          record.source_name,
          record.cover,
          record.year,
          record.index,
          record.total_episodes,
          record.play_time,
          record.total_time,
          record.save_time,
          record.search_title || null
        )
        .run();
    } catch (err) {
      console.error('Failed to set play record:', err);
      throw err;
    }
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const records: Record<string, PlayRecord> = {};

      result.results.forEach((row: any) => {
        records[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          index: row.index_episode,
          total_episodes: row.total_episodes,
          play_time: row.play_time,
          total_time: row.total_time,
          save_time: row.save_time,
          search_title: row.search_title || undefined,
        };
      });

      return records;
    } catch (err) {
      console.error('Failed to get all play records:', err);
      throw err;
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM play_records WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete play record:', err);
      throw err;
    }
  }

  // 收藏相关
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT * FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .first<any>();

      if (!result) return null;

      return {
        title: result.title,
        source_name: result.source_name,
        cover: result.cover,
        year: result.year,
        total_episodes: result.total_episodes,
        save_time: result.save_time,
        search_title: result.search_title,
      };
    } catch (err) {
      console.error('Failed to get favorite:', err);
      throw err;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO favorites 
          (username, key, title, source_name, cover, year, total_episodes, save_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          key,
          favorite.title,
          favorite.source_name,
          favorite.cover,
          favorite.year,
          favorite.total_episodes,
          favorite.save_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set favorite:', err);
      throw err;
    }
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
        )
        .bind(userName)
        .all<any>();

      const favorites: Record<string, Favorite> = {};

      result.results.forEach((row: any) => {
        favorites[row.key] = {
          title: row.title,
          source_name: row.source_name,
          cover: row.cover,
          year: row.year,
          total_episodes: row.total_episodes,
          save_time: row.save_time,
          search_title: row.search_title,
        };
      });

      return favorites;
    } catch (err) {
      console.error('Failed to get all favorites:', err);
      throw err;
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
        .bind(userName, key)
        .run();
    } catch (err) {
      console.error('Failed to delete favorite:', err);
      throw err;
    }
  }

  // 用户相关
  async registerUser(userName: string, password: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
        .bind(userName, password)
        .run();
    } catch (err) {
      console.error('Failed to register user:', err);
      throw err;
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT password FROM users WHERE username = ?')
        .bind(userName)
        .first<{ password: string }>();

      return result?.password === password;
    } catch (err) {
      console.error('Failed to verify user:', err);
      throw err;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT 1 FROM users WHERE username = ?')
        .bind(userName)
        .first();

      return result !== null;
    } catch (err) {
      console.error('Failed to check user existence:', err);
      throw err;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('UPDATE users SET password = ? WHERE username = ?')
        .bind(newPassword, userName)
        .run();
    } catch (err) {
      console.error('Failed to change password:', err);
      throw err;
    }
  }

  // ---------- 用户访问记录 ----------
  async saveUserAccess(
    userName: string,
    record: UserAccessRecord
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `INSERT OR REPLACE INTO user_access_logs (username, login_time, ip, last_active)
           VALUES (?, ?, ?, ?)`
        )
        .bind(userName, record.login_time, record.ip, record.last_active)
        .run();

      // 只保留最近 10 条
      await db
        .prepare(
          `DELETE FROM user_access_logs
           WHERE username = ? AND login_time NOT IN (
             SELECT login_time FROM user_access_logs
             WHERE username = ?
             ORDER BY login_time DESC
             LIMIT 10
           )`
        )
        .bind(userName, userName)
        .run();
    } catch (err) {
      console.error('Failed to save user access:', err);
      throw err;
    }
  }

  async updateUserActivity(
    userName: string,
    nowSeconds: number
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          `SELECT id, last_active FROM user_access_logs
           WHERE username = ? ORDER BY login_time DESC LIMIT 1`
        )
        .bind(userName)
        .first<any>();

      if (!result) return;

      const delta = Math.min(Math.max(nowSeconds - result.last_active, 0), 180);
      if (delta > 1) {
        // 累计使用时长（心跳间隔上限180秒，防止时间偏差导致虚增）
        await db
          .prepare(
            `INSERT INTO user_usage (username, usage_seconds) VALUES (?, ?)
             ON CONFLICT(username) DO UPDATE SET
             usage_seconds = usage_seconds + excluded.usage_seconds`
          )
          .bind(userName, Math.round(delta))
          .run();
      }

      await db
        .prepare('UPDATE user_access_logs SET last_active = ? WHERE id = ?')
        .bind(nowSeconds, result.id)
        .run();
    } catch (err) {
      console.error('Failed to update user activity:', err);
      throw err;
    }
  }

  async getUserAccessSummary(userName: string): Promise<UserAccessSummary> {
    try {
      const db = await this.getDatabase();
      const accessResult = await db
        .prepare(
          `SELECT login_time, ip, last_active FROM user_access_logs
           WHERE username = ? ORDER BY login_time DESC LIMIT 10`
        )
        .bind(userName)
        .all<any>();

      const logs: UserAccessRecord[] = (accessResult.results || []).map(
        (row) => ({
          login_time: row.login_time,
          ip: row.ip,
          last_active: row.last_active,
        })
      );

      const usageResult = await db
        .prepare('SELECT usage_seconds FROM user_usage WHERE username = ?')
        .bind(userName)
        .first<{ usage_seconds: number }>();

      return {
        logs,
        usage_total: usageResult?.usage_seconds || 0,
      };
    } catch (err) {
      console.error('Failed to get user access summary:', err);
      throw err;
    }
  }

  // ---------- 登录设备会话 ----------
  async saveUserSession(
    userName: string,
    timestampMs: number,
    deviceId?: string,
    ua?: string,
    limit?: number
  ): Promise<void> {
    if (!deviceId) return; // 无设备标识不登记（不占设备名额）

    try {
      const db = await this.getDatabase();
      // 同一设备重复登录：原地更新会话时间与设备描述，不额外占名额
      await db
        .prepare(
          `INSERT OR REPLACE INTO user_sessions (username, device_id, session_time, ua)
           VALUES (?, ?, ?, ?)`
        )
        .bind(userName, deviceId, timestampMs, ua || '')
        .run();

      const maxDevices = limit && limit > 0 ? Math.floor(limit) : 0;
      if (maxDevices === 0) return; // 不限制设备数量，只登记不淘汰

      // 超过设备上限时，最早登录的设备被挤出（其登录cookie随即失效）
      await db
        .prepare(
          `DELETE FROM user_sessions
           WHERE username = ? AND device_id NOT IN (
             SELECT device_id FROM user_sessions
             WHERE username = ?
             ORDER BY session_time DESC
             LIMIT ?
           )`
        )
        .bind(userName, userName, maxDevices)
        .run();
    } catch (err) {
      console.error('Failed to save user session:', err);
      throw err;
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

    try {
      const db = await this.getDatabase();

      // 该设备当前登记的会话信息
      const rows = await db
        .prepare(
          'SELECT session_time FROM user_sessions WHERE username = ? AND device_id = ?'
        )
        .bind(userName, deviceId)
        .all<any>();
      const row = (rows.results || [])[0];
      // 未登记：不限制时放行，有限制时视为已被挤出
      if (!row) return maxDevices === 0;
      if (Number(row.session_time) !== timestampMs) return false; // 该设备已在别处重新登录，旧cookie失效

      if (maxDevices === 0) return true; // 不限制设备数量

      // 检查是否仍在上限名额内（按最近登录时间排名，比它新的设备数 < 上限）
      const rankRows = await db
        .prepare(
          'SELECT COUNT(*) AS cnt FROM user_sessions WHERE username = ? AND session_time > ?'
        )
        .bind(userName, Number(row.session_time))
        .all<any>();
      const rank = Number((rankRows.results || [])[0]?.cnt || 0);
      return rank < maxDevices;
    } catch (err) {
      console.error('Failed to check user session:', err);
      throw err;
    }
  }

  async getUserDevices(userName: string): Promise<DeviceSessionInfo[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          `SELECT device_id, ua, session_time FROM user_sessions
           WHERE username = ?
           ORDER BY session_time DESC`
        )
        .bind(userName)
        .all<any>();

      return (result.results || []).map((row) => ({
        device_id: String(row.device_id),
        ua: row.ua || '未知设备',
        session_time: Number(row.session_time),
      }));
    } catch (err) {
      console.error('Failed to get user devices:', err);
      return [];
    }
  }

  // ---------- 视频评论 ----------
  async getVideoComments(
    videoKey: string,
    page: number,
    pageSize: number
  ): Promise<VideoCommentList> {
    try {
      const db = await this.getDatabase();

      const countRows = await db
        .prepare(
          'SELECT COUNT(*) AS cnt FROM video_comments WHERE video_key = ?'
        )
        .bind(videoKey)
        .all<any>();
      const total = Number((countRows.results || [])[0]?.cnt || 0);

      const start = (page - 1) * pageSize;
      const rows = await db
        .prepare(
          `SELECT id, username, video_key, episode_index, content, created_at
           FROM video_comments
           WHERE video_key = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .bind(videoKey, pageSize, start)
        .all<any>();

      const comments = (rows.results || []).map((row) => ({
        id: String(row.id),
        username: String(row.username),
        video_key: String(row.video_key),
        episode_index:
          row.episode_index === null || row.episode_index === undefined
            ? undefined
            : Number(row.episode_index),
        content: String(row.content),
        created_at: Number(row.created_at),
      }));

      return { comments, total, has_more: start + comments.length < total };
    } catch (err) {
      console.error('Failed to get video comments:', err);
      throw err;
    }
  }

  async getVideoComment(
    videoKey: string,
    commentId: string
  ): Promise<VideoComment | null> {
    try {
      const db = await this.getDatabase();
      const rows = await db
        .prepare(
          'SELECT id, username, video_key, episode_index, content, created_at FROM video_comments WHERE video_key = ? AND id = ?'
        )
        .bind(videoKey, commentId)
        .all<any>();
      const row = (rows.results || [])[0];
      if (!row) return null;
      return {
        id: String(row.id),
        username: String(row.username),
        video_key: String(row.video_key),
        episode_index:
          row.episode_index === null || row.episode_index === undefined
            ? undefined
            : Number(row.episode_index),
        content: String(row.content),
        created_at: Number(row.created_at),
      };
    } catch (err) {
      console.error('Failed to get video comment:', err);
      return null;
    }
  }

  async saveVideoComment(
    videoKey: string,
    comment: VideoComment
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `INSERT INTO video_comments (id, username, video_key, episode_index, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          comment.id,
          comment.username,
          videoKey,
          comment.episode_index ?? null,
          comment.content,
          comment.created_at
        )
        .run();

      // 超过单作品上限时，淘汰最早的评论
      await db
        .prepare(
          `DELETE FROM video_comments
           WHERE video_key = ? AND id NOT IN (
             SELECT id FROM video_comments
             WHERE video_key = ?
             ORDER BY created_at DESC
             LIMIT ?
           )`
        )
        .bind(videoKey, videoKey, MAX_COMMENTS_PER_VIDEO)
        .run();
    } catch (err) {
      console.error('Failed to save video comment:', err);
      throw err;
    }
  }

  async deleteVideoComment(videoKey: string, commentId: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare('DELETE FROM video_comments WHERE video_key = ? AND id = ?')
        .bind(videoKey, commentId)
        .run();
    } catch (err) {
      console.error('Failed to delete video comment:', err);
      throw err;
    }
  }

  async deleteUser(userName: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      const statements = [
        db.prepare('DELETE FROM users WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM play_records WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM favorites WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName),
        db
          .prepare('DELETE FROM skip_configs WHERE username = ?')
          .bind(userName),
        db
          .prepare('DELETE FROM user_access_logs WHERE username = ?')
          .bind(userName),
        db.prepare('DELETE FROM user_usage WHERE username = ?').bind(userName),
        db
          .prepare('DELETE FROM user_sessions WHERE username = ?')
          .bind(userName),
      ];

      await db.batch(statements);
    } catch (err) {
      console.error('Failed to delete user:', err);
      throw err;
    }
  }

  // 搜索历史相关
  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ?'
        )
        .bind(userName, SEARCH_HISTORY_LIMIT)
        .all<{ keyword: string }>();

      return result.results.map((row) => row.keyword);
    } catch (err) {
      console.error('Failed to get search history:', err);
      throw err;
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      // 先删除可能存在的重复记录
      await db
        .prepare(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?'
        )
        .bind(userName, keyword)
        .run();

      // 添加新记录
      await db
        .prepare('INSERT INTO search_history (username, keyword) VALUES (?, ?)')
        .bind(userName, keyword)
        .run();

      // 保持历史记录条数限制
      await db
        .prepare(
          `
          DELETE FROM search_history 
          WHERE username = ? AND id NOT IN (
            SELECT id FROM search_history 
            WHERE username = ? 
            ORDER BY created_at DESC 
            LIMIT ?
          )
        `
        )
        .bind(userName, userName, SEARCH_HISTORY_LIMIT)
        .run();
    } catch (err) {
      console.error('Failed to add search history:', err);
      throw err;
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    try {
      const db = await this.getDatabase();
      if (keyword) {
        await db
          .prepare(
            'DELETE FROM search_history WHERE username = ? AND keyword = ?'
          )
          .bind(userName, keyword)
          .run();
      } else {
        await db
          .prepare('DELETE FROM search_history WHERE username = ?')
          .bind(userName)
          .run();
      }
    } catch (err) {
      console.error('Failed to delete search history:', err);
      throw err;
    }
  }

  // 用户列表
  async getAllUsers(): Promise<string[]> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT username FROM users ORDER BY created_at ASC')
        .all<{ username: string }>();

      return result.results.map((row) => row.username);
    } catch (err) {
      console.error('Failed to get all users:', err);
      throw err;
    }
  }

  // 管理员配置相关
  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare('SELECT config FROM admin_config WHERE id = 1')
        .first<{ config: string }>();

      if (!result) return null;

      return JSON.parse(result.config) as AdminConfig;
    } catch (err) {
      console.error('Failed to get admin config:', err);
      throw err;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'INSERT OR REPLACE INTO admin_config (id, config) VALUES (1, ?)'
        )
        .bind(JSON.stringify(config))
        .run();
    } catch (err) {
      console.error('Failed to set admin config:', err);
      throw err;
    }
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT * FROM skip_configs WHERE username = ? AND source = ? AND id_video = ?'
        )
        .bind(userName, source, id)
        .first<any>();

      if (!result) return null;

      return {
        enable: Boolean(result.enable),
        intro_time: result.intro_time,
        outro_time: result.outro_time,
      };
    } catch (err) {
      console.error('Failed to get skip config:', err);
      throw err;
    }
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO skip_configs 
          (username, source, id_video, enable, intro_time, outro_time)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          userName,
          source,
          id,
          config.enable ? 1 : 0,
          config.intro_time,
          config.outro_time
        )
        .run();
    } catch (err) {
      console.error('Failed to set skip config:', err);
      throw err;
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db
        .prepare(
          'DELETE FROM skip_configs WHERE username = ? AND source = ? AND id_video = ?'
        )
        .bind(userName, source, id)
        .run();
    } catch (err) {
      console.error('Failed to delete skip config:', err);
      throw err;
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    try {
      const db = await this.getDatabase();
      const result = await db
        .prepare(
          'SELECT source, id_video, enable, intro_time, outro_time FROM skip_configs WHERE username = ?'
        )
        .bind(userName)
        .all<any>();

      const configs: { [key: string]: SkipConfig } = {};

      result.results.forEach((row) => {
        const key = `${row.source}+${row.id_video}`;
        configs[key] = {
          enable: Boolean(row.enable),
          intro_time: row.intro_time,
          outro_time: row.outro_time,
        };
      });

      return configs;
    } catch (err) {
      console.error('Failed to get all skip configs:', err);
      throw err;
    }
  }
}
