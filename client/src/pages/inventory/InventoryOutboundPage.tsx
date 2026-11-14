import React, { useState, useCallback, useMemo } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Select, Modal,
  InputNumber, Tag, Tooltip, message, Descriptions, Statistic, Checkbox, Tabs,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EyeOutlined, ExportOutlined,
  BarcodeOutlined, LogoutOutlined, AppstoreOutlined, CheckOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { updateProductStock, generateDocNo } from '../../utils/stockUtils';
import { getCurrentUserDisplayName } from '../../utils/billLog';
import { QtyTemplateManagerModal, QtyFillConfirmModal, loadQtyTemplates, saveQtyTemplates } from '../../components/QtyTemplateModals';
import type { QtyTemplate } from '../../components/QtyTemplateModals';
import SalesOutboundPage from './SalesOutboundPage';
import { useDatasetSyncReload, applyIfChanged } from '../../utils/useDatasetSyncReload';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

interface OutItem {
  productCode: string;
  productName: string;
  unit: string;
  spec: string;
  currentStock: number;
  quantity: number;
  remark: string;
}

interface OutRecord {
  key: string;
  docNo: string;
  type: string;
  items: OutItem[];
  operator: string;
  createTime: string;
  status: string;
  remark: string;
}

const STORAGE_KEY = () => `inventory_outbound_${getDataOwner()}`;

