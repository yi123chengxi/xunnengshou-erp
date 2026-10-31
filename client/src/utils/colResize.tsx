import React, { useRef, useState } from 'react';

/**
 * 表格列宽自由调整（品牌管理菜单各表格共用）：
 * 拖拽表头右边缘手柄改列宽（最小 60px），宽度按 localStorage 键持久化（区分账号/表格）。
 * 用法：
 *   const { sized } = useColResize(`xxx_cols_${owner}`);
 *   <Table columns={sized(columns)} ... />
 */
export const useColResize = (storageKey: string) => {
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { return {}; }
  });
  // ref 镜像最新宽度：mouseup 落盘不依赖 setState updater 副作用（React 可能跳过同引用 updater）
  const colWidthsRef = useRef<Record<string, number>>(colWidths);
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th');
    const startX = e.clientX;
    const startW = th ? th.offsetWidth : 120;
    const move = (ev: MouseEvent) => {
      const w = Math.max(60, startW + ev.clientX - startX);
      colWidthsRef.current = { ...colWidthsRef.current, [key]: w };
      setColWidths(colWidthsRef.current);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try { localStorage.setItem(storageKey, JSON.stringify(colWidthsRef.current)); } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  // 应用自定义列宽并在表头注入拖拽手柄
  const sized = (cols: any[]): any[] => cols.map(c => ({
    ...c,
    width: colWidths[String(c.key)] || (typeof c.width === 'number' ? c.width : undefined),
    title: (
      <span style={{ display: 'block', position: 'relative' }}>
        {c.title as React.ReactNode}
        <span
          title="拖拽调整列宽"
          onMouseDown={e => startResize(String(c.key), e)}
          onClick={e => e.stopPropagation()}
          style={{ position: 'absolute', right: -7, top: -10, bottom: -10, width: 10, cursor: 'col-resize', zIndex: 3 }}
        />
      </span>
    ),
  }));
  return { colWidths, sized };
};

export default useColResize;
