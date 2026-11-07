/**
 * 退货登记弹窗（供应商账单明细 / 采购商采购账单 共用）
 *
 * - 登记退货单：退货单号自动生成（RT- 前缀）、选择对方（采购商/供应商）、可关联原出库单号（选中后预填明细）、退货原因；
 * - 明细行录入退货数量（正数）与单价，金额自动计算；提交时由调用方落为「负数退货账单」并镜像同步对方平台；
 * - 明细录入增强（与账单明细新增账单弹窗同口径）：添加商品（商品主数据多选带入）、显示字段（勾选显隐+▲▼调序，按租户持久化）、
 *   数量模版（与新增账单共用 billQtyTemplates_<owner> 模版库，按规格匹配填充退货数量）；
 * - 库存联动由调用方完成：供应商侧退货仓入库（purchase_receiving_）、采购商侧退货出库（inventory_outbound_）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, Button, DatePicker, Select, InputNumber, Table, Space, Alert, Typography, Popover, Checkbox, Tag, message } from 'antd';
import {
  PlusOutlined, DeleteOutlined, RollbackOutlined, SettingOutlined, ShoppingOutlined,
  FileTextOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { generateDocNo } from '../utils/stockUtils';
import { getDataOwner } from '../utils/brandAuth';
import { loadProductMasterMap, resolveItemColorSpec } from '../utils/billItemsExport';
import ProductPickModal from './ProductPickModal';

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

// 明细表字段定义（显示字段控制口径）
const ALL_COLS = [
  { key: 'productCode', title: '商品编码' },
  { key: 'productName', title: '商品名称' },
  { key: 'color', title: '颜色' },
  { key: 'spec', title: '规格' },
  { key: 'quantity', title: '退货数量' },
  { key: 'unitPrice', title: '单价' },
  { key: 'amount', title: '退货金额' },
];
const DEF_KEYS = ALL_COLS.map(c => c.key);

interface QtyTemplate { name: string; rows: { spec: string; qty: number }[] }

const ReturnRegisterModal: React.FC<{
  open: boolean;
  onClose: () => void;
  side: 'supplier' | 'purchaser';
  counterpartyOptions: { value: string; label: string }[];
  linkedBillOptions: ReturnLinkedBillOption[];
  onSubmit: (p: ReturnRegisterPayload) => void;
}> = ({ open, onClose, side, counterpartyOptions, linkedBillOptions, onSubmit }) => {
  const owner = useMemo(() => getDataOwner(), []);
  const [returnNo, setReturnNo] = useState('');
  const [date, setDate] = useState(dayjs());
  const [counterparty, setCounterparty] = useState('');
  const [linked, setLinked] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<ReturnRegisterItem[]>([emptyRow()]);
  // 勾选行（数量模版填充仅作用于勾选行，与账单明细新增弹窗口径一致）
  const [checkedRows, setCheckedRows] = useState<Set<number>>(new Set());

  // 显示字段配置（按租户持久化，与新增账单弹窗同形态）
  const [colConfig, setColConfig] = useState<{ keys: string[]; visible: string[] }>(() => {
    const def = { keys: [...DEF_KEYS], visible: [...DEF_KEYS] };
    try {
      const saved = localStorage.getItem(`returnRegColConfig_${getDataOwner()}`);
      if (saved) {
        const p = JSON.parse(saved);
        const keys = DEF_KEYS.filter(k => (p?.keys || []).includes(k));
        const visible = DEF_KEYS.filter(k => (p?.visible || []).includes(k));
        if (keys.length && visible.length) return { keys, visible };
      }
    } catch { /* ignore */ }
    return def;
  });
  const [colPopover, setColPopover] = useState(false);
  const saveColConfig = (next: { keys: string[]; visible: string[] }) => {
    setColConfig(next);
    try { localStorage.setItem(`returnRegColConfig_${owner}`, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // 添加商品（商品主数据多选）
  const [pickVisible, setPickVisible] = useState(false);
  const [pickSelected, setPickSelected] = useState<string[]>([]);
  const [pickSearch, setPickSearch] = useState('');

  // 数量模版（与账单明细新增弹窗共用模版库 billQtyTemplates_<owner>）
  const [qtyTemplates, setQtyTemplates] = useState<QtyTemplate[]>(() => {
    try {
      const saved = localStorage.getItem(`billQtyTemplates_${getDataOwner()}`);
      const p = saved ? JSON.parse(saved) : [];
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  });
  const [qtyTplVisible, setQtyTplVisible] = useState(false);
  const [qtyTplName, setQtyTplName] = useState('');
  const [qtyTplRows, setQtyTplRows] = useState<{ spec: string; qty: number }[]>([{ spec: '', qty: 0 }]);
  const [qtyFillVisible, setQtyFillVisible] = useState(false);
  const [qtyFillTemplate, setQtyFillTemplate] = useState<QtyTemplate | null>(null);
  const [qtyFillMultiplier, setQtyFillMultiplier] = useState<number>(1);

  const saveQtyTemplates = (arr: QtyTemplate[]) => {
    setQtyTemplates(arr);
    try { localStorage.setItem(`billQtyTemplates_${owner}`, JSON.stringify(arr)); } catch { /* ignore */ }
  };

  const counterpartyLabel = side === 'supplier' ? '采购商' : '供应商';

  useEffect(() => {
    if (!open) return;
    setReturnNo(generateDocNo('RT'));
    setDate(dayjs());
    setCounterparty('');
    setLinked('');
    setReason('');
    setItems([emptyRow()]);
    setCheckedRows(new Set());
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
      setCheckedRows(new Set(opt.items.map((_, i) => i))); // 预填明细默认全勾选（与新增账单选单填充口径一致）
    }
  };

  // 添加商品：从本租户商品主数据多选带入（优先填空行）
  const handlePickOk = () => {
    if (pickSelected.length === 0) { message.warning('请选择至少一个商品'); return; }
    const master = loadProductMasterMap(owner);
    const mapped = pickSelected.map(code => {
      const p = master.get(String(code || ''));
      const cs = resolveItemColorSpec(p || { productCode: code }, master);
      return {
        productCode: String(code || ''),
        productName: cs.productName || '',
        color: cs.color || '',
        spec: cs.spec || '',
        quantity: 1,
        unitPrice: Number(p?.suggestedPrice) || 0,
      } as ReturnRegisterItem;
    });
    setItems(prev => {
      const next = prev.map(r => ({ ...r }));
      mapped.forEach(m => {
        const idx = next.findIndex(r => !String(r.productCode || '').trim());
        if (idx >= 0) next[idx] = m; else next.push(m);
      });
      return next;
    });
    setPickVisible(false);
    setPickSelected([]);
    message.success(`已添加 ${mapped.length} 个商品`);
  };

  // 数量模版填充：按规格/编码匹配勾选明细行，数量=模版数量×倍数（与新增弹窗仅填充勾选行一致）
  const handleQtyFill = () => {
    if (!qtyFillTemplate) return;
    const mult = qtyFillMultiplier || 1;
    const findMatch = (it: ReturnRegisterItem) => qtyFillTemplate.rows.find(r => {
      const spec = String(r.spec).trim();
      const pc = String(it.productCode || '').trim();
      const sp = String(it.spec || '').trim();
      return spec === pc || spec === sp || (pc && pc.includes(spec)) || (sp && sp.includes(spec));
    });
    let filled = 0;
    setItems(prev => prev.map((it, idx) => {
      if (!checkedRows.has(idx)) return it;
      const match = findMatch(it);
      if (match) { filled++; return { ...it, quantity: match.qty * mult }; }
      return it;
    }));
    setQtyFillVisible(false);
    Modal.success({
      title: '填充成功',
      centered: true,
      width: 420,
      zIndex: 1300,
      content: (
        <div style={{ minHeight: 80, paddingTop: 8 }}>
          <div style={{ fontSize: 15, marginBottom: 12 }}>已应用模版「<Text strong>{qtyFillTemplate.name}</Text>」× <Text strong style={{ color: '#1890ff' }}>{mult}</Text></div>
          <div style={{ fontSize: 14 }}>共填充 <Text strong style={{ color: '#52c41a', fontSize: 18 }}>{filled}</Text> 条商品</div>
        </div>
      ),
      okText: '知道了',
    });
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

  // 明细表列定义（按显示字段配置过滤）
  const colDefs: Record<string, any> = {
    productCode: { title: '商品编码', dataIndex: 'productCode', width: 130, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { productCode: e.target.value })} placeholder="商品编码" /> },
    productName: { title: '商品名称', dataIndex: 'productName', width: 120, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { productName: e.target.value })} placeholder="名称" /> },
    color: { title: '颜色', dataIndex: 'color', width: 80, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { color: e.target.value })} /> },
    spec: { title: '规格', dataIndex: 'spec', width: 90, render: (v: string, _r: ReturnRegisterItem, i: number) => <Input size="small" value={v} onChange={e => updateItem(i, { spec: e.target.value })} /> },
    quantity: { title: '退货数量', dataIndex: 'quantity', width: 90, render: (v: number, _r: ReturnRegisterItem, i: number) => <InputNumber size="small" controls={false} min={0} value={v} onChange={val => updateItem(i, { quantity: Number(val) || 0 })} style={{ width: '100%' }} /> },
    unitPrice: { title: '单价', dataIndex: 'unitPrice', width: 90, render: (v: number, _r: ReturnRegisterItem, i: number) => <InputNumber size="small" controls={false} min={0} precision={2} value={v} onChange={val => updateItem(i, { unitPrice: Number(val) || 0 })} style={{ width: '100%' }} /> },
    amount: { title: '退货金额', key: 'amt', width: 100, align: 'center', render: (_v: any, r: ReturnRegisterItem) => <Text style={{ color: '#cf1322' }}>-{((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)).toFixed(2)}</Text> },
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="确认登记退货"
      cancelText="取消"
      width={960}
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
          {
            title: <Checkbox
              checked={items.length > 0 && checkedRows.size === items.length}
              indeterminate={checkedRows.size > 0 && checkedRows.size < items.length}
              onChange={e => { if (e.target.checked) setCheckedRows(new Set(items.map((_, i) => i))); else setCheckedRows(new Set()); }}
            />,
            width: 36, align: 'center',
            render: (_v: any, _r: ReturnRegisterItem, i: number) => <Checkbox checked={checkedRows.has(i)} onChange={e => { const s = new Set(checkedRows); if (e.target.checked) s.add(i); else s.delete(i); setCheckedRows(s); }} />,
          },
          ...colConfig.keys.filter(k => colConfig.visible.includes(k)).map(k => colDefs[k]),
          { title: '', key: 'op', width: 40, render: (_v: any, _r: ReturnRegisterItem, i: number) => <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => {
            setItems(prev => (prev.length > 1 ? prev.filter((_, x) => x !== i) : prev));
            setCheckedRows(prev => { const s = new Set<number>(); prev.forEach(idx => { if (idx < i) s.add(idx); else if (idx > i) s.add(idx - 1); }); return s; });
          }} /> },
        ]}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setItems(prev => [...prev, emptyRow()])}>添加明细行</Button>
        <Button size="small" icon={<ShoppingOutlined />} onClick={() => { setPickSelected([]); setPickSearch(''); setPickVisible(true); }}>添加商品</Button>
        {/* 显示字段控制：勾选显隐 + ▲▼调序 + 恢复默认，按租户持久化 */}
        <Popover
          open={colPopover}
          onOpenChange={setColPopover}
          trigger="click"
          placement="bottomLeft"
          content={(() => {
            const ordered = colConfig.keys.map(k => ALL_COLS.find(c => c.key === k)).filter(Boolean) as { key: string; title: string }[];
            return (
              <div style={{ width: 200, maxHeight: 320, overflowY: 'auto' }}>
                {ordered.map((col, idx) => (
                  <div key={col.key} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', gap: 4 }}>
                    <Checkbox
                      checked={colConfig.visible.includes(col.key)}
                      onChange={e => {
                        const next = { ...colConfig };
                        next.visible = e.target.checked ? [...next.visible, col.key] : next.visible.filter(k => k !== col.key);
                        if (!next.visible.length) { message.warning('至少保留一个显示字段'); return; }
                        saveColConfig(next);
                      }}
                    />
                    <span style={{ flex: 1, fontSize: 12 }}>{col.title}</span>
                    <Button type="text" size="small" disabled={idx === 0} icon={<ArrowUpOutlined />} style={{ padding: '0 2px', fontSize: 10 }}
                      onClick={() => { const keys = [...colConfig.keys]; [keys[idx - 1], keys[idx]] = [keys[idx], keys[idx - 1]]; saveColConfig({ ...colConfig, keys }); }} />
                    <Button type="text" size="small" disabled={idx === ordered.length - 1} icon={<ArrowDownOutlined />} style={{ padding: '0 2px', fontSize: 10 }}
                      onClick={() => { const keys = [...colConfig.keys]; [keys[idx], keys[idx + 1]] = [keys[idx + 1], keys[idx]]; saveColConfig({ ...colConfig, keys }); }} />
                  </div>
                ))}
                <div style={{ marginTop: 6, borderTop: '1px solid #f0f0f0', paddingTop: 6 }}>
                  <Button size="small" onClick={() => saveColConfig({ keys: [...DEF_KEYS], visible: [...DEF_KEYS] })}>恢复默认</Button>
                </div>
              </div>
            );
          })()}
        >
          <Button size="small" icon={<SettingOutlined />}>显示字段</Button>
        </Popover>
        <Button size="small" icon={<FileTextOutlined />} onClick={() => setQtyTplVisible(true)}>数量模版</Button>
        {/* 已保存的模板快捷按键：点击打开填充确认 */}
        {qtyTemplates.map((t, i) => (
          <Tag key={`qt-${i}`} color="blue" style={{ cursor: 'pointer', margin: 0 }}
            onClick={() => { setQtyFillTemplate(t); setQtyFillMultiplier(1); setQtyFillVisible(true); }}
            closable onClose={(e: any) => { e.preventDefault(); e.stopPropagation(); saveQtyTemplates(qtyTemplates.filter((_, idx) => idx !== i)); }}>
            {t.name}
          </Tag>
        ))}
        <div style={{ flex: 1 }} />
        <Space size={16}>
          <Text style={{ fontSize: 12 }}>退货总数量：<Text strong style={{ color: '#cf1322' }}>-{totalQty}</Text></Text>
          <Text style={{ fontSize: 12 }}>退货总金额：<Text strong style={{ color: '#cf1322' }}>-¥{totalAmount.toFixed(2)}</Text></Text>
        </Space>
      </div>

      {/* 添加商品：本租户商品主数据多选 */}
      <ProductPickModal open={pickVisible} title="选择商品编码（可多选）" mode="code" owner={owner}
        selected={pickSelected} setSelected={setPickSelected}
        search={pickSearch} setSearch={setPickSearch}
        onClose={() => setPickVisible(false)} onOk={handlePickOk} />

      {/* 数量模版管理弹窗（与新增账单共用模版库） */}
      <Modal title={<span style={{ color: '#cf1322' }}><FileTextOutlined style={{ marginRight: 8 }} />数量模版</span>}
        open={qtyTplVisible} onCancel={() => setQtyTplVisible(false)} footer={null} width={520} zIndex={1200}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>设置规格对应的数量模版，在退货明细中可快速填充</div>
        {qtyTemplates.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ fontSize: 13 }}>已保存模版：</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {qtyTemplates.map((t, i) => (
                <Tag key={i} closable color="blue"
                  onClose={(e: any) => { e.preventDefault(); saveQtyTemplates(qtyTemplates.filter((_, idx) => idx !== i)); }}
                  onClick={() => { setQtyTplVisible(false); setQtyFillTemplate(t); setQtyFillMultiplier(1); setQtyFillVisible(true); }}
                  style={{ cursor: 'pointer', padding: '2px 8px' }}>{t.name}</Tag>
              ))}
            </div>
          </div>
        )}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>新建模版：</Text>
            <Input size="small" placeholder="模版名称" value={qtyTplName} onChange={e => setQtyTplName(e.target.value)} style={{ width: 160 }} />
          </Space>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {qtyTplRows.map((row, i) => (
              <Space key={i} size={4}>
                <Input size="small" placeholder="规格" value={row.spec} onChange={e => { const arr = [...qtyTplRows]; arr[i] = { ...arr[i], spec: e.target.value }; setQtyTplRows(arr); }} style={{ width: 120 }} />
                <InputNumber size="small" controls={false} min={0} placeholder="数量" value={row.qty || undefined} onChange={v => { const arr = [...qtyTplRows]; arr[i] = { ...arr[i], qty: Number(v) || 0 }; setQtyTplRows(arr); }} style={{ width: 100 }} />
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setQtyTplRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)} />
              </Space>
            ))}
          </div>
          <Space style={{ marginTop: 8 }}>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setQtyTplRows(prev => [...prev, { spec: '', qty: 0 }])}>添加行</Button>
            <Button size="small" type="primary" style={{ color: '#fff' }} disabled={!qtyTplName.trim() || qtyTplRows.some(r => !r.spec.trim())}
              onClick={() => {
                const newT = { name: qtyTplName.trim(), rows: qtyTplRows.filter(r => r.spec.trim()) };
                saveQtyTemplates([...qtyTemplates, newT]);
                setQtyTplName(''); setQtyTplRows([{ spec: '', qty: 0 }]);
                message.success(`模版「${newT.name}」已保存`);
              }}>保存模版</Button>
          </Space>
        </div>
      </Modal>

      {/* 数量模版填充确认弹窗 */}
      <Modal title={<span style={{ color: '#cf1322' }}><FileTextOutlined style={{ marginRight: 8 }} />填充确认</span>}
        open={qtyFillVisible} onCancel={() => setQtyFillVisible(false)} onOk={handleQtyFill}
        okText="确认填充" cancelText="取消" width={420} centered zIndex={1200}>
        {qtyFillTemplate && (
          <div style={{ padding: '8px 0', minHeight: 100 }}>
            <div style={{ marginBottom: 12, fontSize: 14 }}>模版：<Text strong>{qtyFillTemplate.name}</Text></div>
            <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '12px 16px', marginBottom: 16 }}>
              {qtyFillTemplate.rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 13 }}>
                  <span>规格 {r.spec}</span>
                  <span>{r.qty} × <Text strong style={{ color: '#1890ff' }}>{qtyFillMultiplier}</Text> = <Text strong style={{ color: '#cf1322' }}>{r.qty * (qtyFillMultiplier || 1)}</Text></span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text>填充倍数：</Text>
              <InputNumber size="small" min={1} precision={0} value={qtyFillMultiplier} onChange={v => setQtyFillMultiplier(Number(v) || 1)} style={{ width: 90 }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>仅填充勾选的明细行（按规格/商品编码匹配）</div>
          </div>
        )}
      </Modal>
    </Modal>
  );
};

export default ReturnRegisterModal;
