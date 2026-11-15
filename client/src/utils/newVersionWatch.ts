/**
 * 长开标签页自愈：部署新版本后，仍开着的旧标签页不会自动换包（index.html 虽为
 * no-cache，但不刷新就永远跑内存里的旧 JS），用户会继续看到"修复过的 bug 依旧"。
 * 这里轮询 /asset-manifest.json 比对 main chunk 哈希，发现新版本时弹常驻提示一键刷新。
 */
import React from 'react';
import { Button, notification } from 'antd';

const MAIN_RE = /\/static\/js\/main\.[0-9a-f]+\.js/;

/** 当前标签页实际加载的 main 包文件名（含内容哈希） */
const currentMainAsset = (): string => {
  try {
    const src = Array.from(document.scripts)
      .map(s => s.getAttribute('src') || '')
      .find(s => MAIN_RE.test(s));
    return src ? src.split('/').pop() || '' : '';
  } catch { return ''; }
};

const latestMainAsset = async (): Promise<string> => {
  const res = await fetch(`/asset-manifest.json?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return '';
  const manifest = await res.json().catch(() => null);
  const path = String(manifest?.files?.['main.js'] || '');
  return path.split('/').pop() || '';
};

export const startNewVersionWatch = (): void => {
  const base = currentMainAsset();
  if (!base) return;
  let notified = false;
  const check = async (): Promise<void> => {
    if (notified) return;
    try {
      const latest = await latestMainAsset();
      if (!latest || latest === base) return;
      notified = true;
      notification.info({
        key: 'new-version-available',
        message: '系统已发布新版本',
        description: '当前标签页仍是旧版本，新功能与修复不会生效，请点击刷新加载最新版本。',
        duration: 0,
        btn: React.createElement(Button, { type: 'primary', onClick: () => window.location.reload() }, '立即刷新'),
      });
    } catch { /* 网络异常/manifest 不可用时静默跳过 */ }
  };
  window.setInterval(() => { void check(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
};
