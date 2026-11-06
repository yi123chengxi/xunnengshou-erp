import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Card, Row, Col, Typography, Button, Space, Tag, Input, Tooltip, Modal, Form, Select,
  message, Drawer, Descriptions, Divider, Empty, Progress, Upload, Image, Popconfirm,
  InputNumber, Radio, DatePicker, Alert, Dropdown,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  WarningOutlined, CheckCircleOutlined, ClockCircleOutlined, SyncOutlined,
  FileTextOutlined, PrinterOutlined, EyeOutlined, SaveOutlined, UploadOutlined,
  PlayCircleOutlined, PauseCircleOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  DownOutlined, UpOutlined, CloseOutlined, InboxOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { INDUSTRY_TEMPLATES } from './WorkflowTemplatePage';
import dayjs from 'dayjs';
import type { UploadFile } from 'antd';

const { Title, Text } = Typography;
const { TextArea } = Input;

// 统一蓝色系（与目标软件一致）
const PRIMARY = '#1e4a7e';
const PRIMARY_LIGHT = '#e8f4fc';
const BG_GRADIENT = 'linear-gradient(180deg, #f0f7ff 0%, #e8f0f9 100%)';

// ============================================================
// 类型定义
// ============================================================
export type WorkflowNode = {
  name: string;
  icon: string;
  description?: string;
  estimatedDays?: number;
  requireLogisticsReceipt?: boolean;
};

type CustomRequirement = {
  productName: string;
  productModel: string;
  quantity: string;
  detail: string;
  packaging: string;
  packagingDetail?: string;
  payment: string;
  deadline: string;
  images?: { desc: string; url: string }[];
  productImages?: { url: string }[];
  packagingImages?: { url: string }[];
};

export type ProgressRecord = {
  id: string;
  stepIndex: number;
  stepName: string;
  note: string | null;
  images: string[] | string;
  operatorName: string | null;
  createdAt: string;
};

export type CustomOrder = {
  id: string;
  orderId: string;             // 关联销售订单号
  orderNo: string;             // 订单号（展示用）
  customerName: string;
  buyerContact: string;
  totalAmount: number;
  owner: string;
  templateId: string | null;
  customNodes: WorkflowNode[] | null;
  customRequirement: CustomRequirement | null;
  currentStep: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABNORMAL' | 'PAUSED';
  records: ProgressRecord[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  industry: string;
  nodes: WorkflowNode[];
  isDefault?: boolean;
};

export const DEFAULT_NODES: WorkflowNode[] = [
  { name: '接单审核', icon: '📋', description: '审核订单信息' },
  { name: '生产加工', icon: '⚙️', description: '产品加工制造' },
  { name: '质量检测', icon: '🔍', description: '成品质量检验' },
  { name: '包装发货', icon: '📦', description: '包装并安排发货', requireLogisticsReceipt: true },
];

const DEFAULT_NOTES = ['材料已到位', '开始生产', '进度正常', '需要补料', '质检通过', '返工中', '已完成包装', '等待物流'];
const NOTES_STORAGE_KEY = 'custom_order_quick_notes';

// 图片数据键
const fullImageKey = (owner: string, recId: string, idx: number) => `customOrderImg_${owner}_${recId}_${idx}`;

// 生成唯一ID
export function cuid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// 数据归属（与目标软件一致：子账号归属父账号）
function getDataOwner(): string {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  const owner = isSub
    ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || 'admin')
    : (localStorage.getItem('username') || 'admin');
  return owner;
}

