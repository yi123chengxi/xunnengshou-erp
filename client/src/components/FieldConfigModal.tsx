import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Checkbox, Space } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

export interface FieldConfigItem { key: string; label: string }

interface FieldConfigModalProps {
  open: boolean;
  fields: FieldConfigItem[];                       // 全部可选字段（含标签）
  order: string[];                                 // 当前完整顺序（可仅含可见字段）
  visibility: Record<string, boolean>;             // 当前显示状态
  onSave: (order: string[], visibility: Record<string, boolean>) => void;
  onCancel: () => void;
  title?: string;
  width?: number;
  hint?: string;
  lockedKeys?: string[];   // PERM_V2：字段查看被禁止的字段键（强制不显示且不可勾选）
}

// 统一"显示字段设置"弹窗：卡片式勾选行 + ↑↓箭头 + 鼠标长按拖动调整顺序
const FieldConfigModal: React.FC<FieldConfigModalProps> = ({
  open, fields, order, visibility, onSave, onCancel,
  title = '显示字段设置', width = 420,
  hint = '勾选要显示的字段，使用上下箭头或鼠标按住拖动调整显示顺序（拖动可一次跨越多行）',
  lockedKeys,
}) => {
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftVis, setDraftVis] = useState<Record<string, boolean>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ key: string; idx: number; startY: number; active: boolean } | null>(null);

  // 打开时用外部状态初始化草稿（补齐缺失字段到末尾）
  useEffect(() => {
    if (open) {
      const known = new Set(fields.map(f => f.key));
      const base = (order || []).filter(k => known.has(k));
      fields.forEach(f => { if (!base.includes(f.key)) base.push(f.key); });
      const vis: Record<string, boolean> = {};
      fields.forEach(f => { vis[f.key] = !!(visibility || {})[f.key]; });
      (lockedKeys || []).forEach(k => { vis[k] = false; });
      setDraftOrder(base);
      setDraftVis(vis);
      setDragKey(null);
      dragRef.current = null;
    }
  }, [open]);

  // 鼠标长按拖动排序：按下后移动超过阈值即进入拖动，按行中点插入实时重排（一次拖动可跨越多行），列表边缘自动滚动
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !listRef.current) return;
      if (!d.active) {
        if (Math.abs(e.clientY - d.startY) < 4) return;
        d.active = true;
        setDragKey(d.key);
      }
      e.preventDefault();
      const list = listRef.current;
      // 列表边缘自动滚动，保证长列表可拖到任意位置
      const lr = list.getBoundingClientRect();
      if (e.clientY < lr.top + 28) list.scrollTop -= 10;
      else if (e.clientY > lr.bottom - 28) list.scrollTop += 10;
      const rows = Array.from(list.querySelectorAll('[data-fc-row]')) as HTMLElement[];
      // 按行中点计算插入槽位：光标在某行中点之前则插入该行之前
      let insertBefore = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { insertBefore = i; break; }
      }
      setDraftOrder(prev => {
        const cur = prev.indexOf(d.key);
        if (cur < 0) return prev;
        let t = insertBefore;
        if (cur < t) t -= 1; // 移除自身后的插入下标
        if (t === cur) return prev;
        const arr = [...prev];
        arr.splice(cur, 1);
        arr.splice(t, 0, d.key);
        return arr;
      });
    };
    const up = () => {
      if (dragRef.current?.active) setDragKey(null);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const moveRow = (idx: number, dir: -1 | 1) => {
    setDraftOrder(prev => {
      const nIdx = idx + dir;
      if (nIdx < 0 || nIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[nIdx]] = [arr[nIdx], arr[idx]];
      return arr;
    });
  };

  return (
    <Modal
      title={<span><SettingOutlined style={{ marginRight: 8, color: '#1e4a7e' }} />{title}</span>}
      open={open}
      onCancel={onCancel}
      onOk={() => {
        const vis = { ...draftVis };
        (lockedKeys || []).forEach(k => { vis[k] = false; });
        onSave(draftOrder, vis);
      }}
      okText="保存"
      cancelText="取消"
      width={width}
      destroyOnClose
    >
      <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>{hint}</div>
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto', padding: 2 }}>
        {draftOrder.map((key, idx) => {
          const field = fields.find(f => f.key === key);
          if (!field) return null;
          const checked = !!draftVis[key] && !(lockedKeys || []).includes(key);
          const locked = (lockedKeys || []).includes(key);
          const dragging = dragKey === key;
          return (
            <div
              key={key}
              data-fc-row
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('button,input,label,.ant-checkbox')) return;
                dragRef.current = { key, idx, startY: e.clientY, active: false };
                e.preventDefault();
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: 6,
                background: checked ? '#f0f7ff' : '#fafafa',
                border: `1px solid ${dragging ? '#1e4a7e' : checked ? '#91d5ff' : '#f0f0f0'}`,
                cursor: 'grab',
                boxShadow: dragging ? '0 2px 8px rgba(30,74,126,0.25)' : undefined,
                userSelect: 'none',
              }}
            >
              <Checkbox
                checked={checked}
                disabled={locked}
                onChange={e => setDraftVis(prev => ({ ...prev, [key]: e.target.checked }))}
              >
                <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400 }}>{field.label}</span>
              </Checkbox>
              <Space size={2}>
                <Button size="small" type="text" disabled={idx === 0}
                  onClick={() => moveRow(idx, -1)}
                  style={{ padding: '0 4px', fontSize: 14 }}>↑</Button>
                <Button size="small" type="text" disabled={idx === draftOrder.length - 1}
                  onClick={() => moveRow(idx, 1)}
                  style={{ padding: '0 4px', fontSize: 14 }}>↓</Button>
              </Space>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

export default FieldConfigModal;
