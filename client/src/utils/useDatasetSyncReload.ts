import { useEffect, useRef } from 'react';

/**
 * 数据集同步的读侧统一入口（配合 KeepAliveOutlet 保活页面）。
 *
 * 保活页面切走后不卸载，组件只在挂载时读一次本地快照；而 knownTs 每 60 秒被
 * /sync/meta 轮询对齐到服务端最新版本——于是"打开后一直挂着的标签页"再执行一次
 * 整表回写，就会带着陈旧列表上传并把其他端刚新增的行整份擦掉。
 *
 * 三个入口缺一不可：
 * 1. sync-data-updated：pullAllDatasets 落地后派发（跨浏览器/跨账号同步完成）
 * 2. window focus：从别的窗口切回来
 * 3. document visibilitychange：标签页重新可见（被最小化/切走后恢复）
 *
 * reload 通过 ref 转发，调用方可以直接传内联函数而不必包 useCallback：
 * 每次渲染刷新 ref，事件回调始终调用最新一次渲染的闭包。
 */
export function useDatasetSyncReload(reload: () => void): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    const onReload = () => {
      try { reloadRef.current(); } catch { /* 单页重载失败不能影响同步链路 */ }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onReload();
    };
    window.addEventListener('sync-data-updated', onReload);
    window.addEventListener('focus', onReload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('sync-data-updated', onReload);
      window.removeEventListener('focus', onReload);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

export default useDatasetSyncReload;

/**
 * 重载辅助：内容未变时保持原引用。
 * 不少页面有「state 一变就整表写盘」的 useEffect，如果 sync/focus 触发的重载
 * 总是返回新数组，就会变成每次窗口聚焦都整表回写一次（内容虽相同也白跑上传）；
 * 这里内容相同时 bail out，React 会跳过重渲染与后续副作用。
 */
export function applyIfChanged<T>(setter: (updater: (prev: T) => T) => void, next: T): void {
  setter(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
}