// ============================================================
// 主组件
// ============================================================
const CustomOrderPage: React.FC = () => {
  const [owner] = useState<string>(() => getDataOwner());
  const storageKey = `pageData_production_custom-order_${owner}`;
  const tplKey = `pageData_production_custom-order-templates_${owner}`;
  const defaultTplKey = `pageData_production_custom-order-default_${owner}`;

  // 数据状态
  const [orders, setOrders] = useState<CustomOrder[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [companyDefault, setCompanyDefault] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // 筛选状态
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  // 弹窗状态
  const [selectedOrder, setSelectedOrder] = useState<CustomOrder | null>(null);   // 需求详情
  const [showFlowManager, setShowFlowManager] = useState(false);                  // 流程管理(模板)
  const [showCreate, setShowCreate] = useState(false);                            // 创建定制单

  // 加载数据
  const loadData = useCallback(() => {
    setLoading(true);
    try {
      const saved = localStorage.getItem(storageKey);
      const savedOrders: CustomOrder[] = saved ? JSON.parse(saved) : [];
      setOrders(Array.isArray(savedOrders) ? savedOrders : []);

      const savedTpls = localStorage.getItem(tplKey);
      const tplArr: WorkflowTemplate[] = savedTpls ? JSON.parse(savedTpls) : [];
      setTemplates(Array.isArray(tplArr) ? tplArr : []);

      setCompanyDefault(localStorage.getItem(defaultTplKey) || '');
    } catch { /* ignore */ }
    setLoading(false);
  }, [storageKey, tplKey, defaultTplKey]);

  useEffect(() => {
    loadData();
    const onVisibility = () => { if (!document.hidden) loadData(); };
    const onFocus = () => loadData();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadData]);

  function persistOrders(next: CustomOrder[]) {
    setOrders(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // 工具函数
  function getNodes(o: CustomOrder): WorkflowNode[] {
    if (o.customNodes && o.customNodes.length > 0) return o.customNodes;
    const tpl = templates.find(t => t.id === o.templateId);
    if (tpl && tpl.nodes.length > 0) return tpl.nodes;
    return DEFAULT_NODES;
  }

  function isComplete(o: CustomOrder): boolean { return o.status === 'COMPLETED'; }

  function isOverdue(o: CustomOrder): boolean {
    if (isComplete(o)) return false;
    const req = o.customRequirement;
    if (!req?.deadline) return false;
    return dayjs(req.deadline).valueOf() < Date.now();
  }

  function getCountdown(deadline: string): string {
    if (!deadline) return '';
    const diff = dayjs(deadline).valueOf() - Date.now();
    if (diff <= 0) return '已过期';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    return `剩余 ${days}天 ${hours}小时`;
  }

  // 统计：平均完成周期
  const stats = useMemo(() => {
    const completed = orders.filter(o => o.status === 'COMPLETED');
    function getDays(o: CustomOrder): number {
      const start = dayjs(o.createdAt).valueOf();
      const end = o.records.length > 0 ? dayjs(o.records[o.records.length - 1].createdAt).valueOf() : dayjs(o.updatedAt).valueOf();
      return Math.max(1, Math.ceil((end - start) / 86400000));
    }
    function avg(arr: CustomOrder[]): string {
      if (arr.length === 0) return '--';
      const total = arr.reduce((s, p) => s + getDays(p), 0);
      return (total / arr.length).toFixed(1);
    }
    const now = Date.now();
    const m1 = now - 30 * 86400000;
    const m3 = now - 90 * 86400000;
    const m6 = now - 180 * 86400000;
    const completedIn = (since: number) => completed.filter(o => {
      const endTs = o.records.length > 0 ? dayjs(o.records[o.records.length - 1].createdAt).valueOf() : dayjs(o.updatedAt).valueOf();
      return endTs >= since;
    });
    return {
      all: avg(completed), allCount: completed.length,
      m1: avg(completedIn(m1)), m1Count: completedIn(m1).length,
      m3: avg(completedIn(m3)), m3Count: completedIn(m3).length,
      m6: avg(completedIn(m6)), m6Count: completedIn(m6).length,
    };
  }, [orders]);

  // 筛选
  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter === 'OVERDUE') { if (!isOverdue(o)) return false; }
      else if (statusFilter === 'ABNORMAL') { if (o.status !== 'ABNORMAL') return false; }
      else if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (o.orderNo || '').toLowerCase().includes(q)
        || (o.customerName || '').toLowerCase().includes(q)
        || (o.owner || '').toLowerCase().includes(q)
        || (o.buyerContact || '').toLowerCase().includes(q);
    });
  }, [orders, statusFilter, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedData = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [filter, statusFilter]);

  // ==================== 节点操作（已移入 WorkflowOrderCard 组件） ====================
  function updateOrder(u: CustomOrder) {
    setOrders(prev => {
      const next = prev.map(x => x.id === u.id ? u : x);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // ==================== 创建定制单 ====================
  const [createForm] = Form.useForm();
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [createMode, setCreateMode] = useState<'select' | 'manual'>('select');

  function openCreateModal() {
    // 读取销售订单
    let so: any[] = [];
    try {
      const raw = localStorage.getItem(`pageData_sales_order-manage_${owner}`);
      so = raw ? JSON.parse(raw) : [];
    } catch { so = []; }
    setSalesOrders(Array.isArray(so) ? so : []);
    setCreateMode('select');
    createForm.setFieldsValue({
      orderId: '',
      orderNo: '',
      customerName: '',
      buyerContact: '',
      totalAmount: 0,
      templateId: companyDefault,
      productName: '',
      productModel: '',
      quantity: '',
      detail: '',
      packaging: '',
      packagingDetail: '',
      payment: '',
      deadline: null,
    });
    setShowCreate(true);
  }

  function handleSalesOrderChange(orderId: string) {
    const so = salesOrders.find(s => s.id === orderId);
    if (so) {
      createForm.setFieldsValue({
        orderNo: so.id,
        customerName: so.customerName || '',
        buyerContact: so.receiverName || '',
        totalAmount: Number(so.amount || so.productAmount || 0),
      });
    }
  }

  function submitCreate() {
    createForm.validateFields().then(values => {
      if (!values.orderNo) { message.warning('请填写或选择订单号'); return; }
      if (!values.productName) { message.warning('请填写产品名称'); return; }
      const now = new Date().toISOString();
      const requirement: CustomRequirement = {
        productName: values.productName,
        productModel: values.productModel || '',
        quantity: values.quantity || '',
        detail: values.detail || '',
        packaging: values.packaging || '',
        packagingDetail: values.packagingDetail || '',
        payment: values.payment || '',
        deadline: values.deadline ? values.deadline.format('YYYY-MM-DD') : '',
      };
      const order: CustomOrder = {
        id: cuid(),
        orderId: values.orderId || '',
        orderNo: values.orderNo,
        customerName: values.customerName || '',
        buyerContact: values.buyerContact || '',
        totalAmount: Number(values.totalAmount) || 0,
        owner: localStorage.getItem('username') || '--',
        templateId: values.templateId || companyDefault || null,
        customNodes: null,
        customRequirement: requirement,
        currentStep: 0,
        status: 'IN_PROGRESS',
        records: [],
        createdAt: now,
        updatedAt: now,
      };
      persistOrders([order, ...orders]);
      setShowCreate(false);
      message.success('定制单已创建');
    }).catch(() => { /* validation */ });
  }

  // ==================== 模板管理 ====================
  const [newTplName, setNewTplName] = useState('');
  const [newTplIndustry, setNewTplIndustry] = useState('');
  const [newTplNodes, setNewTplNodes] = useState<WorkflowNode[]>([...DEFAULT_NODES]);
  const [showNewTemplate, setShowNewTemplate] = useState(false);

  function persistTemplates(next: WorkflowTemplate[]) {
    setTemplates(next);
    try { localStorage.setItem(tplKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function createNewTemplate() {
    if (!newTplName.trim()) { message.warning('请输入模板名称'); return; }
    const tpl: WorkflowTemplate = {
      id: cuid(),
      name: newTplName.trim(),
      industry: newTplIndustry.trim(),
      nodes: newTplNodes.map(n => ({ ...n })),
    };
    persistTemplates([...templates, tpl]);
    setNewTplName('');
    setNewTplIndustry('');
    setNewTplNodes([...DEFAULT_NODES]);
    setShowNewTemplate(false);
    message.success('模板已创建');
  }

  function setCompanyDefaultTemplate(tplId: string) {
    setCompanyDefault(tplId);
    localStorage.setItem(defaultTplKey, tplId);
    const tpl = templates.find(t => t.id === tplId);
    message.success(`已将「${tpl?.name || ''}」设为默认模板`);
  }

  function deleteTemplate(tplId: string) {
    persistTemplates(templates.filter(t => t.id !== tplId));
    if (companyDefault === tplId) { setCompanyDefault(''); localStorage.removeItem(defaultTplKey); }
    message.success('模板已删除');
  }

  // ==================== 渲染 ====================
  const renderStatCard = (title: string, value: string, count: number, color: string, borderColor: string) => (
    <Card size="small" style={{ borderColor, borderTop: `3px solid ${color}` }}>
      <Text style={{ fontSize: 12, color: '#8b9db5' }}>{title}</Text>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color }}>{value}</span>
        <span style={{ fontSize: 11, color: '#999', paddingBottom: 3 }}>天 ({count}单)</span>
      </div>
    </Card>
  );

  // 流程图/卡片渲染已抽取到 WorkflowOrderCard 组件（见文件底部）

  // 无数据占位
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>;
  }

  return (
    <div style={{ background: BG_GRADIENT, minHeight: '100%', padding: 4 }}>
      {/* 标题栏 */}
      <Card style={{ marginBottom: 12, borderRadius: 12 }} styles={{ body: { padding: '14px 18px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <Space>
            <div style={{ width: 36, height: 36, background: PRIMARY_LIGHT, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📋</div>
            <div>
              <Title level={4} style={{ margin: 0, color: '#1a2b45' }}>定制单</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>生产进度跟踪与流程管理</Text>
            </div>
          </Space>
          <Space>
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="搜索订单号/客户/负责人"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 240 }}
            />
            <Button icon={<ReloadOutlined />} onClick={loadData}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} style={{ background: PRIMARY }} onClick={openCreateModal}>
              新建定制单
            </Button>
          </Space>
        </div>

        {/* 状态筛选 */}
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="small" type={statusFilter === 'all' ? 'primary' : 'default'} style={statusFilter === 'all' ? { background: '#333' } : {}} onClick={() => setStatusFilter('all')}>
            全部 <Text style={{ marginLeft: 4 }}>{orders.length}</Text>
          </Button>
          <Button size="small" type={statusFilter === 'IN_PROGRESS' ? 'primary' : 'default'} onClick={() => setStatusFilter(statusFilter === 'IN_PROGRESS' ? 'all' : 'IN_PROGRESS')}>
            进行中 <Text style={{ marginLeft: 4 }}>{orders.filter(o => o.status === 'IN_PROGRESS').length}</Text>
          </Button>
          <Button size="small" type={statusFilter === 'COMPLETED' ? 'primary' : 'default'} style={statusFilter === 'COMPLETED' ? { background: '#52c41a' } : {}} onClick={() => setStatusFilter(statusFilter === 'COMPLETED' ? 'all' : 'COMPLETED')}>
            已完成 <Text style={{ marginLeft: 4 }}>{orders.filter(o => o.status === 'COMPLETED').length}</Text>
          </Button>
          <Button size="small" type={statusFilter === 'OVERDUE' ? 'primary' : 'default'} style={statusFilter === 'OVERDUE' ? { background: '#722ed1' } : {}} onClick={() => setStatusFilter(statusFilter === 'OVERDUE' ? 'all' : 'OVERDUE')}>
            逾期 <Text style={{ marginLeft: 4 }}>{orders.filter(o => isOverdue(o)).length}</Text>
          </Button>
          <Button size="small" type={statusFilter === 'ABNORMAL' ? 'primary' : 'default'} style={statusFilter === 'ABNORMAL' ? { background: '#ff4d4f' } : {}} onClick={() => setStatusFilter(statusFilter === 'ABNORMAL' ? 'all' : 'ABNORMAL')}>
            卡点 <Text style={{ marginLeft: 4 }}>{orders.filter(o => o.status === 'ABNORMAL').length}</Text>
          </Button>
        </div>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}>
          {renderStatCard('全部平均周期', stats.all, stats.allCount, '#1a2b45', '#d0d8e0')}
        </Col>
        <Col span={6}>
          {renderStatCard('最近 1 个月', stats.m1, stats.m1Count, '#0958d9', '#91caff')}
        </Col>
        <Col span={6}>
          {renderStatCard('最近 3 个月', stats.m3, stats.m3Count, '#52c41a', '#b7eb8f')}
        </Col>
        <Col span={6}>
          {renderStatCard('最近半年', stats.m6, stats.m6Count, '#722ed1', '#d3adf7')}
        </Col>
      </Row>

      {/* 定制单列表 */}
      {filtered.length === 0 ? (
        <Card style={{ borderRadius: 12 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span>暂无定制单数据，点击「新建定制单」创建</span>}
          />
        </Card>
      ) : (
        <div>
          {pagedData.map(o => (
            <WorkflowOrderCard
              key={o.id}
              order={o}
              templates={templates}
              onUpdate={updateOrder}
              onShowRequirement={x => setSelectedOrder(x)}
            />
          ))}

          {filtered.length > PAGE_SIZE && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Space>
                <Button disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>上一页</Button>
                <Text>第 {currentPage} / {totalPages} 页 · 共 {filtered.length} 条</Text>
                <Button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>下一页</Button>
              </Space>
            </div>
          )}
        </div>
      )}

      {/* ==================== 新建定制单弹窗 ==================== */}
      <Modal
        title={<span><PlusOutlined style={{ color: PRIMARY, marginRight: 8 }} />新建定制单</span>}
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        onOk={submitCreate}
        okText="创建定制单"
        cancelText="取消"
        width={640}
        destroyOnClose
        maskClosable={false}
      >
        <Form autoComplete="off" form={createForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="订单来源" style={{ marginBottom: 12 }}>
            <Radio.Group value={createMode} onChange={e => setCreateMode(e.target.value)}>
              <Radio.Button value="select">选择已有订单</Radio.Button>
              <Radio.Button value="manual">手工填写</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {createMode === 'select' ? (
            <Form.Item label="选择销售订单" name="orderId" style={{ marginBottom: 12 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={salesOrders.length ? '请选择订单' : '暂无可选订单，请手工填写'}
                onChange={handleSalesOrderChange}
                options={salesOrders.map(s => ({
                  value: s.id,
                  label: `${s.id} · ${s.customerName || ''} · ${s.orderStatus || ''}`,
                }))}
              />
            </Form.Item>
          ) : null}

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="订单号" name="orderNo" rules={[{ required: true, message: '请输入订单号' }]} style={{ marginBottom: 12 }}>
                <Input placeholder="如 SO20240001" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="客户名称" name="customerName" style={{ marginBottom: 12 }}>
                <Input placeholder="客户名称" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="订单金额" name="totalAmount" style={{ marginBottom: 12 }}>
                <InputNumber style={{ width: '100%' }} min={0} placeholder="金额" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="联系人" name="buyerContact" style={{ marginBottom: 12 }}>
                <Input placeholder="联系人" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="生产流程模板" name="templateId" style={{ marginBottom: 12 }}>
                <Select
                  placeholder={companyDefault ? '使用公司默认模板' : '选择模板'}
                  options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.industry || '通用'})${companyDefault === t.id ? ' [默认]' : ''}` }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain style={{ fontSize: 13, margin: '12px 0' }}>
            <Text type="secondary">产品定制信息</Text>
          </Divider>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="产品名称" name="productName" rules={[{ required: true, message: '请输入产品名称' }]} style={{ marginBottom: 12 }}>
                <Input placeholder="产品名称" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="产品型号" name="productModel" style={{ marginBottom: 12 }}>
                <Input placeholder="型号/规格" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="数量" name="quantity" style={{ marginBottom: 12 }}>
                <Input placeholder="数量" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="定制需求描述" name="detail" style={{ marginBottom: 12 }}>
            <TextArea rows={2} placeholder="详细描述定制需求" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="包装要求" name="packaging" style={{ marginBottom: 12 }}>
                <Input placeholder="包装方式" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="付款方式" name="payment" style={{ marginBottom: 12 }}>
                <Input placeholder="付款方式" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="交货日期" name="deadline" style={{ marginBottom: 12 }}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* ==================== 流程管理弹窗（模板） ==================== */}
      <Modal
        title={<span><SyncOutlined style={{ color: PRIMARY, marginRight: 8 }} />流程模板管理</span>}
        open={showFlowManager}
        onCancel={() => setShowFlowManager(false)}
        footer={<Button onClick={() => setShowFlowManager(false)}>关闭</Button>}
        width={600}
      >
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <Text strong>已有模板</Text>
          <Button size="small" onClick={() => setShowNewTemplate(!showNewTemplate)}>
            {showNewTemplate ? '收起' : '+ 创建新模板'}
          </Button>
        </Space>

        {templates.length === 0 && !showNewTemplate && (
          <Empty description="暂无模板，点击右上角创建" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}

        {templates.map(tpl => (
          <Card key={tpl.id} size="small" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Text strong>{tpl.name}</Text>
                {tpl.industry && <Tag>{tpl.industry}</Tag>}
                {companyDefault === tpl.id && <Tag color="green">公司默认</Tag>}
              </Space>
              <Space>
                <Button size="small" onClick={() => setCompanyDefaultTemplate(tpl.id)}>
                  {companyDefault === tpl.id ? '✓ 默认' : '设为默认'}
                </Button>
                <Popconfirm title="确认删除该模板？" onConfirm={() => deleteTemplate(tpl.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tpl.nodes.map((n, i) => (
                <Tag key={i} style={{ borderRadius: 6 }}>{n.icon} {n.name}{n.estimatedDays ? ` (${n.estimatedDays}天)` : ''}</Tag>
              ))}
            </div>
          </Card>
        ))}

        {showNewTemplate && (
          <Card size="small" style={{ background: '#fafbfc' }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text strong style={{ color: PRIMARY }}>新建模板</Text>
              <Button size="small" type="primary" style={{ background: PRIMARY }} onClick={createNewTemplate}>保存模板</Button>
            </Space>
            <Row gutter={12} style={{ marginTop: 12 }}>
              <Col span={12}>
                <Input value={newTplName} onChange={e => setNewTplName(e.target.value)} placeholder="模板名称" />
              </Col>
              <Col span={12}>
                <Input value={newTplIndustry} onChange={e => setNewTplIndustry(e.target.value)} placeholder="所属行业（可选）" />
              </Col>
            </Row>
            <div style={{ marginTop: 12 }}>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>流程节点</Text>
                <Button size="small" icon={<PlusOutlined />} onClick={() => setNewTplNodes([...newTplNodes, { name: '新节点', icon: '📋', description: '' }])}>添加节点</Button>
              </Space>
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                {newTplNodes.map((node, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#fff', padding: 6, borderRadius: 8, border: '1px solid #eee', marginBottom: 6 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Button size="small" type="text" disabled={i === 0} style={{ padding: 0, height: 14 }} icon={<UpOutlined />} onClick={() => { const a = [...newTplNodes]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setNewTplNodes(a); }} />
                      <Button size="small" type="text" disabled={i === newTplNodes.length - 1} style={{ padding: 0, height: 14 }} icon={<DownOutlined />} onClick={() => { const a = [...newTplNodes]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; setNewTplNodes(a); }} />
                    </div>
                    <Input
                      value={node.icon}
                      onChange={e => { const a = [...newTplNodes]; a[i] = { ...a[i], icon: e.target.value }; setNewTplNodes(a); }}
                      style={{ width: 56, textAlign: 'center' }} placeholder="图标"
                    />
                    <Input
                      value={node.name}
                      onChange={e => { const a = [...newTplNodes]; a[i] = { ...a[i], name: e.target.value }; setNewTplNodes(a); }}
                      style={{ flex: 1 }} placeholder="节点名称"
                    />
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={node.estimatedDays ?? ''}
                      onChange={e => { const a = [...newTplNodes]; a[i] = { ...a[i], estimatedDays: e.target.value === '' ? undefined : Number(e.target.value) }; setNewTplNodes(a); }}
                      style={{ width: 80 }} placeholder="预计(天)"
                    />
                    <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => setNewTplNodes(newTplNodes.filter((_, j) => j !== i))} />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </Modal>

      {/* 节点推进弹窗与流程编辑弹窗已随 WorkflowOrderCard 组件内部渲染 */}

      {/* ==================== 定制需求详情弹窗 ==================== */}
      <Modal
        title={<span><FileTextOutlined style={{ color: PRIMARY, marginRight: 8 }} />定制需求详情</span>}
        open={!!selectedOrder}
        onCancel={() => setSelectedOrder(null)}
        footer={<Button onClick={() => setSelectedOrder(null)}>关闭</Button>}
        width={560}
      >
        {selectedOrder && (
          <div>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="订单号" span={2}>
                <Tag color="blue">{selectedOrder.orderNo}</Tag>
                {selectedOrder.customerName || '--'}
              </Descriptions.Item>
              <Descriptions.Item label="负责人">{selectedOrder.owner || '--'}</Descriptions.Item>
              <Descriptions.Item label="金额">￥{(selectedOrder.totalAmount || 0).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="产品名称" span={2}>{selectedOrder.customRequirement?.productName || '--'}</Descriptions.Item>
              <Descriptions.Item label="产品型号">{selectedOrder.customRequirement?.productModel || '--'}</Descriptions.Item>
              <Descriptions.Item label="数量">{selectedOrder.customRequirement?.quantity || '--'}</Descriptions.Item>
              <Descriptions.Item label="包装要求" span={2}>{selectedOrder.customRequirement?.packaging || '--'}</Descriptions.Item>
              <Descriptions.Item label="付款方式">{selectedOrder.customRequirement?.payment || '--'}</Descriptions.Item>
              <Descriptions.Item label="交货日期">
                {selectedOrder.customRequirement?.deadline
                  ? <Tag color={dayjs(selectedOrder.customRequirement.deadline).valueOf() < Date.now() ? 'red' : 'green'}>{selectedOrder.customRequirement.deadline}</Tag>
                  : '--'}
              </Descriptions.Item>
              <Descriptions.Item label="定制需求描述" span={2}>
                {selectedOrder.customRequirement?.detail || '--'}
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ============================================================
// 节点推进弹窗组件
// ============================================================
const NodeModal: React.FC<{
  nodeModal: { order: CustomOrder; stepIndex: number } | null;
  getNodes: (o: CustomOrder) => WorkflowNode[];
  getRecordsForStep: (o: CustomOrder, stepIndex: number) => ProgressRecord[];
  quickNotes: string[];
  nodeNote: string;
  setNodeNote: React.Dispatch<React.SetStateAction<string>>;
  nodeImages: string[];
  setNodeImages: React.Dispatch<React.SetStateAction<string[]>>;
  onClose: () => void;
  onSave: (advance: 'next' | 'complete' | null) => void;
}> = ({ nodeModal, getNodes, getRecordsForStep, quickNotes, nodeNote, setNodeNote, nodeImages, setNodeImages, onClose, onSave }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  if (!nodeModal) return null;
  const { order, stepIndex } = nodeModal;
  const nodes = getNodes(order);
  const currentNode = nodes[stepIndex];
  const isLastStep = stepIndex >= nodes.length - 1;
  const records = getRecordsForStep(order, stepIndex);

  // 图片转 base64（压缩）
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setNodeImages(prev => [...prev, dataUrl].slice(0, 9));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  return (
    <Modal
      title={
        <Space>
          <span style={{ fontSize: 22 }}>{currentNode?.icon || '📋'}</span>
          <div>
            <Title level={5} style={{ margin: 0 }}>{currentNode?.name || `步骤${stepIndex + 1}`}</Title>
            <Text type="secondary" style={{ fontSize: 11 }}>步骤 {stepIndex + 1} / {nodes.length}</Text>
          </div>
        </Space>
      }
      open={!!nodeModal}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button icon={<SaveOutlined />} onClick={() => onSave(null)}>保存记录</Button>
          {!isLastStep && (
            <Button type="primary" icon={<ArrowRightOutlined />} style={{ background: PRIMARY }} onClick={() => onSave('next')}>
              推进到下一步
            </Button>
          )}
          <Button type="primary" danger icon={<CheckCircleOutlined />} onClick={() => onSave('complete')}>
            {isLastStep ? '完成订单' : '标记完成'}
          </Button>
        </Space>
      }
      width={520}
      destroyOnClose
    >
      {currentNode?.description && (
        <Alert type="info" message={currentNode.description} style={{ marginBottom: 12 }} />
      )}

      {/* 历史记录 */}
      {records.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 12 }}>历史记录 ({records.length})</Text>
          <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6 }}>
            {records.map(r => (
              <div key={r.id} style={{ background: '#fafbfc', padding: 8, borderRadius: 8, marginBottom: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999', marginBottom: 2 }}>
                  <span>{r.operatorName || '--'}</span>
                  <span>{dayjs(r.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                </div>
                {r.note && <div style={{ color: '#333' }}>{r.note}</div>}
                {(() => {
                  try {
                    const imgs = typeof r.images === 'string' ? JSON.parse(r.images) : r.images;
                    return Array.isArray(imgs) && imgs.length > 0
                      ? <Text type="secondary">📎 {imgs.length} 张图片</Text> : null;
                  } catch { return null; }
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快捷备注 */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 12 }}>快捷备注</Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {quickNotes.map((n, i) => (
            <Button
              key={i}
              size="small"
              style={{ fontSize: 12 }}
              onClick={() => setNodeNote(prev => prev ? `${prev}；${n}` : n)}
            >
              {n}
            </Button>
          ))}
          <Button
            size="small"
            type="dashed"
            style={{ fontSize: 12 }}
            onClick={() => setNodeNote(prev => prev ? `${prev}；${localStorage.getItem('username') || ''}` : localStorage.getItem('username') || '')}
          >
            + 当前用户
          </Button>
        </div>
      </div>

      {/* 备注 */}
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 12 }}>备注说明</Text>
        <TextArea
          value={nodeNote}
          onChange={e => setNodeNote(e.target.value)}
          rows={3}
          placeholder="输入备注信息..."
          style={{ marginTop: 6 }}
        />
      </div>

      {/* 图片上传 */}
      <div>
        <Text strong style={{ fontSize: 12 }}>上传图片</Text>
        <input
          type="file"
          accept="image/*"
          multiple
          ref={fileRef}
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {nodeImages.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={img} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
              <Button
                size="small"
                type="text"
                danger
                icon={<CloseOutlined />}
                style={{ position: 'absolute', top: -8, right: -8, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
                onClick={() => setNodeImages(nodeImages.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          {nodeImages.length < 9 && (
            <Button
              icon={<UploadOutlined />}
              style={{ width: 72, height: 72, borderRadius: 8 }}
              onClick={() => fileRef.current?.click()}
            >
              <Text type="secondary" style={{ fontSize: 10 }}>上传</Text>
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

// ============================================================
// 工作流订单卡片组件（定制单/生产订单卡片视图共用）
// 包含：流程图展示、节点推进、添加卡点、流程编辑、节点停留时间（预计/超时）
// ============================================================
export const WorkflowOrderCard: React.FC<{
  order: CustomOrder;
  templates: WorkflowTemplate[];
  fallbackNodes?: WorkflowNode[];
  onUpdate: (o: CustomOrder) => void;
  onShowRequirement?: (o: CustomOrder) => void;
  onFirstNodeClick?: (o: CustomOrder) => void;
  headerExtra?: React.ReactNode;
  extraActions?: React.ReactNode;
}> = ({ order, templates, fallbackNodes, onUpdate, onShowRequirement, onFirstNodeClick, headerExtra, extraActions }) => {
  const o = order;
  const [nodeModal, setNodeModal] = useState<{ order: CustomOrder; stepIndex: number } | null>(null);
  const [nodeNote, setNodeNote] = useState('');
  const [nodeImages, setNodeImages] = useState<string[]>([]);
  const [quickNotes, setQuickNotes] = useState<string[]>(DEFAULT_NOTES);
  const [editFlowOrder, setEditFlowOrder] = useState<CustomOrder | null>(null);
  const [editFlowNodes, setEditFlowNodes] = useState<WorkflowNode[]>([]);
  const [editFlowNewName, setEditFlowNewName] = useState('');
  const [editFlowNewIcon, setEditFlowNewIcon] = useState('');
  const [editFlowNewDesc, setEditFlowNewDesc] = useState('');
  const [editFlowNewDays, setEditFlowNewDays] = useState('');
  const [editFlowTplSelect, setEditFlowTplSelect] = useState<string | undefined>(undefined);

  // 快捷备注（可自定义扩展）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NOTES_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) setQuickNotes(arr);
      }
    } catch { /* ignore */ }
  }, []);

  // 节点来源：自定义节点 > 模板 > 内置默认节点（模板默认使用生产流程模板中的默认模板）
  function getNodes(ord: CustomOrder): WorkflowNode[] {
    if (ord.customNodes && ord.customNodes.length > 0) return ord.customNodes;
    const tpl = templates.find(t => t.id === ord.templateId);
    if (tpl && tpl.nodes.length > 0) return tpl.nodes;
    return fallbackNodes || DEFAULT_NODES;
  }

  function getRecordsForStep(ord: CustomOrder, stepIndex: number): ProgressRecord[] {
    return (ord.records || []).filter(r => r.stepIndex === stepIndex);
  }

  function isCompleteOrd(ord: CustomOrder): boolean { return ord.status === 'COMPLETED'; }

  function getCountdownStr(deadline?: string): string {
    if (!deadline) return '';
    const diff = dayjs(deadline).valueOf() - Date.now();
    if (diff <= 0) return '已过期';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    return `剩余 ${days}天 ${hours}小时`;
  }

  function openNodeModal(ord: CustomOrder, stepIndex: number) {
    setNodeNote('');
    setNodeImages([]);
    setNodeModal({ order: ord, stepIndex });
  }

  // 保存记录 / 推进到下一步 / 完成订单（推进时自动清除卡点节点）
  function saveNodeAdvance(advance: 'next' | 'complete' | null) {
    if (!nodeModal) return;
    const ord = nodeModal.order;
    const nodes = getNodes(ord);
    const stepIndex = nodeModal.stepIndex;
    const rec: ProgressRecord = {
      id: cuid(),
      stepIndex,
      stepName: nodes[stepIndex]?.name || `步骤${stepIndex + 1}`,
      note: nodeNote.trim() || null,
      images: nodeImages.length > 0 ? nodeImages : [],
      operatorName: localStorage.getItem('username') || null,
      createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    };
    let nextStep = ord.currentStep;
    let nextStatus = ord.status;
    let nextNodes = ord.customNodes;
    if (advance === 'next') {
      // 清除当前卡点节点（卡点处理完成，流程回到卡点位置继续）
      if (nodes[stepIndex]?.icon === '⚠️') {
        if (nextNodes) {
          nextNodes = nextNodes.filter((_, j) => j !== stepIndex);
        } else {
          nextNodes = nodes.filter((_, j) => j !== stepIndex);
        }
        if (ord.status === 'ABNORMAL') nextStatus = 'IN_PROGRESS';
      } else {
        nextStep = Math.min(ord.currentStep + 1, (nextNodes || nodes).length - 1);
      }
    } else if (advance === 'complete') {
      nextStatus = 'COMPLETED';
      nextStep = (nextNodes || nodes).length;
    }
    onUpdate({
      ...ord,
      records: [...(ord.records || []), rec],
      currentStep: nextStep,
      status: nextStatus,
      customNodes: nextNodes,
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
    setNodeModal(null);
    message.success(advance === 'complete' ? '订单已完成' : advance === 'next' ? '已推进到下一步' : '记录已保存');
  }

  // 添加卡点节点（插入在当前节点之前，订单状态变为卡点）
  function addAbnormalNode(ord: CustomOrder) {
    const nodes = getNodes(ord);
    const abnormalNode: WorkflowNode = { name: '卡点处理', icon: '⚠️', description: '处理当前卡点问题' };
    const base = ord.customNodes ? [...ord.customNodes] : [...nodes];
    const idx = Math.max(0, Math.min(ord.currentStep, base.length));
    base.splice(idx, 0, abnormalNode);
    onUpdate({
      ...ord,
      customNodes: base,
      status: 'ABNORMAL',
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
    message.success('已添加卡点节点');
  }

  // 流程编辑
  function openEditFlow(ord: CustomOrder) {
    setEditFlowOrder(ord);
    setEditFlowNodes(getNodes(ord).map(n => ({ ...n })));
    setEditFlowNewName('');
    setEditFlowNewIcon('');
    setEditFlowNewDesc('');
    setEditFlowNewDays('');
    setEditFlowTplSelect(undefined);
  }

  // 选择模板快速替换流程节点
  function handleSelectTemplate(tplId: string | undefined) {
    if (!tplId) { setEditFlowTplSelect(undefined); return; }
    const allTpls = templates.length > 0 ? templates : (INDUSTRY_TEMPLATES as WorkflowTemplate[]);
    const tpl = allTpls.find(t => t.id === tplId);
    if (!tpl) { setEditFlowTplSelect(undefined); return; }
    Modal.confirm({
      title: '确认替换流程节点',
      content: `确定要用模板「${tpl.name}」的 ${tpl.nodes.length} 个节点替换当前编辑的流程吗？当前未保存的修改将被覆盖。`,
      okText: '确认替换',
      cancelText: '取消',
      onOk: () => {
        setEditFlowNodes(tpl.nodes.map(n => ({ ...n })));
        message.success(`已替换为模板「${tpl.name}」`);
      },
      afterClose: () => { setEditFlowTplSelect(undefined); },
    });
  }

  function saveEditFlow() {
    if (!editFlowOrder) return;
    const cleaned = editFlowNodes.filter(n => n.name && n.name.trim());
    if (cleaned.length === 0) { message.warning('至少保留一个流程节点'); return; }
    const ord = editFlowOrder;
    onUpdate({
      ...ord,
      customNodes: cleaned,
      currentStep: ord.status === 'COMPLETED' ? cleaned.length : Math.min(ord.currentStep, cleaned.length - 1),
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
    setEditFlowOrder(null);
    message.success('流程已更新');
  }

  // ---------- 渲染：横向流程图 ----------
  const renderFlowNodes = () => {
    const nodes = getNodes(o);
    const isComp = isCompleteOrd(o);

    if (nodes.length === 0) {
      return <Text type="secondary" style={{ fontSize: 13 }}>模板信息缺失</Text>;
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', paddingBottom: 4 }}>
        {nodes.map((node, i) => {
          const isDone = i < o.currentStep;
          const isCurrent = i === o.currentStep && !isComp;
          const isAbnormal = node.icon === '⚠️' && !isDone;
          const wasCleared = node.icon === '⚠️' && isDone;
          const stepRecords = getRecordsForStep(o, i);

          let isNodeOverdue = false;
          let actualDays = 0;
          if (node.estimatedDays && node.estimatedDays > 0 && isCurrent) {
            let nodeStartTime: number;
            if (i === 0) nodeStartTime = dayjs(o.createdAt).valueOf();
            else {
              const prevRecs = (o.records || []).filter(r => r.stepIndex === i - 1);
              nodeStartTime = prevRecs.length > 0 ? dayjs(prevRecs[prevRecs.length - 1].createdAt).valueOf() : dayjs(o.createdAt).valueOf();
            }
            actualDays = (Date.now() - nodeStartTime) / 86400000;
            isNodeOverdue = actualDays > node.estimatedDays;
          }

          const boxStyle: React.CSSProperties = {
            display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 96,
            padding: '10px 14px', borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
            background: isAbnormal ? '#fff1f0' : isNodeOverdue ? '#fff1f0' :
              isDone ? '#52c41a' : isCurrent ? '#ffffff' : '#ffffff',
            border: isAbnormal ? '2px solid #ff7875' : isNodeOverdue ? '2px solid #ff4d4f' :
              isDone ? '1px solid #52c41a' : isCurrent ? '2px solid #40a9ff' : '1px solid #d9d9d9',
            opacity: isDone || isCurrent || isAbnormal ? 1 : 0.5,
            boxShadow: isCurrent ? '0 2px 8px rgba(64,169,255,0.2)' : 'none',
          };

          return (
            <React.Fragment key={i}>
              <div
                style={boxStyle}
                onClick={() => {
                  if (isAbnormal) { message.info('这是卡点节点，可点击「查看卡点」'); return; }
                  if (i === 0 && onFirstNodeClick) { onFirstNodeClick(o); return; }
                  if (i === 0 && o.customRequirement) { onShowRequirement?.(o); return; }
                  openNodeModal(o, i);
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              >
                <span style={{ fontSize: 24, marginBottom: 4 }}>{wasCleared ? '✅' : node.icon}</span>
                <span style={{
                  fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                  color: isAbnormal || isNodeOverdue ? '#cf1322' : isDone ? '#ffffff' : isCurrent ? '#0958d9' : '#999',
                }}>{node.name}</span>
                {isAbnormal && <span style={{ fontSize: 10, color: '#ff4d4f', marginTop: 4, background: '#ffe7e6', padding: '0 6px', borderRadius: 8, fontWeight: 500 }}>卡点</span>}
                {isNodeOverdue && !isAbnormal && (
                  <Tooltip title={`预计 ${node.estimatedDays} 天，实际 ${actualDays.toFixed(1)} 天`}>
                    <span style={{ fontSize: 10, marginTop: 4, padding: '0 6px', borderRadius: 8, fontWeight: 500, color: '#cf1322', background: '#ffe7e6' }}>
                      ⚠ 超时 {Math.ceil(actualDays - (node.estimatedDays || 0))}天
                    </span>
                  </Tooltip>
                )}
                {!isNodeOverdue && node.estimatedDays && node.estimatedDays > 0 && isCurrent && (
                  <span style={{ fontSize: 9, color: '#999', marginTop: 4 }} title={`预计 ${node.estimatedDays} 天，已进行 ${actualDays.toFixed(1)} 天`}>
                    ≤{node.estimatedDays}天
                  </span>
                )}
                {isDone && !isAbnormal && (
                  <>
                    <span style={{ fontSize: 10, marginTop: 4, padding: '0 6px', borderRadius: 8, fontWeight: 500, color: '#ffffff', background: 'rgba(255,255,255,0.25)' }}>✓ 已完成</span>
                    {(() => {
                      const lastRec = stepRecords[stepRecords.length - 1];
                      if (lastRec?.createdAt) {
                        return <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>{dayjs(lastRec.createdAt).format('MM/DD HH:mm')}</span>;
                      }
                      return null;
                    })()}
                  </>
                )}
                {isCurrent && !isAbnormal && <span style={{ fontSize: 10, marginTop: 4, padding: '0 6px', borderRadius: 8, fontWeight: 500, color: '#0958d9', background: '#e6f4ff' }}>● 进行中</span>}
                {stepRecords.length > 0 && <span style={{ fontSize: 10, color: isDone ? 'rgba(255,255,255,0.85)' : '#999', marginTop: 2 }}>{stepRecords.length}条记录</span>}
              </div>
              {i < nodes.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', margin: '0 6px', flexShrink: 0 }}>
                  {/* 双箭头进度符号：替代原来的连接线+圆点 */}
                  <svg width="26" height="24" viewBox="0 0 26 24" fill="none">
                    <path d="M6 5 L13 12 L6 19" stroke={isDone ? '#95de64' : '#ccc'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 5 L21 12 L14 19" stroke={isDone ? '#95de64' : '#ccc'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // ---------- 渲染：订单卡片 ----------
  const isComp = isCompleteOrd(o);
  const nodes = getNodes(o);
  const progressPct = nodes.length > 0 ? Math.min(100, Math.round((o.currentStep / nodes.length) * 100)) : 0;
  const startTs = dayjs(o.createdAt).valueOf();
  const endTs = isComp
    ? (o.records.length > 0 ? dayjs(o.records[o.records.length - 1].createdAt).valueOf() : Date.now())
    : Date.now();
  const usedDays = Math.max(1, Math.ceil((endTs - startTs) / 86400000));
  const req = o.customRequirement;

  return (
    <>
      <Card
        style={{
          marginBottom: 12, borderRadius: 14, border: isComp ? '1px solid #b7eb8f' :
            o.status === 'ABNORMAL' ? '1px solid #ffa39e' :
            o.status === 'PAUSED' ? '1px solid #ffd591' : '1px solid #d0e0f5',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* 订单头 */}
        <div style={{
          padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          background: isComp ? 'linear-gradient(90deg,#f6ffed,#f0fff0)' :
            o.status === 'ABNORMAL' ? 'linear-gradient(90deg,#fff1f0,#fff7f0)' :
            'linear-gradient(90deg,#e6f4ff,#f0f7ff)',
          borderBottom: '1px solid #eee',
        }}>
          <Space size={12} wrap>
            <Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
              <Tag color={isComp ? 'green' : o.status === 'ABNORMAL' ? 'red' : 'blue'} style={{ marginRight: 0 }}>
                {o.orderNo}
              </Tag>
            </Text>
            <Text style={{ fontWeight: 500 }}>{o.customerName || '--'}</Text>
            {o.buyerContact && <Text type="secondary" style={{ fontSize: 12 }}>联系人: {o.buyerContact}</Text>}
            {o.totalAmount > 0 && <Text type="secondary" style={{ fontSize: 12 }}>￥{o.totalAmount.toFixed(2)}</Text>}
            <Text type="secondary" style={{ fontSize: 12 }}>负责人: <Text strong>{o.owner || '--'}</Text></Text>
            {headerExtra}
            <Text style={{ fontSize: 12, color: isComp ? '#389e0d' : '#0958d9' }}>
              已用时 <span style={{ fontWeight: 700 }}>{usedDays}</span> 天
            </Text>
          </Space>
          <Space size={8}>
            <Tag color={isComp ? 'green' : o.status === 'ABNORMAL' ? 'red' : o.status === 'PAUSED' ? 'orange' : 'blue'}>
              {isComp ? `✓ 已完成 ${progressPct}%` : o.status === 'ABNORMAL' ? `⚠ 卡点 ${progressPct}%` : o.status === 'PAUSED' ? `⏸ 暂停 ${progressPct}%` : `● 进行中 ${progressPct}%`}
            </Tag>
            {req?.deadline && (() => {
              if (isComp) {
                const completionTime = o.records.length > 0 ? dayjs(o.records[o.records.length - 1].createdAt).valueOf() : dayjs(o.updatedAt).valueOf();
                const deadlineTime = dayjs(req.deadline).valueOf();
                const isLate = completionTime > deadlineTime;
                return <Tag color={isLate ? 'red' : 'green'}>{isLate ? '⚠️ 逾期交付' : '✅ 按时交付'}</Tag>;
              }
              const cd = getCountdownStr(req.deadline);
              const expired = cd === '已过期';
              return <Tag color={expired ? 'red' : 'orange'}>⏰ {cd}</Tag>;
            })()}
            {extraActions}
            <Button size="small" icon={<WarningOutlined />} danger onClick={() => addAbnormalNode(o)} style={{ fontSize: 12 }}>卡点</Button>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditFlow(o)} style={{ fontSize: 12 }}>流程编辑</Button>
            <Dropdown
              menu={{
                items: [
                  ...(onShowRequirement ? [{ key: 'detail', label: '查看定制需求', icon: <EyeOutlined /> }] : []),
                  { key: 'record', label: '查看进度记录', icon: <FileTextOutlined /> },
                ],
                onClick: ({ key }) => {
                  if (key === 'detail') onShowRequirement?.(o);
                  else if (key === 'record') openNodeModal(o, Math.min(o.currentStep, getNodes(o).length - 1));
                },
              }}
            >
              <Button size="small" icon={<DownOutlined />} style={{ fontSize: 12 }}>更多</Button>
            </Dropdown>
          </Space>
        </div>

        {/* 流程图 */}
        <div style={{ padding: '14px 18px', background: '#fafbfc' }}>
          {renderFlowNodes()}
        </div>
      </Card>

      {/* 节点推进弹窗 */}
      <NodeModal
        nodeModal={nodeModal}
        getNodes={getNodes}
        getRecordsForStep={getRecordsForStep}
        quickNotes={quickNotes}
        nodeNote={nodeNote}
        setNodeNote={setNodeNote}
        nodeImages={nodeImages}
        setNodeImages={setNodeImages}
        onClose={() => setNodeModal(null)}
        onSave={saveNodeAdvance}
      />

      {/* 流程编辑弹窗 */}
      <Modal
        title={<span><EditOutlined style={{ color: PRIMARY, marginRight: 8 }} />流程编辑</span>}
        open={!!editFlowOrder}
        onCancel={() => setEditFlowOrder(null)}
        onOk={saveEditFlow}
        okText="保存流程"
        cancelText="取消"
        width={620}
      >
        {editFlowOrder && (
          <div>
            <Alert type="info" showIcon message={`订单：${editFlowOrder.orderNo} · ${editFlowOrder.customerName || ''}`} style={{ marginBottom: 12 }} />
            <Select
              placeholder="⚡ 选择模板快速替换当前流程节点..."
              style={{ width: '100%', marginBottom: 12 }}
              value={editFlowTplSelect}
              onChange={handleSelectTemplate}
              allowClear
              showSearch
              optionFilterProp="label"
              options={(templates.length > 0 ? templates : (INDUSTRY_TEMPLATES as WorkflowTemplate[])).map(t => ({
                label: `${t.name}（${t.industry}）`,
                value: t.id,
              }))}
            />
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {editFlowNodes.map((node, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#fafbfc', padding: 8, borderRadius: 8, border: '1px solid #eee', marginBottom: 6 }}>
                  <Text type="secondary" style={{ width: 20 }}>{i + 1}</Text>
                  <Input
                    value={node.icon}
                    onChange={e => { const a = [...editFlowNodes]; a[i] = { ...a[i], icon: e.target.value }; setEditFlowNodes(a); }}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <Input
                    value={node.name}
                    onChange={e => { const a = [...editFlowNodes]; a[i] = { ...a[i], name: e.target.value }; setEditFlowNodes(a); }}
                    style={{ flex: 1 }}
                  />
                  <Input
                    value={node.description || ''}
                    onChange={e => { const a = [...editFlowNodes]; a[i] = { ...a[i], description: e.target.value }; setEditFlowNodes(a); }}
                    style={{ flex: 1 }} placeholder="描述"
                  />
                  <InputNumber
                    min={0}
                    step={0.5}
                    value={node.estimatedDays}
                    onChange={v => { const a = [...editFlowNodes]; a[i] = { ...a[i], estimatedDays: v === null ? undefined : v }; setEditFlowNodes(a); }}
                    placeholder="天" style={{ width: 70 }} controls={false}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Button size="small" type="text" disabled={i === 0} style={{ padding: 0, height: 14 }} icon={<UpOutlined />} onClick={() => { const a = [...editFlowNodes]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setEditFlowNodes(a); }} />
                    <Button size="small" type="text" disabled={i === editFlowNodes.length - 1} style={{ padding: 0, height: 14 }} icon={<DownOutlined />} onClick={() => { const a = [...editFlowNodes]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; setEditFlowNodes(a); }} />
                  </div>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setEditFlowNodes(editFlowNodes.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center' }}>
              <Input value={editFlowNewIcon} onChange={e => setEditFlowNewIcon(e.target.value)} style={{ width: 56, textAlign: 'center' }} placeholder="图标" />
              <Input value={editFlowNewName} onChange={e => setEditFlowNewName(e.target.value)} style={{ flex: 1 }} placeholder="新节点名称" />
              <Input value={editFlowNewDesc} onChange={e => setEditFlowNewDesc(e.target.value)} style={{ flex: 1 }} placeholder="描述" />
              <InputNumber value={editFlowNewDays === '' ? undefined : Number(editFlowNewDays)} onChange={v => setEditFlowNewDays(v === null ? '' : String(v))} placeholder="天" style={{ width: 70 }} controls={false} />
              <Button icon={<PlusOutlined />} onClick={() => { setEditFlowNodes([...editFlowNodes, { name: editFlowNewName || '新节点', icon: editFlowNewIcon || '📌', description: editFlowNewDesc, estimatedDays: editFlowNewDays === '' ? undefined : Number(editFlowNewDays) }]); setEditFlowNewName(''); setEditFlowNewDesc(''); setEditFlowNewDays(''); }}>添加</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default CustomOrderPage;
