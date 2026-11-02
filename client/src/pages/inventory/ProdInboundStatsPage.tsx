import React, { useState, useCallback, useMemo } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Select, Modal,
  InputNumber, Tag, Tooltip, message, Descriptions, Statistic, DatePicker, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EyeOutlined, ExportOutlined, InboxOutlined,
  SearchOutlined, ReloadOutlined, LinkOutlined, ProfileOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { updateProductStock, generateDocNo, getStockLogs } from '../../utils/stockUtils';
import type { StockLogEntry } from '../../utils/stockUtils';
import { getCurrentUserDisplayName } from '../../utils/billLog';

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const PRIMARY = '#1e4a7e';

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

/** 生产入库记录（由「生产订单完工」联动写入，亦支持本页手动补录） */
interface PisRecord {
  key: string;
  id: string;              // 入库单号 RK-xxxxxx
  productName: string;     // 产品名称
  productCode: string;     // 商品编码
  quantity: number;        // 入库数量
  woNo: string;            // 生产工单号（生产订单 id）
  warehouse: string;       // 入库仓库
  date: string;            // 入库日期 YYYY-MM-DD
  person: string;          // 经手人
  status: string;          // 状态：已入库
  salesOrderId?: string;   // 关联销售订单 id
  source?: 'production' | 'manual'; // 来源：生产完工联动 / 手动补录
  createTime?: string;     // 创建时间
}

const STORAGE_KEY = () => `pageData_inventory_prod-in-stats_${getDataOwner()}`;
const PRODUCT_KEY = () => `pageData_basic-data_product-list_${getDataOwner()}`;
const PROD_ORDER_KEY = () => `pageData_production_production-order_${getDataOwner()}`;

const safeJson = <T,>(raw: string | null, fallback: T): T => {
  try { const v = JSON.parse(raw || ''); return Array.isArray(v) || (v && typeof v === 'object') ? v as T : fallback; } catch { return fallback; }
};

const WAREHOUSE_COLOR: Record<string, string> = { 成品仓: 'green', 半成品仓: 'orange', 原料仓: 'blue' };

