import React, { useState, useCallback, useMemo } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Select, Modal,
  InputNumber, Tag, Tooltip, message, Descriptions, Statistic, Checkbox,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EyeOutlined, ExportOutlined,
  InboxOutlined, BarcodeOutlined, AppstoreOutlined, CheckOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { updateProductStock, generateDocNo } from '../../utils/stockUtils';
import { getCurrentUserDisplayName } from '../../utils/billLog';
import { QtyTemplateManagerModal, QtyFillConfirmModal, loadQtyTemplates, saveQtyTemplates } from '../../components/QtyTemplateModals';
import type { QtyTemplate } from '../../components/QtyTemplateModals';
import { useDatasetSyncReload, applyIfChanged } from '../../utils/useDatasetSyncReload';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

interface RecvItem {
  productCode: string;
  productName: string;
  unit: string;
  spec: string;
  quantity: number;
  price: number;
  remark: string;
}

interface RecvRecord {
  key: string;
  docNo: string;
  type: string;
  supplierName: string;
  items: RecvItem[];
  operator: string;
  createTime: string;
  status: string;
  remark: string;
}

const STORAGE_KEY = () => `purchase_receiving_${getDataOwner()}`;

const PurchaseReceivingPage: React.FC = () => {
  const [dataSource, setDataSource] = useState<RecvRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { return []; }
  });
  const [searchText, setSearchText] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [viewRecord, setViewRecord] = useState<RecvRecord | null>(null);

  // 新增弹窗状态
  const [formType, setFormType] = useState('原材料入库');
  const [formSupplier, setFormSupplier] = useState('');
  const [formOperator] = useState(getCurrentUserDisplayName());
  const [formRemark, setFormRemark] = useState('');
  const [formItems, setFormItems] = useState<RecvItem[]>([]);
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

  // 同步落地/窗口重新可见时重读：入库单在别端录入后本端不刷新，
  // 下一次本端入库就会拿陈旧列表整表回写，把别端刚入的单据整份覆盖
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

  const saveData = useCallback((list: RecvRecord[]) => {
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
        productCode: prod.productCode,
        productName: prod.shortName || prod.name || '',
        unit: prod.unit || '',
        spec: prod.spec || '',
        quantity: scanDefaultQty,
        price: Number(prod.costPrice) || 0,
        remark: '',
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
        productCode: prod.productCode,
        productName: prod.shortName || prod.name || '',
        unit: prod.unit || '',
        spec: prod.spec || '',
        quantity: qty,
        price: Number(prod.costPrice) || 0,
        remark: '',
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

  // 填充确认：按规格匹配明细行，写入模版数量×倍数
  const handleQtyFillConfirm = useCallback((mult: number) => {
    if (!qtyFillTemplate) return;
    const findMatch = (it: RecvItem) => qtyFillTemplate.rows.find(r => {
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

  // 确认新增
  const handleConfirmAdd = useCallback(() => {
    if (formItems.length === 0) { message.warning('请至少添加一项商品'); return; }
    const invalid = formItems.find(i => !i.quantity || i.quantity <= 0);
    if (invalid) { message.warning(`商品 ${invalid.productCode} 的数量必须大于0`); return; }
    const docNo = generateDocNo('RK');
    const owner = getDataOwner();
    const now = new Date().toLocaleString('zh-CN');
    // 更新库存
    formItems.forEach(item => {
      const prod = productList.find((p: any) => p.productCode === item.productCode);
      const before = Number(prod?.actualStock) || 0;
      updateProductStock(item.productCode, before + item.quantity, {
        type: '入库', changeQty: item.quantity, beforeStock: before,
        relatedDocNo: docNo, operator: formOperator, remark: formRemark,
      }, owner);
    });
    const rec: RecvRecord = {
      key: docNo, docNo, type: formType, supplierName: formSupplier,
      items: formItems.map(i => ({ ...i })),
      operator: formOperator, createTime: now, status: '已入库', remark: formRemark,
    };
    const newList = [rec, ...dataSource];
    saveData(newList);
    setAddVisible(false);
    resetForm();
    message.success(`入库单 ${docNo} 已创建，库存已更新`);
  }, [formItems, formType, formSupplier, formOperator, formRemark, dataSource, productList, saveData]);

  const resetForm = () => {
    setFormType('原材料入库'); setFormSupplier(''); setFormItems([]); setFormRemark(''); setScanCode(''); setPickSearch(''); setPickQty({}); setCheckedTpl({});
  };

  // 导出
  const handleExport = useCallback(() => {
    const header = '入库单号,类型,供应商,明细数,入库时间,操作人,状态,备注\n';
    const rows = filteredData.map(r =>
      `${r.docNo},${r.type},${r.supplierName},${r.items.length},"${r.createTime}",${r.operator},${r.status},"${r.remark}"`
    ).join('\n');
    const blob = new Blob(['\ufeff' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `采购入库记录_${new Date().toLocaleDateString()}.csv`; a.click();
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
      monthAmt: monthData.reduce((s, r) => s + r.items.reduce((ss, i) => ss + i.quantity * i.price, 0), 0),
    };
  }, [dataSource]);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const q = searchText.toLowerCase();
    return dataSource.filter(r =>
      r.docNo.toLowerCase().includes(q) || r.type.includes(q) ||
      r.supplierName.includes(q) || r.operator.includes(q)
    );
  }, [dataSource, searchText]);

  const columns = [
    { title: '入库单号', dataIndex: 'docNo', key: 'docNo', width: 150, align: 'center' as const, render: (v: string) => <Text strong>{v}</Text> },
    { title: '类型', dataIndex: 'type', key: 'type', width: 110, align: 'center' as const, render: (v: string) => <Tag color={v === '成品入库' ? 'blue' : 'cyan'}>{v}</Tag> },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 120, align: 'center' as const, render: (v: string) => v || '—' },
    { title: '明细数', dataIndex: 'items', key: 'itemCount', width: 80, align: 'center' as const, render: (items: RecvItem[]) => items.length },
    { title: '入库时间', dataIndex: 'createTime', key: 'createTime', width: 160, align: 'center' as const },
    { title: '操作人', dataIndex: 'operator', key: 'operator', width: 90, align: 'center' as const },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const, render: () => <Tag color="green">已入库</Tag> },
    {
      title: '操作', key: 'action', width: 120, align: 'center' as const,
      render: (_: any, rec: RecvRecord) => (
        <Space>
          <Tooltip title="查看详情"><Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewRecord(rec)} style={{ color: PRIMARY }}>查看</Button></Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* 统计卡片 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="总入库单数" value={stats.total} suffix="单" valueStyle={{ fontSize: 18, color: PRIMARY }} /></Card></Col>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="本月入库量" value={stats.monthQty} suffix="件" valueStyle={{ fontSize: 18, color: '#52c41a' }} /></Card></Col>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="本月入库金额" value={stats.monthAmt} precision={2} prefix="¥" valueStyle={{ fontSize: 18, color: '#fa8c16' }} /></Card></Col>
      </Row>

      {/* 工具栏 */}
      <Card size="small" bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 12 }}>
        <Row gutter={8} align="middle">
          <Col><Input.Search placeholder="搜索单号/类型/供应商" value={searchText} onChange={e => setSearchText(e.target.value)} style={{ width: 220 }} allowClear /></Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>新增入库单</Button>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 表格 */}
      <Table
        bordered size="small" pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        dataSource={filteredData} rowKey="key" columns={columns}
        scroll={{ x: 900 }}
      />

      {/* 新增入库单弹窗 */}
      <Modal
        title={<span><InboxOutlined style={{ marginRight: 8, color: PRIMARY }} />新增入库单</span>}
        open={addVisible} onCancel={() => { setAddVisible(false); resetForm(); }}
        onOk={handleConfirmAdd} okText="确认入库" cancelText="取消" centered width={900} zIndex={1100}
      >
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}><Text type="secondary">类型</Text><Select value={formType} onChange={setFormType} style={{ width: '100%' }} options={[{ value: '原材料入库' }, { value: '成品入库' }]} /></Col>
          <Col span={8}><Text type="secondary">供应商</Text><Input value={formSupplier} onChange={e => setFormSupplier(e.target.value)} placeholder="供应商名称" /></Col>
          <Col span={8}><Text type="secondary">备注</Text><Input value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="备注" /></Col>
        </Row>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Text type="secondary">扫码/输入商品编码</Text>
            <Input
              autoFocus value={scanCode} onChange={e => setScanCode(e.target.value)}
              onKeyDown={handleScanKeyDown} placeholder="扫码或输入商品编码后按回车"
              prefix={<BarcodeOutlined />} suffix={<Button size="small" type="link" onClick={() => scanCode.trim() && handleScan(scanCode.trim())}>添加</Button>}
            />
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
        <Table
          bordered size="small" pagination={false}
          dataSource={formItems} rowKey={(r, i) => r.productCode || String(i)}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', width: 120, align: 'center' as const },
            { title: '商品简称', dataIndex: 'productName', width: 120, align: 'center' as const },
            { title: '单位', dataIndex: 'unit', width: 60, align: 'center' as const },
            { title: '数量', dataIndex: 'quantity', width: 90, align: 'center' as const,
              render: (v: number, _r: RecvItem, idx: number) => (
                <InputNumber controls={false} size="small" value={v} min={0} precision={0} style={{ width: 70 }}
                  onChange={val => { const ni = [...formItems]; ni[idx].quantity = val || 0; setFormItems(ni); }} />
              ),
            },
            { title: '单价', dataIndex: 'price', width: 90, align: 'center' as const,
              render: (v: number, _r: RecvItem, idx: number) => (
                <InputNumber controls={false} size="small" value={v} min={0} precision={2} style={{ width: 70 }}
                  onChange={val => { const ni = [...formItems]; ni[idx].price = val || 0; setFormItems(ni); }} />
              ),
            },
            { title: '小计', width: 90, align: 'center' as const,
              render: (_: any, r: RecvItem) => <Text strong>¥{((r.quantity || 0) * (r.price || 0)).toFixed(2)}</Text>,
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
        title={`入库单详情 — ${viewRecord?.docNo || ''}`}
        open={!!viewRecord} onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>关闭</Button>}
        centered width={800} zIndex={1100}
      >
        {viewRecord && (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="入库单号">{viewRecord.docNo}</Descriptions.Item>
              <Descriptions.Item label="类型"><Tag>{viewRecord.type}</Tag></Descriptions.Item>
              <Descriptions.Item label="供应商">{viewRecord.supplierName || '—'}</Descriptions.Item>
              <Descriptions.Item label="操作人">{viewRecord.operator}</Descriptions.Item>
              <Descriptions.Item label="入库时间">{viewRecord.createTime}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="green">{viewRecord.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="备注" span={3}>{viewRecord.remark || '—'}</Descriptions.Item>
            </Descriptions>
            <Table bordered size="small" pagination={false}
              dataSource={viewRecord.items} rowKey={(r, i) => r.productCode || String(i)}
              columns={[
                { title: '商品编码', dataIndex: 'productCode', align: 'center' as const },
                { title: '商品简称', dataIndex: 'productName', align: 'center' as const },
                { title: '单位', dataIndex: 'unit', align: 'center' as const, width: 60 },
                { title: '数量', dataIndex: 'quantity', align: 'center' as const, width: 80 },
                { title: '单价', dataIndex: 'price', align: 'center' as const, width: 80, render: (v: number) => `¥${(v || 0).toFixed(2)}` },
                { title: '小计', align: 'center' as const, width: 90, render: (_: any, r: RecvItem) => <Text strong>¥{((r.quantity || 0) * (r.price || 0)).toFixed(2)}</Text> },
              ]}
              summary={items => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5} align="right"><Text strong>合计</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="center"><Text strong style={{ color: PRIMARY }}>¥{items.reduce((s, r) => s + (r.quantity || 0) * (r.price || 0), 0).toFixed(2)}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default PurchaseReceivingPage;
