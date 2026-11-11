import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Card, Row, Col, Table, Typography, Button, Space, Input, Modal,
  InputNumber, Tag, Tooltip, message, Descriptions, Statistic, Checkbox, Progress, Select,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EyeOutlined, ExportOutlined,
  CheckCircleOutlined, BarcodeOutlined, AuditOutlined, AppstoreOutlined, CheckOutlined, FileTextOutlined, EditOutlined,
  UploadOutlined, FileExcelOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
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

// 表格导入目标字段与表头同义词（自动匹配用，忽略大小写/空格）
const IMPORT_FIELDS: { key: string; label: string; required?: boolean; synonyms: string[] }[] = [
  { key: 'productCode', label: '商品编码', required: true, synonyms: ['商品编码', '编码', '货号', '条形码', '条码', '款式编码', 'productcode', 'code'] },
  { key: 'checkQty', label: '盘点数量', synonyms: ['盘点数量', '盘点数', '数量', '实盘数量', '实盘数', 'checkqty', 'qty'] },
  { key: 'productName', label: '商品简称', synonyms: ['商品简称', '商品名称', '品名', '名称', '简称'] },
  { key: 'unit', label: '单位', synonyms: ['单位', 'unit'] },
  { key: 'remark', label: '备注', synonyms: ['备注', '说明', 'remark'] },
];

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
  // 表格导入：字段匹配与导入进度
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<null | {
    fileName: string; headers: string[]; rows: Record<string, any>[];
    mapping: Record<string, string>; stage: 'mapping' | 'importing' | 'done';
    progress: number; imported: number; skipped: number; total: number; skippedCodes: string[];
  }>(null);

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

  const resetForm = () => { setFormItems([]); setFormRemark(''); setScanCode(''); setPickSearch(''); setPickQty({}); setCheckedTpl({}); setImportState(null); };

  // 解析导入表格（xlsx/xls/csv）：首行为表头，自动匹配字段后进入映射确认态
  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      if (!json.length) { message.warning('表格为空或无法解析，请检查文件'); return; }
      const headers = Object.keys(json[0]).map(h => String(h));
      const mapping: Record<string, string> = {};
      IMPORT_FIELDS.forEach(f => {
        const norm = (s: string) => s.trim().toLowerCase();
        const hit = headers.find(h => f.synonyms.some(s => norm(h) === norm(s)))
          || headers.find(h => h.trim() && f.synonyms.some(s => norm(h).includes(norm(s)) || norm(s).includes(norm(h))));
        if (hit) mapping[f.key] = hit;
      });
      setImportState({ fileName: file.name, headers, rows: json, mapping, stage: 'mapping', progress: 0, imported: 0, skipped: 0, total: json.length, skippedCodes: [] });
      if (!mapping.productCode) message.error('未自动匹配到商品编码列，请在下方手动选择对应列后再导入');
      else message.success(`已解析 ${json.length} 行，请确认字段匹配后开始导入`);
    } catch {
      message.error('文件解析失败，请确认是 xlsx/xls/csv 格式');
    }
  };

  // 执行导入：分块处理并实时更新进度；盘点数量列有映射时按绝对盘点数，无映射时按默认数量累加（与扫码同口径）
  const runImport = () => {
    if (!importState || !importState.mapping.productCode) return;
    const { rows, mapping } = importState;
    const codeCol = mapping.productCode; const qtyCol = mapping.checkQty || ''; const nameCol = mapping.productName || ''; const unitCol = mapping.unit || ''; const remarkCol = mapping.remark || '';
    const prodMap = new Map<string, any>(productList.map((p: any) => [String(p.productCode), p]));
    const merged = new Map<string, CheckItem>(formItems.map(it => [it.productCode, { ...it }]));
    let i = 0; let imported = 0; const skippedCodes: string[] = [];
    const CHUNK = 200;
    setImportState(s => (s ? { ...s, stage: 'importing', progress: 0, imported: 0, skipped: 0, skippedCodes: [] } : s));
    const step = () => {
      const end = Math.min(i + CHUNK, rows.length);
      for (; i < end; i++) {
        const r = rows[i];
        const code = String(r[codeCol] ?? '').trim();
        if (!code) { if (skippedCodes.length < 200) skippedCodes.push(`第${i + 2}行(空编码)`); continue; }
        const prod = prodMap.get(code);
        if (!prod) { if (skippedCodes.length < 200) skippedCodes.push(code); continue; }
        const sysStock = Number(prod.actualStock) || 0;
        const qtyNum = qtyCol ? Number(String(r[qtyCol]).replace(/[^\d.-]/g, '')) : NaN;
        const hasQty = qtyCol && Number.isFinite(qtyNum) && String(r[qtyCol]).trim() !== '';
        const remark = remarkCol ? String(r[remarkCol] ?? '').trim() : '';
        const cur = merged.get(code);
        if (cur) {
          cur.checkQty = hasQty ? qtyNum : cur.checkQty + scanDefaultQty;
          cur.diff = cur.checkQty - cur.systemStock;
          if (remark) cur.remark = remark;
        } else {
          const checkQty = hasQty ? qtyNum : sysStock + scanDefaultQty;
          merged.set(code, {
            productCode: code,
            productName: (nameCol && String(r[nameCol] ?? '').trim()) || prod.shortName || prod.name || '',
            unit: (unitCol && String(r[unitCol] ?? '').trim()) || prod.unit || '',
            spec: prod.spec || '', systemStock: sysStock, checkQty, diff: checkQty - sysStock, remark,
          });
        }
        imported++;
      }
      const pct = Math.round((i / rows.length) * 100);
      setImportState(s => (s ? { ...s, progress: pct, imported, skipped: skippedCodes.length, skippedCodes: skippedCodes.slice(0, 200) } : s));
      if (i < rows.length) { setTimeout(step, 0); return; }
      setFormItems(Array.from(merged.values()));
      setImportState(s => (s ? { ...s, stage: 'done', progress: 100, imported, skipped: skippedCodes.length, skippedCodes: skippedCodes.slice(0, 200) } : s));
      message.success(`导入完成：成功 ${imported} 条，跳过 ${skippedCodes.length} 条`);
    };
    setTimeout(step, 0);
  };

  // 批量填充盘点数量：全部明细行 盘点数量 = 系统库存 + 默认数量
  const handleBatchFillQty = useCallback(() => {
    if (formItems.length === 0) { message.warning('请先添加盘点商品'); return; }
    const inc = scanDefaultQty || 1;
    setFormItems(formItems.map(it => ({ ...it, checkQty: it.systemStock + inc, diff: inc })));
    message.success(`已填充 ${formItems.length} 条盘点数量（系统库存 + ${inc}）`);
  }, [formItems, scanDefaultQty]);

  // 确认新增：盘点单创建即生效——盘点数量覆盖商品列表实际库存（用户契约：库存盘点=实际库存真值源）
  const handleConfirmAdd = useCallback(() => {
    if (formItems.length === 0) { message.warning('请至少添加一项商品'); return; }
    const docNo = generateDocNo('PD');
    const now = new Date().toLocaleString('zh-CN');
    const owner = getDataOwner();
    const rec: CheckRecord = {
      key: docNo, docNo, items: formItems.map(i => ({ ...i })),
      operator: formOperator, createTime: now, status: '已生效', confirmTime: now, remark: formRemark,
    };
    formItems.forEach(i => {
      updateProductStock(i.productCode, i.checkQty, {
        type: '盘点', changeQty: i.diff, beforeStock: i.systemStock,
        relatedDocNo: docNo, operator: formOperator, remark: i.remark,
      }, owner);
    });
    saveData([rec, ...dataSource]);
    setAddVisible(false); resetForm();
    message.success(`盘点单 ${docNo} 已创建并生效，实际库存已按盘点数量覆盖更新`);
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
       <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
          <Button size="small" icon={<UploadOutlined />} onClick={() => importFileRef.current?.click()}>导入表格</Button>
          <Button size="small" icon={<EditOutlined />} onClick={handleBatchFillQty}>批量填充数量</Button>
        </div>
        <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
        {/* 导入字段匹配与进度面板 */}
        {importState && (
          <div style={{ border: '1px solid #91caff', background: '#f0f7ff', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
              <Text strong style={{ fontSize: 13 }}><FileExcelOutlined style={{ marginRight: 6, color: '#389e0d' }} />表格导入：{importState.fileName}（共 {importState.total} 行）</Text>
              {importState.stage === 'mapping' && (
                <Space size={6}>
                  <Button size="small" type="primary" disabled={!importState.mapping.productCode} onClick={runImport}>开始导入</Button>
                  <Button size="small" onClick={() => setImportState(null)}>取消</Button>
                </Space>
              )}
              {importState.stage === 'done' && <Button size="small" onClick={() => setImportState(null)}>关闭</Button>}
            </div>
            {importState.stage === 'mapping' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 16px', marginBottom: 6 }}>
                {IMPORT_FIELDS.map(f => {
                  const src = importState.mapping[f.key] || '';
                  return (
                    <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 12, width: 70, flexShrink: 0 }}>{f.label}{f.required && <span style={{ color: '#f5222d' }}>*</span>}</Text>
                      <Select size="small" style={{ flex: 1, minWidth: 0 }} value={src || undefined} placeholder="不导入" allowClear
                        onChange={v => setImportState(s => (s ? { ...s, mapping: { ...s.mapping, [f.key]: v || '' } } : s))}
                        options={importState.headers.map(h => ({ value: h, label: h }))} />
                      <Tag color={src ? 'green' : (f.required ? 'red' : 'orange')} style={{ marginInlineEnd: 0, fontSize: 11 }}>{src ? '已匹配' : (f.required ? '缺必填' : '未匹配')}</Tag>
                    </div>
                  );
                })}
              </div>
            )}
            {(importState.stage === 'importing' || importState.stage === 'done') && (
              <>
                <Progress percent={importState.progress} size="small" status={importState.stage === 'done' ? 'success' : 'active'} />
                <div style={{ fontSize: 12, color: '#5a6d85', marginTop: 4 }}>
                  已处理 {Math.min(importState.imported + importState.skipped, importState.total)}/{importState.total} 行 · 匹配成功 <span style={{ color: '#52c41a', fontWeight: 600 }}>{importState.imported}</span> · 跳过 <span style={{ color: '#fa8c16', fontWeight: 600 }}>{importState.skipped}</span>
                  {importState.stage === 'done' && importState.skippedCodes.length > 0 && (
                    <div style={{ marginTop: 4, color: '#fa8c16', wordBreak: 'break-all' }}>跳过明细（商品编码为空或商品列表不存在）：{importState.skippedCodes.join('、')}{importState.skipped > importState.skippedCodes.length ? ` 等共 ${importState.skipped} 条` : ''}</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
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
