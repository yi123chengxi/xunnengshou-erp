/**
 * 退货登记弹窗（供应商账单明细 / 采购商采购账单 共用）
 *
 * - 登记退货单：退货单号自动生成（RT- 前缀）、选择对方（采购商/供应商）、可关联原出库单号（选中后预填明细）、退货原因；
 * - 明细行录入退货数量（正数）与单价，金额自动计算；提交时由调用方落为「负数退货账单」并镜像同步对方平台；
 * - 库存联动由调用方完成：供应商侧退货仓入库（purchase_receiving_）、采购商侧退货出库（inventory_outbound_）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, Button, DatePicker, Select, InputNumber, Table, Space, Alert, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { generateDocNo } from '../utils/stockUtils';

const { Text } = Typography;

export interface ReturnRegisterItem {
  productCode: string;
  productName: string;
  color: string;
  spec: string;
  quantity: number;   // 退货数量（正数，落库时由调用方取负）
  unitPrice: number;
}

export interface ReturnRegisterPayload {
  returnNo: string;
  date: string;                 // YYYY-MM-DD
  counterpartyUsername: string; // 对方账号（采购商/供应商）
  counterpartyName: string;     // 对方公司名称
  linkedOutboundNo: string;     // 关联原出库单号（可空）
  reason: string;
  items: ReturnRegisterItem[];
  totalQty: number;             // 退货总数量（正数）
  totalAmount: number;          // 退货总金额（正数，落库时取负）
}

export interface ReturnLinkedBillOption {
  value: string;
  label: string;
  items: ReturnRegisterItem[];
}

const emptyRow = (): ReturnRegisterItem => ({ productCode: '', productName: '', color: '', spec: '', quantity: 1, unitPrice: 0 });

const ReturnRegisterModal: React.FC<{
  open: boolean;
  onClose: () => void;
  side: 'supplier' | 'purchaser';
  counterpartyOptions: { value: string; label: string }[];
  linkedBillOptions: ReturnLinkedBillOption[];
  onSubmit: (p: ReturnRegisterPayload) => void;
}> = ({ open, onClose, side, counterpartyOptions, linkedBillOptions, onSubmit }) => {
  const [returnNo, setReturnNo] = useState('');
  const [date, setDate] = useState(dayjs());
  const [counterparty, setCounterparty] = useState('');
  const [linked, setLinked] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<ReturnRegisterItem[]>([emptyRow()]);

  const counterpartyLabel = side === 'supplier' ? '采购商' : '供应商';

  useEffect(() => {
    if (!open) return;
    setReturnNo(generateDocNo('RT'));
    setDate(dayjs());
    setCounterparty('');
    setLinked('');
    setReason('');
    setItems([emptyRow()]);
  }, [open]);

  const updateItem = (idx: number, patch: Partial<ReturnRegisterItem>) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  // 关联原出库单号 → 预填明细（退货数量默认等于原单数量，可改）
  const handleLinkedChange = (v: string) => {
    setLinked(v);
    const opt = linkedBillOptions.find(o => o.value === v);
    if (opt && opt.items.length > 0) {
      setItems(opt.items.map(it => ({ ...it, quantity: Math.abs(Number(it.quantity) || 0) || 1, unitPrice: Math.abs(Number(it.unitPrice) || 0) })));
    }
  };

  const validItems = useMemo(() => items.filter(it => String(it.productCode || '').trim() && (Number(it.quantity) || 0) > 0), [items]);
  const totalQty = useMemo(() => validItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0), [validItems]);
  const totalAmount = useMemo(() => Math.round(validItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0) * 100) / 100, [validItems]);

  const handleSubmit = () => {
    if (!counterparty) { Modal.warning({ title: `请选择${counterpartyLabel}`, centered: true }); return; }
    if (validItems.length === 0) { Modal.warning({ title: '请至少录入一行退货明细（商品编码 + 退货数量）', centered: true }); return; }
    const cp = counterpartyOptions.find(o => o.value === counterparty);
    onSubmit({
      returnNo,
      date: date ? date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      counterpartyUsername: counterparty,
      counterpartyName: cp?.label || '',
      linkedOutboundNo: linked,
      reason: reason.trim(),
      items: validItems.map(it => ({ ...it, productCode: String(it.productCode).trim() })),
      totalQty,
      totalAmount,
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="确认登记退货"
      cancelText="取消"
      width={860}
      centered
      zIndex={1100}
      title={<span style={{ color: '#cf1322' }}><RollbackOutlined style={{ marginRight: 8 }} />退货登记（{side === 'supplier' ? '供应商平台' : '采购商平台'}）</span>}
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`登记后生成负数退货账单（账单来源：退货登记），并自动同步至${counterpartyLabel}平台；库存联动：${counterpartyLabel}侧退货出库、本侧退货仓入库。退货账单与正常账单走相同对账流程。`} />
      <Space wrap style={{ marginBottom: 12 }} size={12}>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>退货单号</Text>
          <Input value={returnNo} disabled style={{ width: 150, color: '#cf1322', fontWeight: 600 }} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>退货日期</Text>
          <DatePicker value={date} onChange={d => setDate(d || dayjs())} style={{ width: 140 }} allowClear={false} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{counterpartyLabel}（必填）</Text>
          <Select showSearch optionFilterProp="label" value={counterparty || undefined} onChange={setCounterparty}
            placeholder={`选择${counterpartyLabel}`} style={{ width: 220 }} options={counterpartyOptions} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>关联原出库单号</Text>
          <Select showSearch allowClear optionFilterProp="label" value={linked || undefined} onChange={handleLinkedChange}
            placeholder="选择原出库账单（可空）" style={{ width: 260 }} options={linkedBillOptions} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>退货原因</Text>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="如：质量问题 / 客户拒收" style={{ width: 200 }} />
        </div>
      </Space>
      <Table bordered size="small" pagination={false} rowKey={(_r, i) => String(i)}
        dataSource={items}
        columns={[
          { title: '商品编码', dataIndex: 'productCode', width: 130, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { productCode: e.target.value })} placeholder="商品编码" /> },
          { title: '商品名称', dataIndex: 'productName', width: 120, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { productName: e.target.value })} placeholder="名称" /> },
          { title: '颜色', dataIndex: 'color', width: 80, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { color: e.target.value })} /> },
          { title: '规格', dataIndex: 'spec', width: 90, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { spec: e.target.value })} /> },
          { title: '退货数量', dataIndex: 'quantity', width: 90, render: (v: number, _r: ReturnRegisterItem, i: number) => <InputNumber size="small" controls={false} min={0} value={v} onChange={val => updateItem(i, { quantity: Number(val) || 0 })} style={{ width: '100%' }} /> },
          { title: '单价', dataIndex: 'unitPrice', width: 90, render: (v: number, _r: ReturnRegisterItem, i: number) => <InputNumber size="small" controls={false} min={0} precision={2} value={v} onChange={val => updateItem(i, { unitPrice: Number(val) || 0 })} style={{ width: '100%' }} /> },
          { title: '退货金额', key: 'amt', width: 100, align: 'center', render: (_v: any, r: ReturnRegisterItem) => <Text style={{ color: '#cf1322' }}>-{((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)).toFixed(2)}</Text> },
          { title: '', key: 'op', width: 40, render: (_v: any, _r: ReturnRegisterItem, i: number) => <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setItems(prev => (prev.length > 1 ? prev.filter((_, x) => x !== i) : prev))} /> },
        ]}
      />
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setItems(prev => [...prev, emptyRow()])}>添加明细行</Button>
        <Space size={16}>
          <Text style={{ fontSize: 12 }}>退货总数量：<Text strong style={{ color: '#cf1322' }}>-{totalQty}</Text></Text>
          <Text style={{ fontSize: 12 }}>退货总金额：<Text strong style={{ color: '#cf1322' }}>-¥{totalAmount.toFixed(2)}</Text></Text>
        </Space>
      </div>
    </Modal>
  );
};

export default ReturnRegisterModal;
