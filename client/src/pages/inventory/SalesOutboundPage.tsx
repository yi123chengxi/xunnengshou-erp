import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Modal, Tag, Tooltip,
  Popover, Checkbox, Descriptions, Divider, message, Dropdown,
} from 'antd';
import { ExportOutlined, EyeOutlined, SettingOutlined, ReloadOutlined, DownOutlined } from '@ant-design/icons';
import useResizableColumns from '../../hooks/useResizableColumns';
import { useDatasetSyncReload } from '../../utils/useDatasetSyncReload';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

interface SoItem {
  code: string;
  productName: string;
  styleCode: string;
  color: string;
  spec: string;
  unit: string;
  quantity: number;
  beforeStock: number;
  afterStock: number;
}

interface SoRecord {
  key: string;
  docNo: string;        // 出库单号
  orderId: string;      // 销售订单号
  customerName: string;
  shopName: string;     // 店铺
  receiverName: string;
  receiverAddress: string;
  productDetail: string;
  totalQty: number;
  items: SoItem[];
  operator: string;
  createTime: string;
  status: string;
  remark: string;
}

const STORAGE_KEY = (owner: string) => `sales_outbound_${owner}`;
const FIELD_KEY = (owner: string) => `sales_outbound_fields_${owner}`;

// 全部可配置字段（默认顺序即初始显示顺序）
const ALL_FIELDS: { key: string; title: string; width: number }[] = [
  { key: 'docNo', title: '出库单号', width: 150 },
  { key: 'orderId', title: '订单号', width: 140 },
  { key: 'customerName', title: '客户名称', width: 130 },
  { key: 'shopName', title: '店铺', width: 120 },
  { key: 'productDetail', title: '货品明细', width: 220 },
  { key: 'totalQty', title: '出库数量', width: 90 },
  { key: 'receiverName', title: '收货人', width: 100 },
  { key: 'operator', title: '操作人', width: 100 },
  { key: 'createTime', title: '出库时间', width: 160 },
  { key: 'status', title: '状态', width: 90 },
];

