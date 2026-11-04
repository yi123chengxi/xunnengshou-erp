import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber,
  Row, Col, Popconfirm, Tag, Image, Select, DatePicker, AutoComplete,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, PictureOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import useResizableColumns from '../hooks/useResizableColumns';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { updateInboxStatus, readInbox, upsertInboxEntry, normInvoiceStatus, resolveSupplier } from '../utils/invoiceApply';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const { TextArea } = Input;
const PRIMARY = '#1e4a7e';

// ===================== 类型定义 =====================
interface InvoiceRecord {
  key: string;
  companyName: string;
  invoiceType: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  date: string;
  creator: string;
  remark: string;
  image: string;
  createdAt: string;
  // 开票申请生成记录的扩展字段（手动新增记录无这些字段）
  source?: 'manual' | 'apply';
  applyNo?: string;
  applyMonths?: string[];
  invoiceStatus?: '待开票' | '开票成功' | '已开票'; // '已开票'为历史存量值，读取侧归一为'开票成功'
  invoiceSupplier?: string;
  supplierUsername?: string;
  pushStatus?: '推送成功' | '待推送' | '已推送';
  projectName?: string;
  gapAmount?: number; // 消耗的进项差额缺口（按比例开票时大于发票金额）
  taxRate?: number; // 税率（小规模 1%、一般纳税人 13%）
}

// 发票类型选项
const INVOICE_TYPES = [
  { label: '销售发票', value: '销售发票', color: 'red' },
  { label: '进项票', value: '进项票', color: 'orange' },
];

// ===================== 工具函数 =====================
const getDataOwner = (): string => {
  const username = localStorage.getItem('username') || '';
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  return isSub ? (localStorage.getItem('parentAccount') || username) : username;
};

// 获取当前操作人显示名称（从账号管理读取姓名）
const getCurrentUserDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    // 优先从账号管理数据中查找
    const owner = getDataOwner();
    const accounts = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
    const account = accounts.find((a: any) => a.username === username);
    if (account?.displayName) return account.displayName;
  } catch { /* ignore */ }
  try {
    // 回退到 registeredUsers
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const user = users.find((u: any) => u.username === username);
    if (user?.displayName) return user.displayName;
  } catch { /* ignore */ }
  return username;
};

// 根据用户名解析显示名称（从账号管理读取姓名）
const resolveDisplayName = (username: string): string => {
  if (!username) return '';
  try {
    // 优先从账号管理数据中查找
    const owner = getDataOwner();
    const accounts = JSON.parse(localStorage.getItem(`accounts_${owner}`) || '[]');
    const account = accounts.find((a: any) => a.username === username);
    if (account?.displayName) return account.displayName;
  } catch { /* ignore */ }
  try {
    // 回退到 registeredUsers
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const user = users.find((u: any) => u.username === username);
    if (user?.displayName) return user.displayName;
  } catch { /* ignore */ }
  return username;
};

