/**
 * 数据写入失败可见性（配额防护组成部分）
 *
 * 背景：localStorage 配额清理后仍写不进时，写入方只能放弃本次写入，而全应用几十处调用点
 * 都按"写完即成功"给用户弹"保存成功"，于是出现"提示成功、刷新后数据消失"且无从排查的现象。
 * storageQuota 在放弃写入时广播 storage-write-failed，本模块负责把这件事当场告诉用户：
 * - 用原生 DOM 横幅而非 antd message：此处运行在 React 树之外（可能正在提交中被卸载），
 *   且与 index.tsx 里陈旧 bundle 提醒保持同一实现方式，不引入组件层依赖；
 * - 8 秒内只提示一次：批量写失败不能刷屏，但留痕键仍逐条记录（见 getWriteFailures）。
 */

export const STORAGE_WRITE_FAILED_EVENT = 'storage-write-failed';
const THROTTLE_MS = 8000;

let installed = false;
let lastShownAt = 0;

export function installStorageWriteFailureNotice(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(STORAGE_WRITE_FAILED_EVENT, (e: Event) => {
    const detail: any = (e as CustomEvent).detail || {};
    const now = Date.now();
    if (now - lastShownAt < THROTTLE_MS) return;
    lastShownAt = now;
    try {
      const div = document.createElement('div');
      const keyText = detail.key ? `（${String(detail.key).slice(0, 48)}）` : '';
      div.textContent = `本地存储空间不足，本次修改未能保存${keyText}，数据未落盘。请清理历史数据或联系管理员扩容后重试。`;
      div.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10000;background:#fff1f0;border:1px solid #ffa39e;color:#a8071a;padding:8px 16px;border-radius:6px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.15);max-width:90vw';
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 10000);
    } catch { /* DOM 不可用时静默，留痕键仍已记录 */ }
  });
}
