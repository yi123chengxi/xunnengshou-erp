import React, { useState, useEffect, useCallback } from 'react';
import type { ColumnsType } from 'antd/es/table';

const PRIMARY = '#1e4a7e';

/**
 * 为 Ant Design Table 列添加拖拽调整宽度功能。
 * @param storageKey localStorage 持久化 key（为空则不持久化）
 * @returns { colWidths, handleResizeStart, wrapColumns }
 */
export default function useResizableColumns<T = any>(storageKey: string) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<{ colKey: string; startX: number; startWidth: number } | null>(null);

  // 初始化：从 localStorage 读取保存的列宽
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setColWidths(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [storageKey]);

  // 拖拽开始
  const handleResizeStart = useCallback((e: React.MouseEvent, colKey: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingCol({ colKey, startX: e.clientX, startWidth: currentWidth });
  }, []);

  // 拖拽中 & 结束
  useEffect(() => {
    if (!resizingCol) return;
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizingCol.startX;
      const newWidth = Math.max(60, resizingCol.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizingCol.colKey]: newWidth }));
    };
    const handleMouseUp = () => {
      setResizingCol(null);
      if (storageKey) {
        try { localStorage.setItem(storageKey, JSON.stringify(colWidths)); } catch { /* ignore */ }
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, colWidths, storageKey]);

  /**
   * 包装 columns：应用自定义宽度 + 居中对齐 + 拖拽手柄
   */
  const wrapColumns = useCallback((columns: ColumnsType<T>): ColumnsType<T> => {
    return columns.map((col: any) => {
      if (col.children && col.children.length) {
        return { ...col, children: wrapColumns(col.children) };
      }
      const customWidth = colWidths[col.key];
      const wrapped: any = {
        ...col,
        width: customWidth || col.width,
        align: col.align || 'center',
      };
      // 操作列不加拖拽手柄
      if (col.key === 'action') return wrapped;
      const currentWidth = customWidth || col.width || 120;
      const headerAlign = col.align === 'right' ? 'right' : col.align === 'left' ? 'left' : 'center';
      wrapped.title = (
        <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: headerAlign }}>{typeof col.title === 'function' ? col.title() : col.title}</span>
          <span
            onMouseDown={(e: React.MouseEvent) => handleResizeStart(e, col.key, currentWidth)}
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize',
              background: resizingCol?.colKey === col.key ? PRIMARY : 'transparent',
              borderRadius: 2, zIndex: 10,
            }}
          />
        </span>
      );
      return wrapped;
    });
  }, [colWidths, resizingCol, handleResizeStart]);

  return { colWidths, handleResizeStart, wrapColumns };
}
