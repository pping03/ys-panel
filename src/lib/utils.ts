/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import Hls from 'hls.js';

/**
 * 获取图片代理 URL 设置
 */
export function getImageProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启图片代理，则不使用代理
  const enableImageProxy = localStorage.getItem('enableImageProxy');
  if (enableImageProxy !== null) {
    if (!JSON.parse(enableImageProxy) as boolean) {
      return null;
    }
  }

  const localImageProxy = localStorage.getItem('imageProxyUrl');
  if (localImageProxy != null) {
    return localImageProxy.trim() ? localImageProxy.trim() : null;
  }

  // 如果未设置，则使用全局对象
  const serverImageProxy = (window as any).RUNTIME_CONFIG?.IMAGE_PROXY;
  return serverImageProxy && serverImageProxy.trim()
    ? serverImageProxy.trim()
    : null;
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
const DOUBAN_IMG_HOST = /^https?:\/\/img\d*\.doubanio\.com\//i;
const DOUBAN_IMG_MIRRORS = [
  'https://img.doubanio.cmliussss.net/',
  'https://img.doubanio.cmliussss.com/',
];

export const IMAGE_MAX_ATTEMPT = DOUBAN_IMG_MIRRORS.length;

export function processImageUrl(originalUrl: string, attempt = 0): string {
  if (!originalUrl) return originalUrl;

  const isDouban = DOUBAN_IMG_HOST.test(originalUrl);
  if (isDouban && attempt < DOUBAN_IMG_MIRRORS.length) {
    return originalUrl.replace(DOUBAN_IMG_HOST, DOUBAN_IMG_MIRRORS[attempt]);
  }
  if (!isDouban && attempt === 0) return originalUrl;

  const proxyUrl = getImageProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

/**
 * 获取豆瓣代理 URL 设置
 */
export function getDoubanProxyUrl(): string | null {
  if (typeof window === 'undefined') return null;

  // 本地未开启豆瓣代理，则不使用代理
  const enableDoubanProxy = localStorage.getItem('enableDoubanProxy');
  if (enableDoubanProxy !== null) {
    if (!JSON.parse(enableDoubanProxy) as boolean) {
      return null;
    }
  }

  const localDoubanProxy = localStorage.getItem('doubanProxyUrl');
  if (localDoubanProxy != null) {
    return localDoubanProxy.trim() ? localDoubanProxy.trim() : null;
  }

  // 如果未设置，则使用全局对象
  const serverDoubanProxy = (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY;
  return serverDoubanProxy && serverDoubanProxy.trim()
    ? serverDoubanProxy.trim()
    : null;
}

/**
 * 处理豆瓣 URL，如果设置了豆瓣代理则使用代理
 */
export function processDoubanUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  const proxyUrl = getDoubanProxyUrl();
  if (!proxyUrl) return originalUrl;

  return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .replace(/&nbsp;/g, ' ') // 将 &nbsp; 替换为空格
    .trim(); // 去掉首尾空格
}

/**
 * 解析测速结果中的下载速度字符串（如 "2.5 MB/s"、"350.0 KB/s"），
 * 统一转换为 KB/s 数值，便于按下载速度排序。
 * 无法解析时返回 -1（无测速数据）。
 */
export function parseSpeedToKBs(speed?: string | null): number {
  if (!speed) return -1;
  const match = /^([\d.]+)\s*(KB\/s|MB\/s)$/i.exec(speed.trim());
  if (!match) return -1;
  const value = parseFloat(match[1]);
  if (!isFinite(value)) return -1;
  return /MB/i.test(match[2]) ? value * 1024 : value;
}

/**
 * 从m3u8地址获取视频质量等级和网络信息
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 视频质量等级和网络信息
 */
export async function getVideoResolutionFromM3u8(
  m3u8Url: string,
  timeoutMs?: number
): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s
  pingTime: number; // 网络延迟（毫秒）
}> {
  try {
    // 移动端浏览器对并发媒体解码限制更严格、网络也更慢，
    // 超时时间放宽到 8 秒，否则手机端测速经常全部超时"测不出结果"
    const isMobileUA =
      typeof navigator !== 'undefined' &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const effectiveTimeout = timeoutMs ?? (isMobileUA ? 8000 : 4000);

    // 直接使用m3u8 URL作为视频源，避免CORS问题
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      // iOS Safari 要求 video 元素必须插入 DOM 才会真正开始加载媒体数据，
      // 离屏隐藏挂载，避免对用户可见
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(video);

      // 统一清理：销毁 hls 实例并移除临时 video 节点
      let hlsInstance: Hls | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (hlsInstance) {
          hlsInstance.destroy();
          hlsInstance = null;
        }
        video.remove();
      };
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        done();
      };

      // 测量网络延迟（ping时间） - 使用m3u8 URL而不是ts文件
      const pingStart = performance.now();
      let pingTime = 0;
      fetch(m3u8Url, { method: 'HEAD', mode: 'no-cors' })
        .then(() => {
          pingTime = performance.now() - pingStart;
        })
        .catch(() => {
          pingTime = performance.now() - pingStart; // 记录到失败为止的时间
        });

      let actualLoadSpeed = '未知';
      let hasSpeedCalculated = false;
      let hasMetadataLoaded = false;

      // 根据视频宽度判断视频质量等级，使用经典分辨率的宽度作为分割点
      const qualityFromWidth = (width: number) =>
        width >= 3840
          ? '4K' // 4K: 3840x2160
          : width >= 2560
          ? '2K' // 2K: 2560x1440
          : width >= 1920
          ? '1080p' // 1080p: 1920x1080
          : width >= 1280
          ? '720p' // 720p: 1280x720
          : width >= 854
          ? '480p'
          : 'SD'; // 480p: 854x480

      // 检查是否可以返回结果
      const checkAndResolve = () => {
        if (
          hasMetadataLoaded &&
          (hasSpeedCalculated || actualLoadSpeed !== '未知')
        ) {
          const width = video.videoWidth;
          settle(() => {
            if (width && width > 0) {
              resolve({
                quality: qualityFromWidth(width),
                loadSpeed: actualLoadSpeed,
                pingTime: Math.round(pingTime),
              });
            } else {
              // webkit 无法获取尺寸，直接返回
              resolve({
                quality: '未知',
                loadSpeed: actualLoadSpeed,
                pingTime: Math.round(pingTime),
              });
            }
          });
        }
      };

      // 设置超时处理
      timeout = setTimeout(() => {
        settle(() => reject(new Error('Timeout loading video metadata')));
      }, effectiveTimeout);

      video.onerror = () => {
        settle(() => reject(new Error('Failed to load video metadata')));
      };

      const canNativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');

      if (Hls.isSupported()) {
        hlsInstance = new Hls({
          enableWorker: true,
          // 轻量缓冲配置：测速只需首个分片，加快首片就绪并降低内存占用
          maxBufferLength: 10,
          maxMaxBufferLength: 10,
          backBufferLength: 0,
        });

        // 监听片段加载开始
        let fragmentStartTime = 0;
        hlsInstance.on(Hls.Events.FRAG_LOADING, () => {
          fragmentStartTime = performance.now();
        });

        // 监听片段加载完成，只需首个分片即可计算速度
        hlsInstance.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
          if (
            fragmentStartTime > 0 &&
            data &&
            data.payload &&
            !hasSpeedCalculated
          ) {
            const loadTime = performance.now() - fragmentStartTime;
            const size = data.payload.byteLength || 0;

            if (loadTime > 0 && size > 0) {
              const speedKBps = size / 1024 / (loadTime / 1000);

              // 立即计算速度，无需等待更多分片
              const avgSpeedKBps = speedKBps;

              if (avgSpeedKBps >= 1024) {
                actualLoadSpeed = `${(avgSpeedKBps / 1024).toFixed(1)} MB/s`;
              } else {
                actualLoadSpeed = `${avgSpeedKBps.toFixed(1)} KB/s`;
              }
              hasSpeedCalculated = true;
              checkAndResolve(); // 尝试返回结果
            }
          }
        });

        // 监听hls.js错误
        hlsInstance.on(Hls.Events.ERROR, (event: any, data: any) => {
          console.error('HLS错误:', data);
          if (data.fatal) {
            settle(() => reject(new Error(`HLS播放失败: ${data.type}`)));
          }
        });

        hlsInstance.loadSource(m3u8Url);
        hlsInstance.attachMedia(video);
      } else if (canNativeHls) {
        // 老版 iOS 等不支持 MSE 的环境：走原生 HLS。
        // 无法拿到分片字节数（loadSpeed 保持"未知"），仅测量分辨率与延迟
        video.src = m3u8Url;
      } else {
        settle(() => reject(new Error('浏览器不支持 HLS 播放，无法测速')));
        return;
      }

      // 监听视频元数据加载完成
      video.onloadedmetadata = () => {
        if (!hlsInstance) {
          // 原生 HLS 环境：拿不到分片字节数（速度为"未知"），
          // 拿到分辨率与延迟后立即返回，避免死等触发超时
          const width = video.videoWidth;
          settle(() => {
            resolve({
              quality: width > 0 ? qualityFromWidth(width) : '未知',
              loadSpeed: '未知',
              pingTime: Math.round(pingTime),
            });
          });
          return;
        }
        hasMetadataLoaded = true;
        checkAndResolve(); // 尝试返回结果
      };
    });
  } catch (error) {
    throw new Error(
      `Error getting video resolution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