// ===================== 主组件 =====================
const InvoiceRecordPage: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const storageKey = `invoice_record_${owner}`;

  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  // 字段拆分搜索（去重候选）
  const [fCompany, setFCompany] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPush, setFPush] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fProject, setFProject] = useState('');
  const [fCreator, setFCreator] = useState('');
  const [fMonth, setFMonth] = useState('');

  // 编辑弹窗
  const [editVisible, setEditVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<InvoiceRecord | null>(null);
  const [formCompany, setFormCompany] = useState('');
  const [formType, setFormType] = useState('');
  const [formQuantity, setFormQuantity] = useState<number>(0);
  const [formPrice, setFormPrice] = useState<number>(0);
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formDate, setFormDate] = useState('');
  const [formCreator, setFormCreator] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formImage, setFormImage] = useState('');
  const [formProjectName, setFormProjectName] = useState('');
  const [formSupplier, setFormSupplier] = useState('');

  // 从营业执照中获取公司名称列表
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  // 供应商合作状态映射（采购商平台供应商列表，按名称/简称索引）
  const [supplierCoop, setSupplierCoop] = useState<Record<string, any>>({});

  // ===================== 数据加载 =====================
  const reload = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setRecords([]); }
    try {
      const licenses = JSON.parse(localStorage.getItem(`business_license_${owner}`) || '[]');
      setCompanyNames(licenses.map((l: any) => l.companyName).filter(Boolean));
    } catch { setCompanyNames([]); }
    try {
      const sup = JSON.parse(localStorage.getItem(`purchaser_suppliers_${owner}`) || '[]');
      const m: Record<string, any> = {};
      sup.forEach((s: any) => {
        if (s.supplierName) m[s.supplierName] = s;
        if (s.shortName && !m[s.shortName]) m[s.shortName] = s;
      });
      setSupplierCoop(m);
    } catch { setSupplierCoop({}); }
  }, [storageKey, owner]);
  useEffect(() => { reload(); }, [reload]);

  const saveRecords = (list: InvoiceRecord[]) => {
    const json = JSON.stringify(list);
    safeSetItem(storageKey, json);
    safeSetItem(`${storageKey}_ts`, String(Date.now()));
    saveDataset(storageKey, json);
    setRecords(list);
  };

  // ===================== CRUD =====================
  const resetForm = () => {
    setFormCompany(''); setFormType(''); setFormQuantity(0); setFormPrice(0);
    setFormAmount(0); setFormDate(dayjs().format('YYYY-MM-DD')); setFormCreator(getCurrentUserDisplayName()); setFormRemark(''); setFormImage(''); setFormProjectName(''); setFormSupplier('');
  };

  const openAdd = () => {
    setEditingRecord(null);
    resetForm();
    setEditVisible(true);
  };

  const openEdit = (r: InvoiceRecord) => {
    setEditingRecord(r);
    setFormCompany(r.companyName);
    setFormType(r.invoiceType);
    setFormQuantity(r.quantity || 0);
    setFormPrice(r.unitPrice || 0);
    setFormAmount(r.amount || 0);
    setFormDate(r.date || '');
    setFormCreator(r.creator || '');
    setFormRemark(r.remark || '');
    setFormImage(r.image || '');
    setFormProjectName(r.projectName || '');
    setFormSupplier(r.invoiceSupplier || '');
    setEditVisible(true);
  };

  const handleSave = () => {
    if (!formCompany.trim()) { message.warning('请选择公司名称'); return; }
    if (!formType) { message.warning('请选择发票类型'); return; }
    const list = [...records];
    const data = {
      companyName: formCompany.trim(),
      invoiceType: formType,
      quantity: formQuantity || 0,
      unitPrice: formPrice || 0,
      amount: formAmount || 0,
      date: formDate,
      creator: formCreator.trim(),
      remark: formRemark.trim(),
      image: formImage,
      projectName: formProjectName.trim(),
    };
    // 开票供应商：仅未推送（待推送）可改；已推送/推送成功锁定保留原值
    const supplierFields = supplierLocked ? {} : (() => {
      const supName = formSupplier.trim();
      const resolved = supName ? resolveSupplier(owner, supName) : { username: '', cooperated: false };
      return { invoiceSupplier: supName, supplierUsername: resolved.username || '' };
    })();
    if (editingRecord) {
      const idx = list.findIndex(r => r.key === editingRecord.key);
      if (idx >= 0) list[idx] = { ...list[idx], ...data, ...supplierFields };
    } else {
      list.push({ key: `inv-${Date.now()}`, ...data, ...supplierFields, createdAt: new Date().toLocaleString('zh-CN') });
    }
    saveRecords(list);
    setEditVisible(false);
    message.success(editingRecord ? '记录已更新' : '记录已添加');
  };

  // 编辑弹窗中开票供应商是否锁定（已推送/推送成功不可修改）
  const supplierLocked = !!editingRecord && (editingRecord.pushStatus === '已推送' || editingRecord.pushStatus === '推送成功');

  const handleDelete = (key: string) => {
    saveRecords(records.filter(r => r.key !== key));
    message.success('记录已删除');
  };

  // 开票状态变更（申请记录，手动）：开票成功为供应商同步专属状态不可手改，手动仅可在待开票/已开票间调整
  const handleInvoiceStatusChange = (r: InvoiceRecord, status: '待开票' | '已开票') => {
    const list = records.map(x => (x.key === r.key ? { ...x, invoiceStatus: status } : x));
    saveRecords(list);
    if (r.supplierUsername && r.applyNo) updateInboxStatus(r.supplierUsername, r.applyNo, status);
    message.success(status === '已开票' ? '已标记为已开票' : '已恢复为待开票');
  };

  // 推送状态变更（申请记录）：手动调成已推送时，若供应商账号可解析且收件箱无此单则补推送
  const handlePushStatusChange = (r: InvoiceRecord, status: '推送成功' | '待推送' | '已推送') => {
    const list = records.map(x => (x.key === r.key ? { ...x, pushStatus: status } : x));
    saveRecords(list);
    if (status === '已推送' && r.supplierUsername && r.applyNo) {
      const inbox = readInbox(r.supplierUsername);
      if (!inbox.some(x => x.applyNo === r.applyNo)) {
        upsertInboxEntry(r.supplierUsername, {
          key: r.applyNo, applyNo: r.applyNo, applicantUsername: owner, applicantCompany: r.companyName,
          supplierName: r.invoiceSupplier || '', projectName: r.projectName || '', amount: r.amount || 0,
          quantity: r.quantity || 0, unitPrice: r.unitPrice || 0, months: r.applyMonths || [],
          applyDate: r.date || dayjs().format('YYYY-MM-DD'), status: normInvoiceStatus(r.invoiceStatus), remark: '补推送',
        });
        message.success('已补推送到供应商开票申请');
        return;
      }
    }
    message.success('推送状态已更新');
  };

  // 自动计算金额
  const handleQuantityChange = (v: number | null) => {
    const q = v || 0;
    setFormQuantity(q);
    setFormAmount(Math.round(q * formPrice * 100) / 100);
  };
  const handlePriceChange = (v: number | null) => {
    const p = v || 0;
    setFormPrice(p);
    setFormAmount(Math.round(formQuantity * p * 100) / 100);
  };

  // 图片粘贴上传
  const handleImagePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = (ev) => { setFormImage(ev.target?.result as string); };
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, []);

  // ===================== 过滤（字段拆分搜索） =====================
  const filtered = useMemo(() => records.filter(r => {
    if (fCompany && (r.companyName || '') !== fCompany) return false;
    if (fType && (r.invoiceType || '') !== fType) return false;
    if (fStatus && (r.source !== 'apply' || normInvoiceStatus(r.invoiceStatus) !== fStatus)) return false;
    if (fPush && (r.source !== 'apply' || (r.pushStatus || '待推送') !== fPush)) return false;
    if (fSupplier && (r.invoiceSupplier || '') !== fSupplier) return false;
    if (fProject && (r.projectName || '') !== fProject) return false;
    if (fCreator && !(r.creator || '').toLowerCase().includes(fCreator.toLowerCase())) return false;
    if (fMonth && !String(r.date || '').startsWith(fMonth)) return false;
    return true;
  }), [records, fCompany, fType, fStatus, fPush, fSupplier, fProject, fCreator, fMonth]);

  const resetFilters = () => {
    setFCompany(''); setFType(''); setFStatus(''); setFPush('');
    setFSupplier(''); setFProject(''); setFCreator(''); setFMonth('');
  };

  // 去重候选项
  const companyOptions = useMemo(() => Array.from(new Set([...companyNames, ...records.map(r => r.companyName).filter(Boolean)])), [companyNames, records]);
  const supplierOptions = useMemo(() => Array.from(new Set(records.map(r => r.invoiceSupplier).filter(Boolean))), [records]);
  const projectOptions = useMemo(() => Array.from(new Set(records.map(r => r.projectName).filter(Boolean))), [records]);

  // 列宽拖拽
  const { wrapColumns } = useResizableColumns<InvoiceRecord>(`colWidths_invoiceRecord_${owner}`);

  // ===================== 表格列 =====================
  const columns: ColumnsType<InvoiceRecord> = [
    { title: '公司名称', dataIndex: 'companyName', key: 'companyName', width: 180, fixed: 'left' as const,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: '发票类型', dataIndex: 'invoiceType', key: 'invoiceType', width: 110, align: 'center' as const,
      render: (v: string) => {
        const t = INVOICE_TYPES.find(it => it.value === v);
        return v ? <Tag color={t?.color || 'default'}>{v}</Tag> : <Text type="secondary">—</Text>;
      } },
    { title: '项目名称', dataIndex: 'projectName', key: 'projectName', width: 140, ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '开票状态', dataIndex: 'invoiceStatus', key: 'invoiceStatus', width: 124, align: 'center' as const,
      render: (v: string, r: InvoiceRecord) => {
        if (r.source !== 'apply') return <Text type="secondary">—</Text>;
        // 开票成功 = 供应商点开票完成同步的专属状态，只读不可改
        if (normInvoiceStatus(v) === '开票成功') return <Tag color="green" style={{ margin: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px' }}>开票成功</Tag>;
        return (
          <Select size="small" style={{ width: 104 }} value={normInvoiceStatus(v)}
            onChange={(nv: any) => handleInvoiceStatusChange(r, nv)}
            options={[{ value: '待开票', label: <Tag color="red" style={{ margin: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px' }}>待开票</Tag> }, { value: '已开票', label: <Tag color="green" style={{ margin: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px' }}>已开票</Tag> }]} />
        );
      } },
    { title: '开票供应商', dataIndex: 'invoiceSupplier', key: 'invoiceSupplier', width: 160, ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '合作状态', key: 'coopStatus', width: 100, align: 'center' as const,
      render: (_: any, r: InvoiceRecord) => {
        if (!r.invoiceSupplier) return <Text type="secondary">—</Text>;
        const entry = supplierCoop[r.invoiceSupplier];
        if (!entry) return <Tag color="default">未合作</Tag>;
        switch (entry.cooperationStatus) {
          case 'approved': return <Tag color="green">合作中</Tag>;
          case 'pending': return <Tag color="orange">待合作</Tag>;
          case 'terminating': return <Tag color="orange">终止中</Tag>;
          case 'terminated': return <Tag color="default">已终止</Tag>;
          case 'rejected': return <Tag color="red">已拒绝</Tag>;
          default: return <Tag color="default">未合作</Tag>;
        }
      } },
    { title: '推送状态', dataIndex: 'pushStatus', key: 'pushStatus', width: 124, align: 'center' as const,
      render: (v: string, r: InvoiceRecord) => r.source === 'apply' ? (
        <Select size="small" style={{ width: 104 }} value={v || '待推送'}
          onChange={(nv: any) => handlePushStatusChange(r, nv)}
          options={[{ value: '推送成功', label: <Tag color="green" style={{ margin: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px' }}>推送成功</Tag> }, { value: '待推送', label: <Tag color="red" style={{ margin: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px' }}>待推送</Tag> }, { value: '已推送', label: <Tag color="green" style={{ margin: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px' }}>已推送</Tag> }]} />
      ) : <Text type="secondary">—</Text> },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right' as const,
      render: (v: number) => v ? v : <Text type="secondary">—</Text> },
    { title: '平均单价', dataIndex: 'unitPrice', key: 'unitPrice', width: 110, align: 'right' as const,
      render: (v: number) => v ? `¥${v.toFixed(2)}` : <Text type="secondary">—</Text> },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const,
      render: (v: number) => v ? <Text strong>¥{v.toFixed(2)}</Text> : <Text type="secondary">—</Text> },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 120,
      render: (v: string) => resolveDisplayName(v) || <Text type="secondary">—</Text> },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 160, ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: '图片', dataIndex: 'image', key: 'image', width: 80, align: 'center' as const,
      render: (v: string) => v ? (
        <Image src={v} width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }}
          preview={{ mask: <PictureOutlined /> }} />
      ) : <Text type="secondary">—</Text> },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
    { title: '操作', key: 'action', width: 140, fixed: 'right' as const,
      render: (_: any, r: InvoiceRecord) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除此记录？" onConfirm={() => handleDelete(r.key)} okText="确认" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 0 }}>
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '16px 24px' }}>
        <Row align="middle">
          <Col>
            <Space>
              <FileTextOutlined style={{ fontSize: 22, color: PRIMARY }} />
              <Title level={4} style={{ margin: 0, color: PRIMARY }}>开票记录</Title>
              <Tag color="blue">{records.length} 条记录</Tag>
              <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增</Button>
            </Space>
          </Col>
        </Row>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select placeholder="公司名称" allowClear showSearch style={{ width: 180 }} value={fCompany || undefined}
            onChange={v => setFCompany(v || '')} options={companyOptions.map(n => ({ value: n, label: n }))}
            filterOption={(input, option) => String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())} />
          <Select placeholder="发票类型" allowClear style={{ width: 120 }} value={fType || undefined}
            onChange={v => setFType(v || '')} options={INVOICE_TYPES.map(t => ({ value: t.value, label: t.label }))} />
          <Select placeholder="开票状态" allowClear style={{ width: 120 }} value={fStatus || undefined}
            onChange={v => setFStatus(v || '')} options={[{ value: '待开票', label: '待开票' }, { value: '已开票', label: '已开票' }, { value: '开票成功', label: '开票成功' }]} />
          <Select placeholder="推送状态" allowClear style={{ width: 110 }} value={fPush || undefined}
            onChange={v => setFPush(v || '')} options={[{ value: '推送成功', label: '推送成功' }, { value: '待推送', label: '待推送' }, { value: '已推送', label: '已推送' }]} />
          <Select placeholder="开票供应商" allowClear showSearch style={{ width: 160 }} value={fSupplier || undefined}
            onChange={v => setFSupplier(v || '')} options={supplierOptions.map(n => ({ value: n, label: n }))}
            filterOption={(input, option) => String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())} />
          <Select placeholder="项目名称" allowClear showSearch style={{ width: 160 }} value={fProject || undefined}
            onChange={v => setFProject(v || '')} options={projectOptions.map(n => ({ value: n, label: n }))}
            filterOption={(input, option) => String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())} />
          <Input placeholder="创建人" allowClear style={{ width: 120 }} value={fCreator} onChange={e => setFCreator(e.target.value)} />
          <DatePicker picker="month" placeholder="日期月份" allowClear style={{ width: 130 }}
            value={fMonth ? dayjs(fMonth) : null} onChange={d => setFMonth(d ? d.format('YYYY-MM') : '')} />
          <Button icon={<ReloadOutlined />} onClick={resetFilters}>重置</Button>
        </div>
      </Card>

      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table<InvoiceRecord>
          bordered
          columns={wrapColumns(columns)}
          dataSource={filtered}
          rowKey="key"
          scroll={{ y: 'calc(100vh - 360px)' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条记录` }}
          size="middle"
          locale={{ emptyText: '暂无记录，请点击"新增"添加' }}
        />
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal title={editingRecord ? '编辑开票记录' : '新增开票记录'} open={editVisible}
        onCancel={() => setEditVisible(false)} onOk={handleSave}
        okText={editingRecord ? '保存' : '添加'} cancelText="取消" width={560}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>公司名称 <Text type="danger">*</Text></Text></div>
          <Select value={formCompany || undefined} onChange={v => setFormCompany(v || '')} placeholder="请选择公司名称"
            allowClear showSearch style={{ width: '100%' }}
            filterOption={(input, option) =>
              String((option as any)?.label || '').toLowerCase().includes(input.toLowerCase())
            }
            options={companyNames.map(n => ({ value: n, label: n }))}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>发票类型 <Text type="danger">*</Text></Text></div>
          <Select value={formType || undefined} onChange={v => setFormType(v || '')} placeholder="请选择发票类型"
            style={{ width: '100%' }}
            options={INVOICE_TYPES.map(t => ({ value: t.value, label: t.label }))}
          />
        </div>
        <Row gutter={16}>
          <Col span={8}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}><Text>数量</Text></div>
              <InputNumber value={formQuantity} onChange={handleQuantityChange} min={0} style={{ width: '100%' }} placeholder="数量" />
            </div>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}><Text>平均单价</Text></div>
              <InputNumber value={formPrice} onChange={handlePriceChange} min={0} precision={2} style={{ width: '100%' }} placeholder="单价" />
            </div>
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}><Text>金额</Text></div>
              <InputNumber value={formAmount} onChange={v => setFormAmount(v || 0)} min={0} precision={2} style={{ width: '100%' }} placeholder="金额" />
            </div>
          </Col>
        </Row>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>日期</Text></div>
          <DatePicker value={formDate ? dayjs(formDate) : null}
            onChange={(d) => setFormDate(d ? d.format('YYYY-MM-DD') : '')}
            style={{ width: '100%' }} placeholder="请选择日期" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>项目名称</Text></div>
          <Input value={formProjectName} onChange={e => setFormProjectName(e.target.value)} placeholder="请输入项目名称（选填）" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>开票供应商 {supplierLocked && <Text type="secondary" style={{ fontSize: 12 }}>（已推送/推送成功，不可修改）</Text>}</Text></div>
          <AutoComplete value={formSupplier} onChange={v => setFormSupplier(v)} disabled={supplierLocked}
            placeholder="选择/输入供应商名称" style={{ width: '100%' }}
            filterOption={(input, option) => String((option as any)?.value || '').toLowerCase().includes(input.toLowerCase())}
            options={Object.keys(supplierCoop).map(n => ({ value: n, label: n }))} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}><Text>备注</Text></div>
          <TextArea value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="请输入备注信息" rows={2} />
        </div>
        <div style={{ marginBottom: 16 }} onPaste={handleImagePaste}>
          <div style={{ marginBottom: 6 }}><Text>图片 <Text type="secondary" style={{ fontSize: 12 }}>（支持粘贴 Ctrl+V）</Text></Text></div>
          {formImage ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Image src={formImage} width={120} height={120} style={{ objectFit: 'cover', borderRadius: 8 }} />
              <Button size="small" danger type="text" icon={<DeleteOutlined />}
                onClick={() => setFormImage('')}
                style={{ position: 'absolute', top: -8, right: -8 }} />
            </div>
          ) : (
            <div style={{ width: 120, height: 120, border: '2px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999' }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'image/*';
                input.onchange = (ev: any) => {
                  const file = ev.target?.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (e) => { setFormImage(e.target?.result as string); };
                  reader.readAsDataURL(file);
                };
                input.click();
              }}>
              <div style={{ textAlign: 'center' }}>
                <PictureOutlined style={{ fontSize: 24 }} />
                <div style={{ fontSize: 12, marginTop: 4 }}>点击/粘贴</div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default InvoiceRecordPage;
