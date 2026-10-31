import React, { useState, useCallback, useMemo } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Modal,
  InputNumber, Tag, Tooltip, message, Descriptions, Statistic, Checkbox,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EyeOutlined, ExportOutlined,
  CheckCircleOutlined, BarcodeOutlined, AuditOutlined, AppstoreOutlined, CheckOutlined, FileTextOutlined, EditOutlined,
} from '@ant-design/icons';
import { updateProductStock, generateDocNo } from '../../utils/stockUtils';
import { getCurrentUserDisplayName } from '../../utils/billLog';
import { QtyTemplateManagerModal, QtyFillConfirmModal, loadQtyTemplates, saveQtyTemplates } from '../../components/QtyTemplateModals';
import type { QtyTemplate } from '../../components/QtyTemplateModals';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

interface CheckItem {
  productCode: string;
  productName: string;
  unit: string;
  spec: string;
  systemStock: number;
  checkQty: number;
  diff: number;
  remark: string;
}

interface CheckRecord {
  key: string;
  docNo: string;
  items: CheckItem[];
  operator: string;
  createTime: string;
  status: '待生效' | '已生效';
  confirmTime: string;
  remark: string;
}

const STORAGE_KEY = () => `inventory_check_${getDataOwner()}`;

const InventoryCheckPage: React.FC = () => {
  const [dataSource, setDataSource] = useState<CheckRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY()) || '[]'); } catch { return []; }
  });
  const [searchText, setSearchText] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [viewRecord, setViewRecord] = useState<CheckRecord | null>(null);

  // 新增弹窗状态
  const [formOperator] = useState(getCurrentUserDisplayName());
  const [formRemark, setFormRemark] = useState('');
  const [formItems, setFormItems] = useState<CheckItem[]>([]);
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

  const productList = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${getDataOwner()}`) || '[]'); } catch { return []; }
  }, [addVisible]);

  const saveData = useCallback((list: CheckRecord[]) => {
    setDataSource(list);
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(list));
  }, []);

  // 扫码/手动输入商品编码（重复扫码自动累加盘点数量）
  const handleScan = useCallback((code: string) => {
    const prod = productList.find((p: any) => p.productCode === code);
    if (!prod) { message.warning(`未找到商品编码: ${code}`); return; }
    const existIdx = formItems.findIndex(i => i.productCode === code);
    if (existIdx >= 0) {
      const ni = [...formItems];
      const newCheck = (ni[existIdx].checkQty || 0) + scanDefaultQty;
      ni[existIdx] = { ...ni[existIdx], checkQty: newCheck, diff: newCheck - ni[existIdx].systemStock };
      setFormItems(ni);
    } else {
      const sysStock = Number(prod.actualStock) || 0;
      setFormItems([...formItems, {
        productCode: prod.productCode, productName: prod.shortName || prod.name || '',
        unit: prod.unit || '', spec: prod.spec || '', systemStock: sysStock, checkQty: sysStock + scanDefaultQty, diff: scanDefaultQty, remark: '',
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

  // 选择商品弹窗添加（盘点数量累加，差异自动重算）
  const handlePickAdd = useCallback((prod: any) => {
    const qty = pickQty[prod.productCode] ?? scanDefaultQty;
    const sysStock = Number(prod.actualStock) || 0;
    const existIdx = formItems.findIndex(i => i.productCode === prod.productCode);
    if (existIdx >= 0) {
      const ni = [...formItems];
      const newCheck = (ni[existIdx].checkQty || 0) + qty;
      ni[existIdx] = { ...ni[existIdx], checkQty: newCheck, diff: newCheck - ni[existIdx].systemStock };
      setFormItems(ni);
    } else {
      setFormItems([...formItems, {
        productCode: prod.productCode, productName: prod.shortName || prod.name || '',
        unit: prod.unit || '', spec: prod.spec || '', systemStock: sysStock, checkQty: sysStock + qty, diff: qty, remark: '',
      }]);
    }
    message.success(`已添加 ${prod.productCode}，盘点数量 +${qty}`);
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

  // 填充确认：按规格匹配明细行，写入盘点数量=模版数量×倍数并重算差异
  const handleQtyFillConfirm = useCallback((mult: number) => {
    if (!qtyFillTemplate) return;
    const findMatch = (it: CheckItem) => qtyFillTemplate.rows.find(r => {
      const sp = String(r.spec).trim();
      const pc = String(it.productCode || '').trim();
      const itsSpec = String(it.spec || '').trim();
      return !!sp && (sp === itsSpec || sp === pc || (pc && pc.includes(sp)) || (itsSpec && itsSpec.includes(sp)));
    });
    let filled = 0;
    const newItems = formItems.map(it => {
      const m = findMatch(it);
      if (m) { filled++; const cq = m.qty * mult; return { ...it, checkQty: cq, diff: cq - it.systemStock }; }
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

  const resetForm = () => { setFormItems([]); setFormRemark(''); setScanCode(''); setPickSearch(''); setPickQty({}); setCheckedTpl({}); };

  // 批量填充盘点数量：全部明细行 盘点数量 = 系统库存 + 默认数量
  const handleBatchFillQty = useCallback(() => {
    if (formItems.length === 0) { message.warning('请先添加盘点商品'); return; }
    const inc = scanDefaultQty || 1;
    setFormItems(formItems.map(it => ({ ...it, checkQty: it.systemStock + inc, diff: inc })));
    message.success(`已填充 ${formItems.length} 条盘点数量（系统库存 + ${inc}）`);
  }, [formItems, scanDefaultQty]);

  // 确认新增
  const handleConfirmAdd = useCallback(() => {
    if (formItems.length === 0) { message.warning('请至少添加一项商品'); return; }
    const docNo = generateDocNo('PD');
    const now = new Date().toLocaleString('zh-CN');
    const rec: CheckRecord = {
      key: docNo, docNo, items: formItems.map(i => ({ ...i })),
      operator: formOperator, createTime: now, status: '待生效', confirmTime: '', remark: formRemark,
    };
    saveData([rec, ...dataSource]);
    setAddVisible(false); resetForm();
    message.success(`盘点单 ${docNo} 已创建（待生效）`);
  }, [formItems, formOperator, formRemark, dataSource, saveData]);

  // 确认生效
  const handleConfirm = useCallback((rec: CheckRecord) => {
    Modal.confirm({
      title: '确认生效',
      icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
      content: `确定生效盘点单 ${rec.docNo} 吗？生效后将覆盖对应商品的实际库存。`,
      okText: '确认生效', okButtonProps: { style: { background: '#52c41a', borderColor: '#52c41a' } },
      cancelText: '取消', centered: true,
      onOk: () => {
        const owner = getDataOwner();
        rec.items.forEach(item => {
          updateProductStock(item.productCode, item.checkQty, {
            type: '盘点', changeQty: item.diff, beforeStock: item.systemStock,
            relatedDocNo: rec.docNo, operator: rec.operator, remark: rec.remark,
          }, owner);
        });
        const now = new Date().toLocaleString('zh-CN');
        const updated = dataSource.map(r => r.key === rec.key ? { ...r, status: '已生效' as const, confirmTime: now } : r);
        saveData(updated);
        message.success(`盘点单 ${rec.docNo} 已生效，库存已更新`);
      },
    });
  }, [dataSource, saveData]);

  // 导出
  const handleExport = useCallback(() => {
    const header = '盘点单号,明细数,盘点人,盘点时间,状态,确认时间,备注\n';
    const rows = filteredData.map(r =>
      `${r.docNo},${r.items.length},${r.operator},"${r.createTime}",${r.status},"${r.confirmTime}","${r.remark}"`
    ).join('\n');
    const blob = new Blob(['\ufeff' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `库存盘点记录_${new Date().toLocaleDateString()}.csv`; a.click();
  }, [dataSource]);

  // 统计
  const statsData = useMemo(() => ({
    total: dataSource.length,
    pending: dataSource.filter(r => r.status === '待生效').length,
    confirmed: dataSource.filter(r => r.status === '已生效').length,
  }), [dataSource]);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const q = searchText.toLowerCase();
    return dataSource.filter(r =>
      r.docNo.toLowerCase().includes(q) || r.operator.includes(q)
    );
  }, [dataSource, searchText]);

  const columns = [
    { title: '盘点单号', dataIndex: 'docNo', key: 'docNo', width: 150, align: 'center' as const, render: (v: string) => <Text strong>{v}</Text> },
    { title: '明细数', dataIndex: 'items', key: 'itemCount', width: 80, align: 'center' as const, render: (items: CheckItem[]) => items.length },
    { title: '盘点人', dataIndex: 'operator', key: 'operator', width: 90, align: 'center' as const },
    { title: '盘点时间', dataIndex: 'createTime', key: 'createTime', width: 160, align: 'center' as const },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90, align: 'center' as const,
      render: (v: string) => <Tag color={v === '已生效' ? 'green' : 'orange'}>{v}</Tag>,
    },
    { title: '确认时间', dataIndex: 'confirmTime', key: 'confirmTime', width: 160, align: 'center' as const, render: (v: string) => v || '—' },
    {
      title: '操作', key: 'action', width: 200, align: 'center' as const,
      render: (_: any, rec: CheckRecord) => (
        <Space>
          <Tooltip title="查看详情"><Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewRecord(rec)} style={{ color: PRIMARY }}>查看</Button></Tooltip>
          {rec.status === '待生效' && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleConfirm(rec)} style={{ color: '#52c41a', fontWeight: 500 }}>确认生效</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 12, background: '#fff', borderRadius: 8, flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* 统计卡片 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="盘点总数" value={statsData.total} suffix="单" valueStyle={{ fontSize: 18, color: PRIMARY }} /></Card></Col>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="待生效" value={statsData.pending} suffix="单" valueStyle={{ fontSize: 18, color: '#fa8c16' }} /></Card></Col>
        <Col xs={8}><Card size="small" bodyStyle={{ padding: '4px 12px' }}><Statistic title="已生效" value={statsData.confirmed} suffix="单" valueStyle={{ fontSize: 18, color: '#52c41a' }} /></Card></Col>
      </Row>

      {/* 工具栏 */}
      <Card size="small" bodyStyle={{ padding: '8px 16px' }} style={{ marginBottom: 12 }}>
        <Row gutter={8} align="middle">
          <Col><Input.Search placeholder="搜索单号/盘点人" value={searchText} onChange={e => setSearchText(e.target.value)} style={{ width: 220 }} allowClear /></Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>新增盘点</Button>
              <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 表格 */}
      <Table bordered size="small" pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
        dataSource={filteredData} rowKey="key" columns={columns} scroll={{ x: 900 }} />

      {/* 新增盘点弹窗 */}
      <Modal
        title={<span><AuditOutlined style={{ marginRight: 8, color: PRIMARY }} />新增库存盘点</span>}
        open={addVisible} onCancel={() => { setAddVisible(false); resetForm(); }}
        onOk={handleConfirmAdd} okText="保存盘点单" cancelText="取消" centered width={900} zIndex={1100}
      >
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={24}><Text type="secondary">备注</Text><Input value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="备注" /></Col>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Button size="small" icon={<EditOutlined />} onClick={handleBatchFillQty}>批量填充数量</Button>
        </div>
        <Table bordered size="small" pagination={false}
          dataSource={formItems} rowKey={(r, i) => r.productCode || String(i)}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', width: 120, align: 'center' as const },
            { title: '商品简称', dataIndex: 'productName', width: 120, align: 'center' as const },
            { title: '单位', dataIndex: 'unit', width: 60, align: 'center' as const },
            { title: '系统库存', dataIndex: 'systemStock', width: 80, align: 'center' as const, render: (v: number) => <span style={{ fontFamily: 'monospace', color: '#8c8c8c' }}>{v}</span> },
            { title: '盘点数量', dataIndex: 'checkQty', width: 90, align: 'center' as const,
              render: (v: number, _r: CheckItem, idx: number) => (
                <InputNumber controls={false} size="small" value={v} min={0} precision={0} style={{ width: 70 }}
                  onChange={val => {
                    const ni = [...formItems];
                    ni[idx].checkQty = val || 0;
                    ni[idx].diff = (val || 0) - ni[idx].systemStock;
                    setFormItems(ni);
                  }} />
              ),
            },
            { title: '差异', dataIndex: 'diff', width: 80, align: 'center' as const,
              render: (v: number) => {
                const color = v > 0 ? '#52c41a' : v < 0 ? '#ff4d4f' : '#8c8c8c';
                return <Text strong style={{ color, fontFamily: 'monospace' }}>{v > 0 ? '+' : ''}{v}</Text>;
              },
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
        title={`盘点单详情 — ${viewRecord?.docNo || ''}`}
        open={!!viewRecord} onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>关闭</Button>}
        centered width={800} zIndex={1100}
      >
        {viewRecord && (
          <>
            <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="盘点单号">{viewRecord.docNo}</Descriptions.Item>
              <Descriptions.Item label="盘点人">{viewRecord.operator}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={viewRecord.status === '已生效' ? 'green' : 'orange'}>{viewRecord.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="盘点时间">{viewRecord.createTime}</Descriptions.Item>
              <Descriptions.Item label="确认时间">{viewRecord.confirmTime || '—'}</Descriptions.Item>
              <Descriptions.Item label="备注">{viewRecord.remark || '—'}</Descriptions.Item>
            </Descriptions>
            <Table bordered size="small" pagination={false}
              dataSource={viewRecord.items} rowKey={(r, i) => r.productCode || String(i)}
              columns={[
                { title: '商品编码', dataIndex: 'productCode', align: 'center' as const },
                { title: '商品简称', dataIndex: 'productName', align: 'center' as const },
                { title: '单位', dataIndex: 'unit', align: 'center' as const, width: 60 },
                { title: '系统库存', dataIndex: 'systemStock', align: 'center' as const, width: 80 },
                { title: '盘点数量', dataIndex: 'checkQty', align: 'center' as const, width: 80 },
                { title: '差异', dataIndex: 'diff', align: 'center' as const, width: 80,
                  render: (v: number) => <Text strong style={{ color: v > 0 ? '#52c41a' : v < 0 ? '#ff4d4f' : '#8c8c8c' }}>{v > 0 ? '+' : ''}{v}</Text>,
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default InventoryCheckPage;