const SalesOutboundPage: React.FC = () => {
  const owner = getDataOwner();
  const [dataSource, setDataSource] = useState<SoRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY(owner)) || '[]'); } catch { return []; }
  });
  // 搜索栏（常用字段）
  const [sDocNo, setSDocNo] = useState('');
  const [sOrderId, setSOrderId] = useState('');
  const [sCustomer, setSCustomer] = useState('');
  const [sShop, setSShop] = useState('');
  const [viewRecord, setViewRecord] = useState<SoRecord | null>(null);
  const [colPopoverVisible, setColPopoverVisible] = useState(false);

  // 货品明细显示字段控制（持久化）
  const [detailDisplay, setDetailDisplay] = useState<Record<string, boolean>>(() => {
    const def = { showCode: true, showName: false, showStyleCode: false, showColor: true, showSpec: true, showUnit: false, showQty: true };
    try {
      const saved = JSON.parse(localStorage.getItem(`salesOutboundDisplay_${owner}`) || 'null');
      if (saved) return { ...def, ...saved };
    } catch { /* ignore */ }
    return def;
  });
  const [detailDisplayVisible, setDetailDisplayVisible] = useState(false);
  // 表格勾选键（导出勾选内容用）
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 字段显示与顺序（持久化）
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FIELD_KEY(owner)) || 'null');
      if (saved && Array.isArray(saved.order)) {
        const keys = ALL_FIELDS.map(f => f.key);
        const order = (saved.order as string[]).filter(k => keys.includes(k));
        keys.forEach(k => { if (!order.includes(k)) order.push(k); });
        return order;
      }
    } catch { /* ignore */ }
    return ALL_FIELDS.map(f => f.key);
  });
  const [fieldVis, setFieldVis] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FIELD_KEY(owner)) || 'null');
      if (saved && saved.vis) return { ...Object.fromEntries(ALL_FIELDS.map(f => [f.key, true])), ...saved.vis };
    } catch { /* ignore */ }
    return Object.fromEntries(ALL_FIELDS.map(f => [f.key, true]));
  });

  const persistFields = useCallback((order: string[], vis: Record<string, boolean>) => {
    setFieldOrder(order);
    setFieldVis(vis);
    try { localStorage.setItem(FIELD_KEY(owner), JSON.stringify({ order, vis })); } catch { /* ignore */ }
  }, [owner]);

  // 列宽拖拽自由调整（持久化）
  const { wrapColumns } = useResizableColumns<SoRecord>(`colWidths_salesOutbound_${owner}`);

  const refresh = useCallback(() => {
    try { setDataSource(JSON.parse(localStorage.getItem(STORAGE_KEY(owner)) || '[]')); } catch { /* ignore */ }
  }, [owner]);

  // 同步落地/窗口重新可见时重读：出库单在别端录入后本端不刷新，
  // 下一次本端出库就会拿陈旧列表整表回写，把别端刚出的单据整份覆盖
  useDatasetSyncReload(refresh);

  // 历史重复出库单号一次性修复：保留首次出现，后续重复项按同日前缀重编序号并回写存储
  useEffect(() => {
    setDataSource(prev => {
      const seen = new Set<string>();
      const heads: Record<string, number> = {};
      prev.forEach(r => {
        const m = String(r.docNo || '').match(/^(.*-\d{6})(\d+)$/);
        if (m) heads[m[1]] = Math.max(heads[m[1]] || 0, Number(m[2]) || 0);
      });
      let changed = false;
      const next = prev.map(r => {
        if (!r.docNo || !seen.has(r.docNo)) { if (r.docNo) seen.add(r.docNo); return r; }
        const m = String(r.docNo).match(/^(.*-\d{6})(\d+)$/);
        const head = m ? m[1] : `${r.docNo}-R`;
        const seq = (heads[head] || 0) + 1;
        heads[head] = seq;
        changed = true;
        return { ...r, docNo: `${head}${seq}` };
      });
      if (!changed) return prev;
      try { localStorage.setItem(STORAGE_KEY(owner), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [owner]);

  const filteredData = useMemo(() => {
    const q1 = sDocNo.trim().toLowerCase();
    const q2 = sOrderId.trim().toLowerCase();
    const q3 = sCustomer.trim().toLowerCase();
    const q4 = sShop.trim().toLowerCase();
    if (!q1 && !q2 && !q3 && !q4) return dataSource;
    return dataSource.filter(r =>
      (!q1 || (r.docNo || '').toLowerCase().includes(q1)) &&
      (!q2 || (r.orderId || '').toLowerCase().includes(q2)) &&
      (!q3 || (r.customerName || '').toLowerCase().includes(q3)) &&
      (!q4 || (r.shopName || '').toLowerCase().includes(q4))
    );
  }, [dataSource, sDocNo, sOrderId, sCustomer, sShop]);

  // 字段上移/下移
  const moveField = useCallback((key: string, dir: -1 | 1) => {
    const idx = fieldOrder.indexOf(key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= fieldOrder.length) return;
    const next = [...fieldOrder];
    [next[idx], next[target]] = [next[target], next[idx]];
    persistFields(next, fieldVis);
  }, [fieldOrder, fieldVis, persistFields]);

  // 导出CSV（rows 为导出范围：勾选内容 / 筛选结果）
  const doExport = useCallback((rows: SoRecord[]) => {
    if (rows.length === 0) { message.warning('没有可导出的记录'); return; }
    const header = '出库单号,订单号,客户名称,店铺,货品明细,出库数量,收货人,操作人,出库时间,状态\n';
    const body = rows.map(r =>
      [r.docNo, r.orderId, r.customerName, r.shopName, `"${(r.productDetail || '').replace(/"/g, '""')}"`, r.totalQty, r.receiverName, r.operator, `"${r.createTime}"`, r.status].join(',')
    ).join('\n');
    const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `销售出库单_${new Date().toLocaleDateString()}.csv`; a.click();
    message.success(`已导出 ${rows.length} 条记录`);
  }, []);

  // 导出明细CSV（展开商品行：一行一个商品编码）
  const doExportDetail = useCallback((rows: SoRecord[]) => {
    if (rows.length === 0) { message.warning('没有可导出的记录'); return; }
    const header = '出库单号,订单号,客户名称,商品编码,商品简称,款式编码,颜色,规格,单位,出库数量,出库前库存,出库后库存\n';
    const body = rows.flatMap(r => (r.items || []).map(it =>
      [r.docNo, r.orderId, r.customerName, it.code, it.productName, it.styleCode, it.color, it.spec, it.unit, it.quantity, it.beforeStock, it.afterStock].join(',')
    )).join('\n');
    const lineCount = rows.reduce((s, r) => s + (r.items || []).length, 0);
    const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `销售出库明细_${new Date().toLocaleDateString()}.csv`; a.click();
    message.success(`已导出 ${rows.length} 单共 ${lineCount} 行明细`);
  }, []);

  // 表格列：按字段顺序与显示设置生成，全部居中对齐 + 列边线 + 列宽可拖拽
  const columns = useMemo(() => {
    const defs: Record<string, any> = {
      docNo: { title: '出库单号', dataIndex: 'docNo', key: 'docNo', width: 150, render: (v: string) => <Text strong>{v}</Text> },
      orderId: { title: '订单号', dataIndex: 'orderId', key: 'orderId', width: 140 },
      customerName: { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 130 },
      shopName: { title: '店铺', dataIndex: 'shopName', key: 'shopName', width: 120, render: (v: string) => v || <Text type="secondary">—</Text> },
      productDetail: {
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            货品明细
            <a
              onClick={(e) => { e.stopPropagation(); setDetailDisplayVisible(true); }}
              style={{ color: PRIMARY, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${PRIMARY}`, borderRadius: 3, padding: '0 3px', lineHeight: '16px', textDecoration: 'none' }}
              title="控制显示内容"
            >显</a>
          </span>
        ),
        dataIndex: 'productDetail', key: 'productDetail', width: 220,
        render: (v: string, r: SoRecord) => {
          // 按显示字段配置拼接每个商品行文本
          const lines = (Array.isArray(r.items) && r.items.length > 0)
            ? r.items.map(it => {
              const parts: string[] = [];
              if (detailDisplay.showCode) parts.push(it.code || '');
              if (detailDisplay.showName) parts.push(it.productName || '');
              if (detailDisplay.showStyleCode) parts.push(it.styleCode || '');
              if (detailDisplay.showColor) parts.push(it.color || '');
              if (detailDisplay.showSpec) parts.push(it.spec || '');
              if (detailDisplay.showUnit) parts.push(it.unit || '');
              if (detailDisplay.showQty) parts.push(`×${it.quantity ?? 0}`);
              return parts.filter(Boolean).join('-');
            }).filter(Boolean)
            : [];
          const fullText = lines.length > 0 ? lines.join(', ') : (v || '');
          // 一行只显示一个商品，多行时在后面显示'多'字角标
          return (
            <a onClick={() => setViewRecord(r)} title={fullText}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{lines[0] || fullText || '查看明细'}</span>
              {lines.length > 1 && (
                <span style={{ minWidth: 16, height: 16, borderRadius: 8, background: '#1677ff', color: '#fff', fontSize: 10, lineHeight: '14px', textAlign: 'center', padding: '0 4px', border: '1px solid #fff', flexShrink: 0 }}>多</span>
              )}
            </a>
          );
        },
      },
      totalQty: { title: '出库数量', dataIndex: 'totalQty', key: 'totalQty', width: 90, render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v}</Text> },
      receiverName: { title: '收货人', dataIndex: 'receiverName', key: 'receiverName', width: 100 },
      operator: { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
      createTime: { title: '出库时间', dataIndex: 'createTime', key: 'createTime', width: 160 },
      status: { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => <Tag color="green">{v || '已发货'}</Tag> },
    };
    const cols = fieldOrder.filter(k => fieldVis[k]).map(k => ({ ...defs[k], align: 'center' as const }));
    cols.push({
      title: '操作', key: 'action', width: 90, align: 'center' as const,
      render: (_: any, r: SoRecord) => (
        <Tooltip title="查看销售出库详情（订单号/店铺/发货明细/库存扣减）">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewRecord(r)} style={{ color: PRIMARY }}>查看</Button>
        </Tooltip>
      ),
    });
    return wrapColumns(cols);
  }, [fieldOrder, fieldVis, wrapColumns, detailDisplay]);

  // 显示字段 Popover 内容（勾选显示 + 上移/下移调整顺序）
  const fieldPopoverContent = (
    <div style={{ width: 260, maxHeight: 360, overflowY: 'auto' }}>
      {fieldOrder.map(key => {
        const f = ALL_FIELDS.find(x => x.key === key)!;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
            <Checkbox
              checked={!!fieldVis[key]}
              onChange={e => persistFields(fieldOrder, { ...fieldVis, [key]: e.target.checked })}
            >
              <span style={{ fontSize: 13 }}>{f.title}</span>
            </Checkbox>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: '8px' }}>
              <a onClick={() => moveField(key, -1)} style={{ color: PRIMARY, fontSize: 10, cursor: 'pointer', userSelect: 'none' }} title="上移该字段">▲</a>
              <a onClick={() => moveField(key, 1)} style={{ color: PRIMARY, fontSize: 10, cursor: 'pointer', userSelect: 'none' }} title="下移该字段">▼</a>
            </span>
          </div>
        );
      })}
      <Divider style={{ margin: '6px 0' }} />
      <Button size="small" block onClick={() => persistFields(ALL_FIELDS.map(f => f.key), Object.fromEntries(ALL_FIELDS.map(f => [f.key, true])))}>恢复默认</Button>
    </div>
  );

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* 搜索栏 + 工具按键 */}
      <Card size="small" bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 12 }}>
        <Row gutter={8} align="middle">
          <Col><Input placeholder="出库单号" value={sDocNo} onChange={e => setSDocNo(e.target.value)} style={{ width: 150 }} allowClear /></Col>
          <Col><Input placeholder="订单号" value={sOrderId} onChange={e => setSOrderId(e.target.value)} style={{ width: 150 }} allowClear /></Col>
          <Col><Input placeholder="客户名称" value={sCustomer} onChange={e => setSCustomer(e.target.value)} style={{ width: 140 }} allowClear /></Col>
          <Col><Input placeholder="店铺" value={sShop} onChange={e => setSShop(e.target.value)} style={{ width: 130 }} allowClear /></Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={() => { setSDocNo(''); setSOrderId(''); setSCustomer(''); setSShop(''); refresh(); }}>重置</Button>
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              <Popover
                content={fieldPopoverContent}
                title="显示字段（可调整顺序）"
                trigger="click"
                open={colPopoverVisible}
                onOpenChange={setColPopoverVisible}
                placement="bottomRight"
              >
                <Button icon={<SettingOutlined />}>显示字段</Button>
              </Popover>
              <Dropdown placement="bottomRight" menu={{ items: [
                { key: 'selected', label: `导出勾选内容（${selectedKeys.length}）`, disabled: selectedKeys.length === 0, onClick: () => doExport(filteredData.filter(r => selectedKeys.includes(r.key))) },
                { key: 'filtered', label: `导出筛选结果（${filteredData.length}）`, onClick: () => doExport(filteredData) },
                { type: 'divider' as const },
                { key: 'selectedDetail', label: `导出勾选明细（${selectedKeys.length}单）`, disabled: selectedKeys.length === 0, onClick: () => doExportDetail(filteredData.filter(r => selectedKeys.includes(r.key))) },
                { key: 'filteredDetail', label: `导出筛选明细（${filteredData.length}单）`, onClick: () => doExportDetail(filteredData) },
              ] }}>
                <Button icon={<ExportOutlined />}>导出 <DownOutlined style={{ fontSize: 10 }} /></Button>
              </Dropdown>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 销售出库单表格：列边线 + 全居中 + 列宽可拖拽 */}
      <Table bordered size="small" pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        dataSource={filteredData} rowKey="key" columns={columns} scroll={{ x: 1200 }}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: keys => setSelectedKeys(keys as string[]) }} />

      {/* 货品明细显示控制弹窗 */}
      <Modal
        title="货品明细显示控制"
        open={detailDisplayVisible}
        onOk={() => { setDetailDisplayVisible(false); try { localStorage.setItem(`salesOutboundDisplay_${owner}`, JSON.stringify(detailDisplay)); } catch { /* ignore */ } }}
        onCancel={() => setDetailDisplayVisible(false)}
        okText="确定" cancelText="取消" width={360} zIndex={1200}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { key: 'showCode', label: '商品编码' },
            { key: 'showName', label: '商品简称' },
            { key: 'showStyleCode', label: '款式编码' },
            { key: 'showColor', label: '颜色' },
            { key: 'showSpec', label: '规格' },
            { key: 'showUnit', label: '单位' },
            { key: 'showQty', label: '出库数量' },
          ].map(item => (
            <Checkbox key={item.key} checked={!!detailDisplay[item.key]}
              onChange={e => setDetailDisplay(prev => ({ ...prev, [item.key]: e.target.checked }))}>
              {item.label}
            </Checkbox>
          ))}
        </div>
      </Modal>

      {/* 销售出库详情弹窗：记录订单号/店铺/发货明细/库存扣减 */}
      <Modal
        title={`销售出库详情 — ${viewRecord?.docNo || ''}`}
        open={!!viewRecord} onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>关闭</Button>}
        centered width={900} zIndex={1100}
      >
        {viewRecord && (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="出库单号">{viewRecord.docNo}</Descriptions.Item>
              <Descriptions.Item label="订单号">{viewRecord.orderId}</Descriptions.Item>
              <Descriptions.Item label="店铺">{viewRecord.shopName || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户名称">{viewRecord.customerName || '—'}</Descriptions.Item>
              <Descriptions.Item label="收货人">{viewRecord.receiverName || '—'}</Descriptions.Item>
              <Descriptions.Item label="出库数量"><Text strong style={{ color: '#ff4d4f' }}>{viewRecord.totalQty}</Text></Descriptions.Item>
              <Descriptions.Item label="收货地址" span={2}>{viewRecord.receiverAddress || '—'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="green">{viewRecord.status || '已发货'}</Tag></Descriptions.Item>
              <Descriptions.Item label="操作人">{viewRecord.operator}</Descriptions.Item>
              <Descriptions.Item label="出库时间" span={2}>{viewRecord.createTime}</Descriptions.Item>
            </Descriptions>
            <Table bordered size="small" pagination={false}
              dataSource={viewRecord.items} rowKey={(r, i) => r.code || String(i)}
              columns={[
                { title: '商品编码', dataIndex: 'code', key: 'code', width: 120, align: 'center' as const },
                { title: '商品简称', dataIndex: 'productName', key: 'productName', width: 120, align: 'center' as const },
                { title: '款式编码', dataIndex: 'styleCode', key: 'styleCode', width: 100, align: 'center' as const, render: (v: string) => v || '—' },
                { title: '颜色', dataIndex: 'color', key: 'color', width: 80, align: 'center' as const, render: (v: string) => v || '—' },
                { title: '规格', dataIndex: 'spec', key: 'spec', width: 90, align: 'center' as const, render: (v: string) => v || '—' },
                { title: '单位', dataIndex: 'unit', key: 'unit', width: 60, align: 'center' as const, render: (v: string) => v || '—' },
                { title: '出库数量', dataIndex: 'quantity', key: 'quantity', width: 90, align: 'center' as const, render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v}</Text> },
                { title: '出库前库存', dataIndex: 'beforeStock', key: 'beforeStock', width: 100, align: 'center' as const },
                { title: '出库后库存', dataIndex: 'afterStock', key: 'afterStock', width: 100, align: 'center' as const, render: (v: number) => <Text strong style={{ color: v < 0 ? '#ff4d4f' : '#52c41a' }}>{v}</Text> },
              ]}
              summary={items => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={6} align="center"><Text strong>合计</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="center"><Text strong style={{ color: '#ff4d4f' }}>{items.reduce((s, r) => s + (r.quantity || 0), 0)}</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} colSpan={2} align="center" />
                </Table.Summary.Row>
              )}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default SalesOutboundPage;
