/* eslint-disable no-console */

/**
 * 从 User-Agent 解析出简短的设备描述，如 "Windows · Chrome"、"Android · 微信内置"。
 * 仅用于管理界面展示，可能被伪造，不做任何安全判断依据。
 */
export function parseDeviceDescription(ua: string | null | undefined): string {
  if (!ua) return '未知设备';

  // 操作系统
  let os = '';
  if (/Windows NT|Windows Phone/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  // 浏览器（按特征串从特殊到一般匹配，避免 Chrome/Safari 互相误判）
  let browser = '';
  if (/MicroMessenger/i.test(ua)) browser = '微信内置';
  else if (/Edg(e|A|iOS)\//i.test(ua)) browser = 'Edge';
  else if (/QQBrowser/i.test(ua)) browser = 'QQ浏览器';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  const desc = [os, browser].filter(Boolean).join(' · ');
  return desc || '未知设备';
}
