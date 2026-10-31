import React, { useRef } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

interface KeepAliveOutletProps {
  /** 当前打开标签页的路径列表：用于清除已关闭标签的保活缓存 */
  cacheKeys?: string[];
  /** Outlet 上下文（与原 <Outlet context={...} /> 一致） */
  context?: unknown;
}

/**
 * 标签页保活 Outlet：按路径缓存路由元素，已打开的页面切走后保持挂载（display:none 隐藏），
 * 切回已打开的标签时不再重新挂载/刷新，停留在之前的状态（筛选、滚动、草稿等），减少重复渲染开销。
 */
const KeepAliveOutlet: React.FC<KeepAliveOutletProps> = ({ cacheKeys, context }) => {
  const location = useLocation();
  const outlet = useOutlet(context);
  const cacheRef = useRef<Map<string, React.ReactElement>>(new Map());
  // 记录当前路径的路由元素；切走后复用缓存保持组件实例不卸载
  if (outlet) cacheRef.current.set(location.pathname, outlet as React.ReactElement);
  // 清除已关闭标签的缓存（仅保留打开中的标签路径与当前路径）
  if (cacheKeys) {
    for (const key of Array.from(cacheRef.current.keys())) {
      if (key !== location.pathname && !cacheKeys.includes(key)) cacheRef.current.delete(key);
    }
  }
  return (
    <>
      {Array.from(cacheRef.current.entries()).map(([path, el]) => (
        <div key={path} style={{ display: path === location.pathname ? 'contents' : 'none' }}>
          {el}
        </div>
      ))}
    </>
  );
};

export default KeepAliveOutlet;
