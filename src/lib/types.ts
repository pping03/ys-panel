import { AdminConfig } from './admin.types';

// 播放记录数据结构
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 收藏数据结构
export interface Favorite {
  source_name: string;
  total_episodes: number; // 总集数
  title: string;
  year: string;
  cover: string;
  save_time: number; // 记录保存时间（时间戳）
  search_title: string; // 搜索时使用的标题
}

// 用户访问记录
export interface UserAccessRecord {
  login_time: number; // 上线时间（登录时间戳，秒）
  ip: string; // 访问 IP
  last_active: number; // 最近活跃时间戳（秒）
}

// 用户访问统计汇总
export interface UserAccessSummary {
  logs: UserAccessRecord[]; // 最近访问记录（最多10条，新的在前）
  usage_total: number; // 累计使用时长（秒）
}

// 登录设备会话信息
export interface DeviceSessionInfo {
  device_id: string; // 设备唯一标识（浏览器持久化）
  ua: string; // 设备描述（由 User-Agent 解析，如 "Windows · Chrome"）
  session_time: number; // 最近登录时间戳（毫秒）
}

// 视频评论（整部作品一个评论区，键为归一化「标题|年份」）
export interface VideoComment {
  id: string; // 评论唯一ID
  username: string; // 评论人（本地存储模式为“我”）
  video_key: string; // 归一化作品键（buildCommentKey 生成）
  episode_index?: number; // 评论时所在的集数（1 基，可选）
  content: string; // 评论内容（≤500 字）
  created_at: number; // 评论时间戳（秒）
  role?: 'owner' | 'admin' | 'user'; // 评论人角色（仅接口返回时富化，不入库）
}

// 视频评论分页结果
export interface VideoCommentList {
  comments: VideoComment[];
  total: number;
  has_more: boolean;
}

// 存储接口
export interface IStorage {
  // 播放记录相关
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;

  // 收藏相关
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  // 检查用户是否存在（无需密码）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用户密码
  changePassword(userName: string, newPassword: string): Promise<void>;
  // 删除用户（包括密码、搜索历史、播放记录、收藏夹）
  deleteUser(userName: string): Promise<void>;

  // 搜索历史相关
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用户列表
  getAllUsers(): Promise<string[]>;

  // 管理员配置相关
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;

  // 跳过片头片尾配置相关
  getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  // 用户访问记录相关（用于管理界面的使用时长/上线时间/IP统计）
  // 记录一次上线（登录），自动只保留最近 10 条
  saveUserAccess(userName: string, record: UserAccessRecord): Promise<void>;
  // 心跳更新最近活跃时间并累计使用时长
  updateUserActivity(userName: string, nowSeconds: number): Promise<void>;
  // 读取访问统计（最近10条记录 + 累计使用秒数）
  getUserAccessSummary(userName: string): Promise<UserAccessSummary>;

  // 登录设备会话管理（按用户配置限制同账号并发登录设备数，limit <= 0 表示不限制）
  // 以 deviceId 标识一台设备；重复登录时原地更新该设备的会话时间，不额外占名额；
  // 设备数超过上限时自动淘汰最早登录的设备（不限制时只登记不淘汰）
  saveUserSession(
    userName: string,
    timestampMs: number,
    deviceId?: string,
    ua?: string,
    limit?: number
  ): Promise<void>;
  // 校验某次登录的会话是否仍有效（设备未超限被挤下线）
  // deviceId 缺省：有限制时视为失效（重新登录即可恢复），不限制时视为有效
  hasUserSession(
    userName: string,
    timestampMs: number,
    deviceId?: string,
    limit?: number
  ): Promise<boolean>;
  // 读取用户的全部登录设备（按最近登录时间倒序），供管理界面展示
  getUserDevices(userName: string): Promise<DeviceSessionInfo[]>;

  // 视频评论相关（评论区键为归一化「标题|年份」，见 buildCommentKey）
  // 分页读取某作品评论（新的在前）
  getVideoComments(
    videoKey: string,
    page: number,
    pageSize: number
  ): Promise<VideoCommentList>;
  // 读取单条评论（删除前的属主判断用）
  getVideoComment(
    videoKey: string,
    commentId: string
  ): Promise<VideoComment | null>;
  // 保存评论（comment.id/username/created_at 已由接口层生成）
  saveVideoComment(videoKey: string, comment: VideoComment): Promise<void>;
  // 删除评论
  deleteVideoComment(videoKey: string, commentId: string): Promise<void>;
}

// 搜索结果数据结构
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣数据结构
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳过片头片尾配置数据结构
export interface SkipConfig {
  enable: boolean; // 是否启用跳过片头片尾
  intro_time: number; // 片头时间（秒）
  outro_time: number; // 片尾时间（秒）
}
