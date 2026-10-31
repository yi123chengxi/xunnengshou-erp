import React, { useState } from 'react';
import { Modal, Input, InputNumber, Button, Space, Tag, Typography, message } from 'antd';
import { FileTextOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

/** 数量模版：规格→数量 行集合（与订单管理共用存储键 orderQtyTemplates_<owner>） */
export interface QtyTemplate {
  name: string;
  rows: { spec: string; qty: number }[];
}

export const loadQtyTemplates = (owner: string): QtyTemplate[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(`orderQtyTemplates_${owner}`) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

export const saveQtyTemplates = (owner: string, list: QtyTemplate[]): void => {
  localStorage.setItem(`orderQtyTemplates_${owner}`, JSON.stringify(list));
};

/** 数量模版管理弹窗：已保存模版标签（点击=触发填充确认）、新建模版（名称+规格行）、保存/删除 */
export const QtyTemplateManagerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  templates: QtyTemplate[];
  onChange: (list: QtyTemplate[]) => void;
  onPickTemplate: (t: QtyTemplate) => void;
}> = ({ open, onClose, templates, onChange, onPickTemplate }) => {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<{ spec: string; qty: number }[]>([{ spec: '', qty: 0 }]);

  return (
    <Modal
      title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />数量模版</span>}
      open={open} onCancel={onClose} footer={null} width={520} zIndex={1200}
    >
      <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>设置规格对应的数量模版，在添加商品时可快速填充</div>
      {templates.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ fontSize: 13 }}>已保存模版：</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {templates.map((t, i) => (
              <Tag key={`qt-${i}`} closable color="blue"
                onClose={(e: any) => { e.preventDefault(); onChange(templates.filter((_, idx) => idx !== i)); }}
                onClick={() => onPickTemplate(t)}
                style={{ cursor: 'pointer', padding: '2px 8px' }}>{t.name}</Tag>
            ))}
          </div>
        </div>
      )}
      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
        <Space style={{ marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13 }}>新建模版：</Text>
          <Input size="small" placeholder="模版名称" value={name} onChange={e => setName(e.target.value)} style={{ width: 160 }} />
        </Space>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((row, i) => (
            <Space key={i} size={4}>
              <Input size="small" placeholder="规格 (如 35)" value={row.spec}
                onChange={e => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, spec: e.target.value } : r))} style={{ width: 140 }} />
              <InputNumber controls={false} size="small" placeholder="数量" min={0} precision={0} value={row.qty}
                onChange={v => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, qty: Number(v) || 0 } : r))} style={{ width: 100 }} />
              {rows.length > 1 && (
                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                  onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} />
              )}
            </Space>
          ))}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setRows(prev => [...prev, { spec: '', qty: 0 }])}>添加规格行</Button>
          <Button size="small" type="primary" onClick={() => {
            const nm = name.trim();
            if (!nm) { message.warning('请输入模版名称'); return; }
            const validRows = rows.filter(r => r.spec.trim() && r.qty > 0);
            if (validRows.length === 0) { message.warning('请至少添加一个有效的规格和数量'); return; }
            onChange([...templates, { name: nm, rows: validRows.map(r => ({ spec: r.spec.trim(), qty: r.qty })) }]);
            setName('');
            setRows([{ spec: '', qty: 0 }]);
            message.success(`模版「${nm}」已保存`);
          }}>保存模版</Button>
        </div>
      </div>
    </Modal>
  );
};

/** 数量模版填充确认弹窗：显示各规格"数量 × 倍数 = 实际数量"，确认后由父组件回写明细 */
export const QtyFillConfirmModal: React.FC<{
  open: boolean;
  template: QtyTemplate | null;
  multiplier: number;
  onMultiplier: (v: number) => void;
  onClose: () => void;
  onConfirm: (mult: number) => void;
}> = ({ open, template, multiplier, onMultiplier, onClose, onConfirm }) => (
  <Modal
    title={<span style={{ color: PRIMARY }}><FileTextOutlined style={{ marginRight: 8 }} />填充确认</span>}
    open={open} onCancel={onClose} onOk={() => onConfirm(multiplier || 1)}
    okText="确认填充" cancelText="取消" width={420} centered zIndex={1300}
  >
    {template && (
      <div style={{ padding: '8px 0', minHeight: 120 }}>
        <div style={{ marginBottom: 12, fontSize: 14 }}>
          模版：<Text strong>{template.name}</Text>
        </div>
        <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '12px 16px', marginBottom: 16 }}>
          {template.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 13 }}>
              <span>规格 {r.spec}</span>
              <span>{r.qty} × <Text strong style={{ color: PRIMARY }}>{multiplier}</Text> = <Text strong style={{ color: '#f5222d' }}>{r.qty * (multiplier || 1)}</Text></span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text>填充倍数：</Text>
          <InputNumber controls={false} size="small" min={1} precision={0} value={multiplier}
            onChange={v => onMultiplier(Number(v) || 1)} style={{ width: 100 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>（实际数量 = 模版数量 × 倍数）</Text>
        </div>
      </div>
    )}
  </Modal>
);