const ProdInboundStatsPage: React.FC = () => {
  const owner = getDataOwner();
  const [dataSource, setDataSource] = useState<PisRecord[]>(() => safeJson<PisRecord[]>(localStorage.getItem(STORAGE_KEY()), []));

  // 筛选（点击查询后生效）
  const [search, setSearch] = useState('');
  const [fWarehouse, setFWarehouse] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fRange, setFRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [applied, setApplied] = useState<{ q: string; wh: string; st: string; range: [string, string] | null }>({ q: '', wh: '', st: '', range: null });

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [viewRecord, setViewRecord] = useState<PisRecord | null>(null);
  const [addVisible, setAddVisible] = useState(false);

  // 手动补录表单
  const [formProduct, setFormProduct] = useState('');
  const [formQty, setFormQty] = useState(1);
  const [formWarehouse, setFormWarehouse] = useState('成品仓');
  const [formWoNo, setFormWoNo] = useState('');
  const [formDate, setFormDate] = useState(dayjs());

  // 关联数据：商品列表 / 生产订单
  const productList = useMemo<any[]>(() => safeJson<any[]>(localStorage.getItem(PRODUCT_KEY()), []), [addVisible, dataSource]);
  const prodOrders = useMemo<any[]>(() => safeJson<any[]>(localStorage.getItem(PROD_ORDER_KEY()), []), [dataSource]);

  const saveData = useCallback((list: PisRecord[]) => {
    setDataSource(list);
    try { localStorage.setItem(STORAGE_KEY(), JSON.stringify(list)); } catch { /* ignore */ }
  }, []);

  // ============ 统计 ============
  const stats = useMemo(() => {
    const now = dayjs();
    const monthData = dataSource.filter(r => dayjs(r.date).isSame(now, 'month'));
    const costOf = (code: string) => Number(productList.find(p => p.productCode === code)?.costPrice) || 0;
    return {
      total: dataSource.length,
      totalQty: dataSource.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
      amount: dataSource.reduce((s, r) => s + (Number(r.quantity) || 0) * costOf(r.productCode), 0),
      batches: new Set(dataSource.map(r => r.woNo).filter(Boolean)).size,
      monthQty: monthData.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
      products: new Set(dataSource.map(r => r.productCode).filter(Boolean)).size,
    };
  }, [dataSource, productList]);

  // ============ 筛选 ============
  const handleQuery = useCallback(() => {
    setApplied({
      q: search.trim().toLowerCase(),
      wh: fWarehouse,
      st: fStatus,
      range: fRange ? [fRange[0].format('YYYY-MM-DD'), fRange[1].format('YYYY-MM-DD')] : null,
    });
  }, [search, fWarehouse, fStatus, fRange]);

  const handleReset = useCallback(() => {
    setSearch(''); setFWarehouse(''); setFStatus(''); setFRange(null);
    setApplied({ q: '', wh: '', st: '', range: null });
  }, []);

  const filteredData = useMemo(() => dataSource.filter(r => {
    const a = applied;
    if (a.q && !(
      String(r.id || '').toLowerCase().includes(a.q) ||
      String(r.productName || '').toLowerCase().includes(a.q) ||
      String(r.productCode || '').toLowerCase().includes(a.q) ||
      String(r.woNo || '').toLowerCase().includes(a.q)
    )) return false;
    if (a.wh && r.warehouse !== a.wh) return false;
    if (a.st && r.status !== a.st) return false;
    if (a.range) {
      const d = dayjs(r.date).format('YYYY-MM-DD');
      if (d < a.range[0] || d > a.range[1]) return false;
    }
    return true;
  }), [dataSource, applied]);

  const warehouseOptions = useMemo(() => {
    const s = new Set<string>(['成品仓', '半成品仓', '原料仓']);
    dataSource.forEach(r => r.warehouse && s.add(r.warehouse));
    return Array.from(s).map(w => ({ value: w, label: w }));
  }, [dataSource]);
  const statusOptions = useMemo(() => Array.from(new Set(dataSource.map(r => r.status).filter(Boolean))).map(s => ({ value: s, label: s })), [dataSource]);

  // ============ 删除（回冲库存） ============
  const removeRecords = useCallback((keys: React.Key[]) => {
    const keySet = new Set(keys);
    const targets = dataSource.filter(r => keySet.has(r.key));
    if (targets.length === 0) return;
    Modal.confirm({
      title: `确认删除 ${targets.length} 条入库记录？`,
      content: '删除后将回冲对应商品的实际库存（扣减入库数量），并写入库存变化日志，操作不可撤销。',
      okText: '确认删除', okButtonProps: { danger: true }, cancelText: '取消', centered: true,
      onOk: () => {
        targets.forEach(r => {
          const before = Number(productList.find(p => p.productCode === r.productCode)?.actualStock) || 0;
          updateProductStock(r.productCode, Math.max(0, before - (Number(r.quantity) || 0)), {
            type: '出库', changeQty: -(Number(r.quantity) || 0), beforeStock: before,
            relatedDocNo: r.id, operator: getCurrentUserDisplayName(), remark: `删除生产入库单回冲（${r.id}）`,
          }, owner);
        });
        saveData(dataSource.filter(r => !keySet.has(r.key)));
        setSelectedRowKeys([]);
        message.success(`已删除 ${targets.length} 条记录并回冲库存`);
      },
    });
  }, [dataSource, productList, saveData, owner]);

  // ============ 手动补录 ============
  const handleAdd = useCallback(() => {
    if (!formProduct) { message.warning('请选择入库商品'); return; }
    if (!formQty || formQty <= 0) { message.warning('入库数量必须大于 0'); return; }
    const prod = productList.find(p => p.productCode === formProduct);
    const docNo = generateDocNo('RK');
    const before = Number(prod?.actualStock) || 0;
    updateProductStock(formProduct, before + formQty, {
      type: '入库', changeQty: formQty, beforeStock: before,
      relatedDocNo: docNo, operator: getCurrentUserDisplayName(), remark: `手动补录生产入库（${formWoNo || '无生产工单'}）`,
    }, owner);
    const rec: PisRecord = {
      key: `${docNo}-${Date.now()}`, id: docNo,
      productName: prod?.shortName || prod?.name || formProduct, productCode: formProduct,
      quantity: formQty, woNo: formWoNo, warehouse: formWarehouse,
      date: formDate.format('YYYY-MM-DD'), person: getCurrentUserDisplayName(),
      status: '已入库', source: 'manual', createTime: new Date().toLocaleString('zh-CN'),
    };
    saveData([rec, ...dataSource]);
    setAddVisible(false);
    setFormProduct(''); setFormQty(1); setFormWarehouse('成品仓'); setFormWoNo(''); setFormDate(dayjs());
    message.success(`入库单 ${docNo} 已创建，商品实际库存已增加`);
  }, [formProduct, formQty, formWarehouse, formWoNo, formDate, productList, dataSource, saveData, owner]);

  // ============ 导出 ============
  const handleExport = useCallback(() => {
    if (filteredData.length === 0) { message.warning('当前筛选下无可导出数据'); return; }
    const headers = ['入库单号', '产品名称', '商品编码', '入库数量', '生产工单', '入库仓库', '入库日期', '经手人', '状态', '来源', '关联销售订单'];
    const rows = filteredData.map(r => [r.id, r.productName, r.productCode, r.quantity, r.woNo, r.warehouse, r.date, r.person, r.status, r.source === 'manual' ? '手动补录' : '生产完工', r.salesOrderId || '']);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `生产入库统计_${dayjs().format('YYYYMMDDHHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success(`已导出 ${filteredData.length} 条记录`);
  }, [filteredData]);

  // ============ 详情关联数据 ============
  const viewOrder = useMemo(() => (viewRecord ? prodOrders.find(p => String(p.id) === String(viewRecord.woNo)) : null), [viewRecord, prodOrders]);
  const viewProduct = useMemo(() => (viewRecord ? productList.find(p => p.productCode === viewRecord.productCode) : null), [viewRecord, productList]);
  const viewLogs = useMemo<StockLogEntry[]>(() => (viewRecord ? getStockLogs(viewRecord.productCode, owner).filter(l => l.relatedDocNo === viewRecord.id) : []), [viewRecord, owner]);

  // ============ 表格列 ============
  const columns: ColumnsType<PisRecord> = [
    { title: '入库单号', dataIndex: 'id', key: 'id', width: 140, fixed: 'left', render: v => <Text strong copyable={{ text: v }}>{v}</Text> },
    { title: '产品名称', dataIndex: 'productName', key: 'productName', width: 140, render: v => v || '—' },
    { title: '商品编码', dataIndex: 'productCode', key: 'productCode', width: 120, render: v => <Tag color="geekblue">{v}</Tag> },
    { title: '入库数量', dataIndex: 'quantity', key: 'quantity', width: 100, align: 'right', render: v => <Text strong style={{ color: '#52c41a', fontSize: 14 }}>{Number(v || 0).toLocaleString()}</Text> },
    {
      title: '生产工单', dataIndex: 'woNo', key: 'woNo', width: 140,
      render: v => v ? (
        <Tooltip title={prodOrders.find(p => String(p.id) === String(v)) ? `生产订单状态：${prodOrders.find(p => String(p.id) === String(v))?.statusLabel || prodOrders.find(p => String(p.id) === String(v))?.status || '-'}` : '未在生产订单中找到'}>
          <Tag icon={<LinkOutlined />} color="purple">{v}</Tag>
        </Tooltip>
      ) : <Text type="secondary">—</Text>,
    },
    { title: '入库仓库', dataIndex: 'warehouse', key: 'warehouse', width: 100, render: v => <Tag color={WAREHOUSE_COLOR[v] || 'default'}>{v}</Tag> },
    { title: '入库日期', dataIndex: 'date', key: 'date', width: 110 },
    { title: '经手人', dataIndex: 'person', key: 'person', width: 100, render: v => v || '—' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: v => <Tag color={v === '已入库' ? 'green' : 'default'}>{v}</Tag> },
    { title: '来源', dataIndex: 'source', key: 'source', width: 100, render: v => <Tag color={v === 'manual' ? 'cyan' : 'blue'}>{v === 'manual' ? '手动补录' : '生产完工'}</Tag> },
    {
      title: '操作', key: 'action', width: 130, fixed: 'right', align: 'center',
      render: (_v, r) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewRecord(r)} style={{ color: PRIMARY }}>查看</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => removeRecords([r.key])}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* 统计卡片 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={4}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="总入库记录" value={stats.total} suffix="条" valueStyle={{ fontSize: 18, color: PRIMARY }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="总入库数量" value={stats.totalQty} suffix="件" valueStyle={{ fontSize: 18, color: '#52c41a' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="本月入库量" value={stats.monthQty} suffix="件" valueStyle={{ fontSize: 18, color: '#1890ff' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="涉及金额(成本价)" value={stats.amount} precision={2} prefix="¥" valueStyle={{ fontSize: 18, color: '#fa8c16' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="入库批次" value={stats.batches} suffix="批" valueStyle={{ fontSize: 18, color: '#722ed1' }} /></Card></Col>
        <Col xs={12} md={4}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="涉及商品" value={stats.products} suffix="种" valueStyle={{ fontSize: 18, color: '#13c2c2' }} /></Card></Col>
      </Row>

      {/* 工具栏 */}
      <Card size="small" bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 12 }}>
        <Row gutter={8} align="middle" wrap>
          <Col><Input placeholder="搜索入库单号/产品/编码/工单" prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} allowClear /></Col>
          <Col><Select placeholder="仓库" value={fWarehouse || undefined} onChange={v => setFWarehouse(v || '')} options={warehouseOptions} style={{ width: 120 }} allowClear /></Col>
          <Col><Select placeholder="状态" value={fStatus || undefined} onChange={v => setFStatus(v || '')} options={statusOptions} style={{ width: 110 }} allowClear /></Col>
          <Col><RangePicker value={fRange} onChange={v => setFRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)} /></Col>
          <Col><Space>
            <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>查询</Button>
          </Space></Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
              <Button danger icon={<DeleteOutlined />} disabled={selectedRowKeys.length === 0} onClick={() => removeRecords(selectedRowKeys)}>批量删除</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>新增入库</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 表格 */}
      <Table
        bordered size="small" rowKey="key" columns={columns} dataSource={filteredData}
        scroll={{ x: 1300 }}
        rowSelection={{ selectedRowKeys, onChange: keys => setSelectedRowKeys(keys) }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: t => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="暂无生产入库数据：生产订单完工后自动写入，或点击「新增入库」手动补录" /> }}
      />

      {/* 页面详细说明 */}
      <Card size="small" style={{ marginTop: 12 }} bodyStyle={{ padding: '12px 16px' }}>
        <div style={{ fontWeight: 600, color: '#1a2b45', marginBottom: 8 }}><ProfileOutlined style={{ marginRight: 6 }} />页面详细说明</div>
        <Paragraph style={{ marginBottom: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.9 }}>
          <div><Text strong>1、数据来源：</Text>本表记录由「生产管理 → 生产订单」完工时自动联动写入（按生产单号幂等，同一工单只生成一次），同时按完工数量增加对应商品的实际库存；也可通过本页「新增入库」手动补录（来源标记为「手动补录」）。</div>
          <div><Text strong>2、字段含义：</Text>入库单号（RK- 前缀唯一编号）；产品名称/商品编码（关联商品资料）；入库数量（完工/补录件数）；生产工单（来源生产订单号，可悬停查看订单状态）；入库仓库（成品仓/半成品仓/原料仓）；入库日期；经手人；状态（已入库）；来源（生产完工/手动补录）。</div>
          <div><Text strong>3、数据关联：</Text>商品编码 ↔ 商品资料（取成本价计算涉及金额、取实际库存做回冲）；生产工单 ↔ 生产订单（展示订单状态）；入库/删除 ↔ 库存变化日志（stock_change_log，可在商品实际库存弹窗查看流水）。</div>
          <div><Text strong>4、统计口径：</Text>总入库记录=全部行数；总入库数量=数量求和；本月入库量=入库日期属当月的数量求和；涉及金额=Σ(数量×商品成本价)；入库批次=生产工单去重计数；涉及商品=商品编码去重计数。</div>
          <div><Text strong>5、筛选与导出：</Text>搜索支持入库单号/产品名称/商品编码/生产工单模糊匹配；仓库、状态为精确筛选；日期按入库日期区间过滤；点击「查询」生效、「重置」清空；「导出」按当前筛选结果输出 CSV。</div>
          <div><Text strong>6、删除与回冲：</Text>单条或批量删除会扣减对应商品实际库存（回冲入库数量）并写入「出库」类型库存日志，操作不可撤销，请谨慎使用。</div>
        </Paragraph>
      </Card>

      {/* 新增入库弹窗 */}
      <Modal
        title={<span><InboxOutlined style={{ marginRight: 8, color: PRIMARY }} />新增生产入库（手动补录）</span>}
        open={addVisible} onCancel={() => setAddVisible(false)} onOk={handleAdd}
        okText="确认入库" cancelText="取消" centered width={560} zIndex={1100} destroyOnClose
      >
        <Row gutter={12}>
          <Col span={24} style={{ marginBottom: 12 }}>
            <Text type="secondary">入库商品</Text>
            <Select showSearch optionFilterProp="label" value={formProduct || undefined} onChange={setFormProduct}
              placeholder="搜索商品编码/简称选择" style={{ width: '100%' }}
              options={productList.map((p: any) => ({ value: p.productCode, label: `${p.productCode} ${p.shortName || p.name || ''}` }))} />
          </Col>
          <Col span={8} style={{ marginBottom: 12 }}>
            <Text type="secondary">入库数量</Text>
            <InputNumber min={1} precision={0} value={formQty} onChange={v => setFormQty(v || 1)} style={{ width: '100%' }} />
          </Col>
          <Col span={8} style={{ marginBottom: 12 }}>
            <Text type="secondary">入库仓库</Text>
            <Select value={formWarehouse} onChange={setFormWarehouse} options={warehouseOptions} style={{ width: '100%' }} />
          </Col>
          <Col span={8} style={{ marginBottom: 12 }}>
            <Text type="secondary">入库日期</Text>
            <DatePicker value={formDate} onChange={v => v && setFormDate(v)} style={{ width: '100%' }} />
          </Col>
          <Col span={24}>
            <Text type="secondary">生产工单（可选）</Text>
            <Select showSearch allowClear optionFilterProp="label" value={formWoNo || undefined} onChange={v => setFormWoNo(v || '')}
              placeholder="关联生产订单（可留空）" style={{ width: '100%' }}
              options={prodOrders.map((p: any) => ({ value: String(p.id), label: `${p.id} ${p.statusLabel || p.status || ''}` }))} />
          </Col>
        </Row>
        <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: '8px 12px', fontSize: 12, color: '#52c41a' }}>
          确认后将生成 RK- 入库单、增加所选商品实际库存并写入库存变化日志。
        </div>
      </Modal>

      {/* 查看详情弹窗 */}
      <Modal
        title={`入库单详情 — ${viewRecord?.id || ''}`}
        open={!!viewRecord} onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>关闭</Button>}
        centered width={820} zIndex={1100}
      >
        {viewRecord && (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="入库单号">{viewRecord.id}</Descriptions.Item>
              <Descriptions.Item label="产品名称">{viewRecord.productName || '—'}</Descriptions.Item>
              <Descriptions.Item label="商品编码"><Tag color="geekblue">{viewRecord.productCode}</Tag></Descriptions.Item>
              <Descriptions.Item label="入库数量"><Text strong style={{ color: '#52c41a' }}>{Number(viewRecord.quantity || 0).toLocaleString()}</Text></Descriptions.Item>
              <Descriptions.Item label="入库仓库"><Tag color={WAREHOUSE_COLOR[viewRecord.warehouse] || 'default'}>{viewRecord.warehouse}</Tag></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="green">{viewRecord.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="生产工单">{viewRecord.woNo || '—'}</Descriptions.Item>
              <Descriptions.Item label="入库日期">{viewRecord.date}</Descriptions.Item>
              <Descriptions.Item label="经手人">{viewRecord.person || '—'}</Descriptions.Item>
              <Descriptions.Item label="来源"><Tag color={viewRecord.source === 'manual' ? 'cyan' : 'blue'}>{viewRecord.source === 'manual' ? '手动补录' : '生产完工'}</Tag></Descriptions.Item>
              <Descriptions.Item label="关联销售订单" span={2}>{viewRecord.salesOrderId || '—'}</Descriptions.Item>
            </Descriptions>

            {viewOrder && (
              <Card size="small" title="关联生产订单" style={{ marginBottom: 12 }} bodyStyle={{ padding: '8px 12px' }}>
                <Descriptions size="small" column={3}>
                  <Descriptions.Item label="生产订单号">{viewOrder.id}</Descriptions.Item>
                  <Descriptions.Item label="订单状态">{viewOrder.statusLabel || viewOrder.status || '—'}</Descriptions.Item>
                  <Descriptions.Item label="完工数量">{viewOrder.completedQuantity ?? viewOrder.doneQty ?? '—'}</Descriptions.Item>
                </Descriptions>
              </Card>
            )}
            {viewProduct && (
              <Card size="small" title="商品当前库存" style={{ marginBottom: 12 }} bodyStyle={{ padding: '8px 12px' }}>
                <Descriptions size="small" column={3}>
                  <Descriptions.Item label="商品简称">{viewProduct.shortName || viewProduct.name || '—'}</Descriptions.Item>
                  <Descriptions.Item label="当前实际库存"><Text strong>{viewProduct.actualStock ?? 0}</Text></Descriptions.Item>
                  <Descriptions.Item label="成本价">¥{Number(viewProduct.costPrice || 0).toFixed(2)}</Descriptions.Item>
                </Descriptions>
              </Card>
            )}
            <Card size="small" title="库存变化流水（本单）" bodyStyle={{ padding: 0 }}>
              <Table bordered size="small" pagination={false} rowKey="id" dataSource={viewLogs}
                locale={{ emptyText: <Empty description="无对应库存流水" /> }}
                columns={[
                  { title: '类型', dataIndex: 'type', key: 'type', width: 70, align: 'center', render: v => <Tag color={v === '入库' ? 'green' : 'red'}>{v}</Tag> },
                  { title: '变化数量', dataIndex: 'changeQty', key: 'changeQty', width: 90, align: 'right', render: v => (v > 0 ? `+${v}` : v) },
                  { title: '变化前', dataIndex: 'beforeStock', key: 'beforeStock', width: 80, align: 'right' },
                  { title: '变化后', dataIndex: 'afterStock', key: 'afterStock', width: 80, align: 'right' },
                  { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
                  { title: '时间', dataIndex: 'createTime', key: 'createTime', width: 160 },
                  { title: '备注', dataIndex: 'remark', key: 'remark' },
                ]} />
            </Card>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ProdInboundStatsPage;