const InventoryOutboundPage: React.FC = () => {
  // 子页面：库存出库 / 销售出库单
  const [activeTab, setActiveTab] = useState<'outbound' | 'sales'>('outbound');
  const [dataSource, setDataSource] = useState<OutRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { return []; }
  });
  const [searchText, setSearchText] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [viewRecord, setViewRecord] = useState<OutRecord | null>(null);
  // 表格勾选键
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 新增弹窗状态
  const [formType, setFormType] = useState('销售出库');
  const [formOperator] = useState(getCurrentUserDisplayName());
  const [formRemark, setFormRemark] = useState('');
  const [formItems, setFormItems] = useState<OutItem[]>([]);
  const [scanCode, setScanCode] = useState('');
  const [scanDefaultQty, setScanDefaultQty] = useState(1);
  const [pickVisible, setPickVisible] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [pickQty, setPickQty] = useState<Record<string, number>>({});
  // 数量模版（与订单管理共用存储键）
  const [qtyTemplates, setQtyTemplates] = useState<QtyTemplate[]>(() => loadQtyTemplates(getDataOwner()));
  const [qtyTplVisible, setQtyTplVisible] = useState(false);
  const [qtyFillTemplate, setQtyFillTemplate] = useState<QtyTemplate | null>(null);
  const [qtyFillMultiplier, setQtyFillMultiplier] = useState(1);
  // 已勾选填充的数量模版
  const [checkedTpl, setCheckedTpl] = useState<Record<string, boolean>>({});

  // 同步落地/窗口重新可见时重读：出库单在别端录入后本端不刷新，
  // 下一次本端出库就会拿陈旧列表整表回写，把别端刚出的单据整份覆盖
  useDatasetSyncReload(() => {
    try {
      const next = JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]');
      if (Array.isArray(next)) applyIfChanged(setDataSource, next);
    } catch { /* ignore */ }
    applyIfChanged(setQtyTemplates, loadQtyTemplates(getDataOwner()));
  });

  const productList = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${getDataOwner()}`) || '[]'); } catch { return []; }
  }, [addVisible]);

  const saveData = useCallback((list: OutRecord[]) => {
    setDataSource(list);
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(list));
  }, []);

  // 扫码/手动输入商品编码（重复扫码自动累加数量）
  const handleScan = useCallback((code: string) => {
    const prod = productList.find((p: any) => p.productCode === code);
    if (!prod) { message.warning(`未找到商品编码: ${code}`); return; }
    const existIdx = formItems.findIndex(i => i.productCode === code);
    if (existIdx >= 0) {
      const ni = [...formItems];
      ni[existIdx] = { ...ni[existIdx], quantity: (ni[existIdx].quantity || 0) + scanDefaultQty };
      setFormItems(ni);
    } else {
      setFormItems([...formItems, {
        productCode: prod.productCode, productName: prod.shortName || prod.name || '',
        unit: prod.unit || '', spec: prod.spec || '', currentStock: Number(prod.actualStock) || 0, quantity: scanDefaultQty, remark: '',
      }]);
    }
    setScanCode('');
  }, [productList, formItems, scanDefaultQty]);

  const handleScanKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); if (scanCode.trim()) handleScan(scanCode.trim()); }
  }, [scanCode, handleScan]);

  // 选择商品弹窗：过滤后的商品列表
  const pickProducts = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    if (!q) return productList;
    return productList.filter((p: any) =>
      (p.productCode || '').toLowerCase().includes(q) ||
      (p.shortName || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q)
    );
  }, [productList, pickSearch]);

  // 选择商品弹窗添加（已存在则累加数量）
  const handlePickAdd = useCallback((prod: any) => {
    const qty = pickQty[prod.productCode] ?? scanDefaultQty;
    const existIdx = formItems.findIndex(i => i.productCode === prod.productCode);
    if (existIdx >= 0) {
      const ni = [...formItems];
      ni[existIdx] = { ...ni[existIdx], quantity: (ni[existIdx].quantity || 0) + qty };
      setFormItems(ni);
    } else {
      setFormItems([...formItems, {
        productCode: prod.productCode, productName: prod.shortName || prod.name || '',
        unit: prod.unit || '', spec: prod.spec || '', currentStock: Number(prod.actualStock) || 0, quantity: qty, remark: '',
      }]);
    }
    message.success(`已添加 ${prod.productCode}，数量 ${qty}`);
  }, [pickQty, scanDefaultQty, formItems]);

  // 数量模版：保存/删除（与订单管理共用存储键）
  const handleChangeQtyTemplates = useCallback((list: QtyTemplate[]) => {
    setQtyTemplates(list);
    saveQtyTemplates(getDataOwner(), list);
  }, []);

  // 点击模版→弹出填充确认弹窗
  const openQtyFill = useCallback((t: QtyTemplate) => {
    setQtyFillTemplate(t);
    setQtyFillMultiplier(1);
  }, []);

  // 填充确认：按规格匹配明细行，写入出库数量=模版数量×倍数
  const handleQtyFillConfirm = useCallback((mult: number) => {
    if (!qtyFillTemplate) return;
    const findMatch = (it: OutItem) => qtyFillTemplate.rows.find(r => {
      const sp = String(r.spec).trim();
      const pc = String(it.productCode || '').trim();
      const itsSpec = String(it.spec || '').trim();
      return !!sp && (sp === itsSpec || sp === pc || (pc && pc.includes(sp)) || (itsSpec && itsSpec.includes(sp)));
    });
    let filled = 0;
    const newItems = formItems.map(it => {
      const m = findMatch(it);
      if (m) { filled++; return { ...it, quantity: m.qty * mult }; }
      return it;
    });
    setFormItems(newItems);
    setQtyFillTemplate(null);
    Modal.success({
      title: '填充成功', centered: true, width: 420, zIndex: 1400,
      content: (
        <div style={{ minHeight: 80, paddingTop: 8 }}>
          <div style={{ fontSize: 15, marginBottom: 12 }}>已应用模版「<Text strong>{qtyFillTemplate.name}</Text>」× <Text strong style={{ color: PRIMARY }}>{mult}</Text></div>
          <div style={{ fontSize: 14 }}>共填充 <Text strong style={{ color: '#52c41a', fontSize: 18 }}>{filled}</Text> 条商品</div>
        </div>
      ),
      okText: '知道了',
    });
  }, [qtyFillTemplate, formItems]);

  const resetForm = () => { setFormType('销售出库'); setFormItems([]); setFormRemark(''); setScanCode(''); setPickSearch(''); setPickQty({}); setCheckedTpl({}); };

  // 确认新增
  const handleConfirmAdd = useCallback(() => {
    if (formItems.length === 0) { message.warning('请至少添加一项商品'); return; }
    const invalid = formItems.find(i => !i.quantity || i.quantity <= 0);
    if (invalid) { message.warning(`商品 ${invalid.productCode} 的出库数量必须大于0`); return; }
    const overStock = formItems.find(i => i.quantity > i.currentStock);
    if (overStock) { message.warning(`商品 ${overStock.productCode} 出库数量(${overStock.quantity})超过当前库存(${overStock.currentStock})`); return; }
    const docNo = generateDocNo('CK');
    const owner = getDataOwner();
    const now = new Date().toLocaleString('zh-CN');
    formItems.forEach(item => {
      const prod = productList.find((p: any) => p.productCode === item.productCode);
      const before = Number(prod?.actualStock) || 0;
      updateProductStock(item.productCode, before - item.quantity, {
        type: '出库', changeQty: -item.quantity, beforeStock: before,
        relatedDocNo: docNo, operator: formOperator, remark: formRemark,
      }, owner);
    });
    const rec: OutRecord = {
      key: docNo, docNo, type: formType, items: formItems.map(i => ({ ...i })),
      operator: formOperator, createTime: now, status: '已出库', remark: formRemark,
    };
    saveData([rec, ...dataSource]);
    setAddVisible(false); resetForm();
    message.success(`出库单 ${docNo} 已创建，库存已更新`);
  }, [formItems, formType, formOperator, formRemark, dataSource, productList, saveData]);

  // 导出
  const handleExport = useCallback(() => {
    const header = '出库单号,类型,明细数,出库时间,操作人,状态,备注\n';
    const rows = filteredData.map(r =>
      `${r.docNo},${r.type},${r.items.length},"${r.createTime}",${r.operator},${r.status},"${r.remark}"`
    ).join('\n');
    const blob = new Blob(['\ufeff' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `库存出库记录_${new Date().toLocaleDateString()}.csv`; a.click();
  }, [dataSource]);

  // 统计
  const stats = useMemo(() => {
    const now = new Date(); const month = now.getMonth(); const year = now.getFullYear();
    const monthData = dataSource.filter(r => {
      const d = new Date(r.createTime); return d.getMonth() === month && d.getFullYear() === year;
    });
    return {
      total: dataSource.length,
      monthQty: monthData.reduce((s, r) => s + r.items.reduce((ss, i) => ss + i.quantity, 0), 0),
      monthRecs: monthData.length,
    };
  }, [dataSource]);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const q = searchText.toLowerCase();
    return dataSource.filter(r =>
      r.docNo.toLowerCase().includes(q) || r.type.includes(q) || r.operator.includes(q)
    );
  }, [dataSource, searchText]);

  const columns = [
    { title: '出库单号', dataIndex: 'docNo', key: 'docNo', width: 150, align: 'center' as const, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 110, align: 'center' as const,
      render: (v: string) => {
        const colorMap: Record<string, string> = { '销售出库': 'blue', '生产领料': 'cyan', '其他出库': 'default' };
        return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '出库明细', dataIndex: 'items', key: 'outItems', width: 160, align: 'center' as const,
      render: (items: OutItem[], rec: OutRecord) => {
        // 默认只显示一个商品编码，多个商品时在后面显示'多'字角标，点击查看详情
        const codes = (items || []).map(i => i.productCode).filter(Boolean);
        const fullText = codes.join(', ');
        return (
          <a onClick={() => setViewRecord(rec)} title={fullText}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{codes[0] || '查看明细'}</span>
            {codes.length > 1 && (
              <span style={{ minWidth: 16, height: 16, borderRadius: 8, background: '#1677ff', color: '#fff', fontSize: 10, lineHeight: '14px', textAlign: 'center', padding: '0 4px', border: '1px solid #fff', flexShrink: 0 }}>多</span>
            )}
          </a>
        );
      },
    },
    { title: '明细数', dataIndex: 'items', key: 'itemCount', width: 80, align: 'center' as const, render: (items: OutItem[]) => items.length },
    { title: '出库时间', dataIndex: 'createTime', key: 'createTime', width: 160, align: 'center' as const },
    { title: '操作人', dataIndex: 'operator', key: 'operator', width: 90, align: 'center' as const },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const, render: () => <Tag color="red">已出库</Tag> },
    {
      title: '操作', key: 'action', width: 120, align: 'center' as const,
      render: (_: any, rec: OutRecord) => (
        <Space>
          <Tooltip title="查看详情"><Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewRecord(rec)} style={{ color: PRIMARY }}>查看</Button></Tooltip>
        </Space>
      ),
    },
  ];

  const outboundContent = (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* 统计卡片 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="总出库单数" value={stats.total} suffix="单" valueStyle={{ fontSize: 18, color: PRIMARY }} /></Card></Col>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="本月出库量" value={stats.monthQty} suffix="件" valueStyle={{ fontSize: 18, color: '#ff4d4f' }} /></Card></Col>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="本月出库单数" value={stats.monthRecs} suffix="单" valueStyle={{ fontSize: 18, color: '#fa8c16' }} /></Card></Col>
      </Row>

      {/* 工具栏 */}
      <Card size="small" bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 12 }}>
        <Row gutter={8} align="middle">
          <Col><Input.Search placeholder="搜索单号/类型/操作人" value={searchText} onChange={e => setSearchText(e.target.value)} style={{ width: 220 }} allowClear /></Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>新增出库单</Button>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 表格 */}
      <Table bordered size="small" pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        dataSource={filteredData} rowKey="key" columns={columns} scroll={{ x: 900 }}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: keys => setSelectedKeys(keys as string[]) }} />

      {/* 新增出库单弹窗 */}
      <Modal
        title={<span><LogoutOutlined style={{ marginRight: 8, color: PRIMARY }} />新增出库单</span>}
        open={addVisible} onCancel={() => { setAddVisible(false); resetForm(); }}
        onOk={handleConfirmAdd} okText="确认出库" cancelText="取消" centered width={900} zIndex={1100}
      >
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Text type="secondary">类型</Text><Select value={formType} onChange={setFormType} style={{ width: '100%' }} options={[{ value: '销售出库' }, { value: '生产领料' }, { value: '其他出库' }]} /></Col>
          <Col span={16}><Text type="secondary">备注</Text><Input value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="备注" /></Col>
        </Row>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Text type="secondary">扫码/输入商品编码</Text>
            <Input autoFocus value={scanCode} onChange={e => setScanCode(e.target.value)}
              onKeyDown={handleScanKeyDown} placeholder="扫码或输入商品编码后按回车"
              prefix={<BarcodeOutlined />} suffix={<Button size="small" type="link" onClick={() => scanCode.trim() && handleScan(scanCode.trim())}>添加</Button>} />
          </Col>
          <Col span={3}>
            <Text type="secondary">默认数量</Text>
            <InputNumber controls={false} min={1} precision={0} value={scanDefaultQty} onChange={v => setScanDefaultQty(v || 1)} style={{ width: '100%' }} />
          </Col>
          <Col span={3} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button icon={<FileTextOutlined />} block onClick={() => { setQtyTemplates(loadQtyTemplates(getDataOwner())); setQtyTplVisible(true); }}>数量模版</Button>
          </Col>
          <Col span={7} style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 4, minHeight: 32, paddingBottom: 5 }}>
            {qtyTemplates.map((t, i) => (
              <Checkbox key={`qt-${i}`} checked={!!checkedTpl[t.name]}
                onChange={e => {
                  if (e.target.checked) { setCheckedTpl(p => ({ ...p, [t.name]: true })); openQtyFill(t); }
                  else { setCheckedTpl(p => ({ ...p, [t.name]: false })); }
                }}>{t.name}</Checkbox>
            ))}
          </Col>
          <Col span={3} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button type="dashed" icon={<PlusOutlined />} block onClick={() => setPickVisible(true)}>添加商品</Button>
          </Col>
        </Row>
        <Table bordered size="small" pagination={false}
          dataSource={formItems} rowKey={(r, i) => r.productCode || String(i)}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', width: 120, align: 'center' as const },
            { title: '商品简称', dataIndex: 'productName', width: 120, align: 'center' as const },
            { title: '单位', dataIndex: 'unit', width: 60, align: 'center' as const },
            { title: '当前库存', dataIndex: 'currentStock', width: 80, align: 'center' as const, render: (v: number) => <span style={{ fontFamily: 'monospace', color: '#8c8c8c' }}>{v}</span> },
            { title: '出库数量', dataIndex: 'quantity', width: 90, align: 'center' as const,
              render: (v: number, _r: OutItem, idx: number) => (
                <InputNumber controls={false} size="small" value={v} min={0} precision={0} style={{ width: 70 }}
                  onChange={val => { const ni = [...formItems]; ni[idx].quantity = val || 0; setFormItems(ni); }} />
              ),
            },
            { title: '', width: 50, align: 'center' as const,
              render: (_: any, __: any, idx: number) => (
                <Button type="link" danger size="small" icon={<DeleteOutlined />}
                  onClick={() => setFormItems(formItems.filter((_, i) => i !== idx))} />
              ),
            },
          ]}
        />
        {formItems.length === 0 && <div style={{ textAlign: 'center', padding: '16px 0', color: '#999' }}>请扫码或手动添加商品</div>}
      </Modal>

      {/* 添加商品选择弹窗 */}
      <Modal
        title={<span><AppstoreOutlined style={{ marginRight: 8, color: PRIMARY }} />选择商品</span>}
        open={pickVisible} onCancel={() => setPickVisible(false)}
        footer={null} centered width={800} zIndex={1200}
      >
        <Input.Search
          placeholder="搜索商品编码/简称" value={pickSearch}
          onChange={e => setPickSearch(e.target.value)} style={{ marginBottom: 12 }} allowClear
        />
        <Table
          bordered size="small" pagination={{ pageSize: 8, showTotal: t => `共 ${t} 条` }}
          dataSource={pickProducts} rowKey="productCode"
          columns={[
            { title: '商品编码', dataIndex: 'productCode', width: 130, align: 'center' as const },
            { title: '商品简称', key: 'name', width: 130, align: 'center' as const, render: (_: any, r: any) => r.shortName || r.name || '' },
            { title: '单位', dataIndex: 'unit', width: 60, align: 'center' as const },
            { title: '添加数量', key: 'qty', width: 110, align: 'center' as const,
              render: (_: any, r: any) => (
                <InputNumber controls={false} size="small" min={1} precision={0} style={{ width: 80 }}
                  value={pickQty[r.productCode] ?? scanDefaultQty}
                  onChange={v => setPickQty({ ...pickQty, [r.productCode]: v || 1 })} />
              ),
            },
            { title: '操作', key: 'op', width: 80, align: 'center' as const,
              render: (_: any, r: any) => formItems.some(i => i.productCode === r.productCode) ? (
                <Tooltip title="已添加，点击可追加数量">
                  <Button type="primary" size="small" shape="circle" icon={<CheckOutlined />}
                    style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={() => handlePickAdd(r)} />
                </Tooltip>
              ) : (
                <Button type="primary" size="small" onClick={() => handlePickAdd(r)}>添加</Button>
              ),
            },
          ]}
        />
      </Modal>

      {/* 数量模版管理弹窗 */}
      <QtyTemplateManagerModal
        open={qtyTplVisible}
        onClose={() => setQtyTplVisible(false)}
        templates={qtyTemplates}
        onChange={handleChangeQtyTemplates}
        onPickTemplate={openQtyFill}
      />

      {/* 数量模版填充确认弹窗 */}
      <QtyFillConfirmModal
        open={!!qtyFillTemplate}
        template={qtyFillTemplate}
        multiplier={qtyFillMultiplier}
        onMultiplier={setQtyFillMultiplier}
        onClose={() => { if (qtyFillTemplate) setCheckedTpl(p => ({ ...p, [qtyFillTemplate.name]: false })); setQtyFillTemplate(null); }}
        onConfirm={handleQtyFillConfirm}
      />

      {/* 查看详情弹窗 */}
      <Modal
        title={`出库单详情 — ${viewRecord?.docNo || ''}`}
        open={!!viewRecord} onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>关闭</Button>}
        centered width={800} zIndex={1100}
      >
        {viewRecord && (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="出库单号">{viewRecord.docNo}</Descriptions.Item>
              <Descriptions.Item label="类型"><Tag>{viewRecord.type}</Tag></Descriptions.Item>
              <Descriptions.Item label="操作人">{viewRecord.operator}</Descriptions.Item>
              <Descriptions.Item label="出库时间">{viewRecord.createTime}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="red">{viewRecord.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="备注">{viewRecord.remark || '—'}</Descriptions.Item>
            </Descriptions>
            <Table bordered size="small" pagination={false}
              dataSource={viewRecord.items} rowKey={(r, i) => r.productCode || String(i)}
              columns={[
                { title: '商品编码', dataIndex: 'productCode', align: 'center' as const },
                { title: '商品简称', dataIndex: 'productName', align: 'center' as const },
                { title: '单位', dataIndex: 'unit', align: 'center' as const, width: 60 },
                { title: '出库数量', dataIndex: 'quantity', align: 'center' as const, width: 80 },
              ]}
              summary={items => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3} align="right"><Text strong>合计</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="center"><Text strong style={{ color: '#ff4d4f' }}>{items.reduce((s, r) => s + (r.quantity || 0), 0)}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </>
        )}
      </Modal>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs
        activeKey={activeTab}
        onChange={k => setActiveTab(k as 'outbound' | 'sales')}
        destroyInactiveTabPane
        tabBarStyle={{ background: '#fff', paddingLeft: 12, marginBottom: 0 }}
        items={[
          { key: 'outbound', label: '其他出库', children: outboundContent },
          { key: 'sales', label: '销售出库单', children: <SalesOutboundPage /> },
        ]}
      />
    </div>
  );
};

export default InventoryOutboundPage;
