import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Table, Button, Space, Select, Input, DatePicker, Statistic, Row, Col, Modal, Form, InputNumber, message, Tag, Tooltip, Radio } from 'antd';
import { SearchOutlined, UndoOutlined, DownloadOutlined, PlusOutlined, CrownOutlined, DatabaseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import CustomerDetailModal from '../../components/CustomerDetailModal';
import { SUBSCRIPTION_OPTIONS } from '../../components/SubscriptionModal';
import { PRICING_TIERS } from '../StoragePricing';
import { getUserQuota, setUserQuota, gbToKb } from '../../utils/storageQuota';

// 租户订购产生的订单存储（全局键，与 SubscriptionModal / StoragePricing 同源）
interface SubOrder { id: string; username: string; planName: string; months: number; price: number; orderTime: string; activatedUntil: string; }
interface StorageOrder { id: string; username: string; tierName: string; sizeGB: number; price: number; orderTime: string; status?: string; refundCredit?: number; }

interface UnifiedOrder {
  key: string;
  orderNo: string;
  type: '软件费' | '空间费';
  username: string;
  companyName: string;
  planName: string;
  spec: string;
  amount: number;
  orderTime: string;
  extra: string;
  status: string;
}

const loadSubOrders = (): SubOrder[] => {
  try { const l = JSON.parse(localStorage.getItem('subscription_orders') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
};
const loadStorageOrders = (): StorageOrder[] => {
  try { const l = JSON.parse(localStorage.getItem('storage_orders') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
};

// 开发者后台 - 客户管理 - 订单管理：汇总租户订购软件费/空间费产生的订单
const DevOrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  // 筛选（输入/应用双状态，点查询才生效）
  const [fType, setFType] = useState(''); const [aType, setAType] = useState('');
  const [fKeyword, setFKeyword] = useState(''); const [aKeyword, setAKeyword] = useState('');
  const [fFrom, setFFrom] = useState(''); const [aFrom, setAFrom] = useState('');
  const [fTo, setFTo] = useState(''); const [aTo, setATo] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [form] = Form.useForm();
  // 客户详情弹窗（点击客户账号/公司名称）
  const [detailUser, setDetailUser] = useState<string | null>(null);

  // 登记弹窗：套餐名称按订单类型下拉选择，月数/空间GB 由套餐自动识别
  const formType = Form.useWatch('type', form) || '软件费';
  const planOptions = useMemo(() => (formType === '软件费'
    ? SUBSCRIPTION_OPTIONS.map(p => ({ value: p.name, label: `${p.name}（${p.months} 个月 / ¥${p.price}）` }))
    : PRICING_TIERS.map(t => ({ value: t.name, label: `${t.name} ${t.sizeGB >= 1024 ? `${(t.sizeGB / 1024).toFixed(0)}TB` : `${t.sizeGB}GB`}（¥${t.price}/月）` }))), [formType]);
  const handlePlanChange = (name: string) => {
    if (formType === '软件费') {
      const p = SUBSCRIPTION_OPTIONS.find(x => x.name === name);
      if (p) form.setFieldsValue({ months: p.months, amount: p.price });
    } else {
      const t = PRICING_TIERS.find(x => x.name === name);
      if (t) form.setFieldsValue({ sizeGB: t.sizeGB, amount: t.price });
    }
  };
  useEffect(() => {
    form.setFieldsValue({ planName: undefined, months: undefined, sizeGB: undefined });
  }, [formType, form]);

  const load = useCallback(() => {
    let users: any[] = [];
    try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
    const nameOf = (u: string) => users.find(x => x.username === u)?.companyName || '';
    const subs: UnifiedOrder[] = loadSubOrders().map(o => ({
      key: o.id, orderNo: o.id, type: '软件费', username: o.username, companyName: nameOf(o.username),
      planName: o.planName, spec: `${o.months} 个月`, amount: o.price, orderTime: o.orderTime,
      extra: `生效至 ${o.activatedUntil}`, status: '已支付',
    }));
    const stor: UnifiedOrder[] = loadStorageOrders().filter(o => o.status !== '已退款').map(o => ({
      key: o.id, orderNo: o.id, type: '空间费', username: o.username, companyName: nameOf(o.username),
      planName: o.tierName, spec: o.sizeGB >= 1024 ? `${(o.sizeGB / 1024).toFixed(0)}TB` : `${o.sizeGB}GB`,
      amount: o.price, orderTime: o.orderTime,
      extra: o.refundCredit ? `旧套餐退款 ¥${Number(o.refundCredit).toFixed(2)} 抵扣，实付差价` : '空间配额已生效',
      status: '已支付',
    }));
    setOrders([...subs, ...stor].sort((a, b) => (a.orderTime < b.orderTime ? 1 : -1)));
  }, []);
  useEffect(() => { load(); }, [load]);

  // 同标签页写入/跨浏览器同步到达时自动刷新，避免订购后列表不更新
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'subscription_orders' || e.key === 'storage_orders') load();
    };
    const onSync = () => load();
    window.addEventListener('storage', onStorage);
    window.addEventListener('sync-data-updated', onSync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sync-data-updated', onSync);
    };
  }, [load]);

  const filtered = useMemo(() => orders.filter(o =>
    (!aType || o.type === aType) &&
    (!aKeyword || o.username.includes(aKeyword) || o.companyName.includes(aKeyword) || o.orderNo.includes(aKeyword)) &&
    (!aFrom || o.orderTime >= aFrom) && (!aTo || o.orderTime <= aTo + 'T23:59:59')), [orders, aType, aKeyword, aFrom, aTo]);

  const totalAmount = filtered.reduce((s, o) => s + o.amount, 0);
  const subAmount = filtered.filter(o => o.type === '软件费').reduce((s, o) => s + o.amount, 0);
  const storAmount = filtered.filter(o => o.type === '空间费').reduce((s, o) => s + o.amount, 0);
  const monthCount = filtered.filter(o => dayjs(o.orderTime).isSame(dayjs(), 'month')).length;

  const handleExport = () => {
    const head = ['订单号', '类型', '客户账号', '公司名称', '套餐', '规格', '金额', '订购时间', '备注', '状态'];
    const lines = filtered.map(o => [o.orderNo, o.type, o.username, o.companyName, o.planName, o.spec, o.amount.toFixed(2), dayjs(o.orderTime).format('YYYY-MM-DD HH:mm'), o.extra, o.status]);
    const csv = '\uFEFF' + [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `开发者订单_${dayjs().format('YYYYMMDD_HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success(`已导出 ${filtered.length} 条订单`);
  };

  const handleAdd = () => {
    form.validateFields().then(values => {
      // 订购时间默认取订单创建时间
      const time = new Date().toISOString();
      if (values.type === '软件费') {
        const months = Number(values.months) || 1;
        // 与租户自购同口径：从当前授权截止日（未过期时）起叠加月数
        let baseExpiry = '';
        try {
          const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          const idx = users.findIndex((u: any) => u.username === values.username);
          if (idx >= 0) {
            const base = users[idx].authorizedUntil && dayjs(users[idx].authorizedUntil).isAfter(dayjs(), 'day') ? dayjs(users[idx].authorizedUntil) : dayjs();
            baseExpiry = base.add(months, 'month').format('YYYY-MM-DD');
            users[idx].authorizedUntil = baseExpiry;
            if (dayjs(baseExpiry).isAfter(dayjs(), 'day')) users[idx].status = '已审核';
            localStorage.setItem('registeredUsers', JSON.stringify(users));
          }
        } catch { /* ignore */ }
        const list = loadSubOrders();
        list.push({
          id: `SUB${Date.now()}`, username: values.username, planName: values.planName || '手动登记套餐',
          months, price: Number(values.amount) || 0, orderTime: time,
          activatedUntil: baseExpiry || dayjs().add(months, 'month').format('YYYY-MM-DD'),
        });
        localStorage.setItem('subscription_orders', JSON.stringify(list));
        message.success(`订单已登记，客户软件授权期已延长 ${months} 个月`);
      } else {
        const sizeGB = Number(values.sizeGB) || 1;
        const list = loadStorageOrders();
        list.push({
          id: `ORD${Date.now()}`, username: values.username, tierName: values.planName || '手动登记空间',
          sizeGB, price: Number(values.amount) || 0, orderTime: time,
        });
        localStorage.setItem('storage_orders', JSON.stringify(list));
        // 与租户自购同口径：空间配额累加生效
        setUserQuota(values.username, getUserQuota(values.username) + gbToKb(sizeGB));
        message.success(`订单已登记，客户空间配额已增加 ${sizeGB}GB`);
      }
      setAddVisible(false);
      form.resetFields();
      load();
    }).catch(() => message.warning('请完善客户/金额'));
  };

  const columns: any[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 170, align: 'center' },
    {
      title: '类型', dataIndex: 'type', width: 90, align: 'center',
      render: (v: string) => v === '软件费'
        ? <Tag color="gold" icon={<CrownOutlined />}>软件费</Tag>
        : <Tag color="cyan" icon={<DatabaseOutlined />}>空间费</Tag>,
    },
    { title: '客户账号', dataIndex: 'username', width: 120, align: 'center', render: (v: string) => <a onClick={() => setDetailUser(v)} style={{ color: '#1e4a7e', fontWeight: 500 }}>{v}</a> },
    { title: '公司名称', dataIndex: 'companyName', width: 180, align: 'center', render: (v: string, r: UnifiedOrder) => <a onClick={() => setDetailUser(r.username)} style={{ color: '#1e4a7e', fontWeight: 500 }}>{v || '—'}</a> },
    { title: '套餐', dataIndex: 'planName', width: 120, align: 'center' },
    { title: '规格', dataIndex: 'spec', width: 90, align: 'center' },
    { title: '金额', dataIndex: 'amount', width: 100, align: 'center', render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 700 }}>¥{v.toFixed(2)}</span> },
    { title: '订购时间', dataIndex: 'orderTime', width: 160, align: 'center', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '备注', dataIndex: 'extra', width: 150, align: 'center', render: (v: string) => <Tooltip title={v}><span style={{ color: '#999', fontSize: 12 }}>{v}</span></Tooltip> },
    { title: '状态', dataIndex: 'status', width: 90, align: 'center', render: (v: string) => <Tag color="green">{v}</Tag> },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="订单总数（当前筛选）" value={filtered.length} suffix="笔" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="软件费合计" value={subAmount} precision={2} prefix="¥" valueStyle={{ color: '#d48806' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="空间费合计" value={storAmount} precision={2} prefix="¥" valueStyle={{ color: '#08979c' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="总金额" value={totalAmount} precision={2} prefix="¥" valueStyle={{ color: '#cf1322' }} /></Card></Col>
      </Row>

      <Card
        title="订单管理（租户订购软件费 / 空间费）"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>导出</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddVisible(true)}>登记订单</Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select style={{ width: 120 }} placeholder="订单类型" allowClear value={fType || undefined} onChange={v => setFType(v || '')}
            options={[{ value: '软件费', label: '软件费' }, { value: '空间费', label: '空间费' }]} />
          <Input style={{ width: 220 }} placeholder="账号/公司/订单号" allowClear value={fKeyword} onChange={e => setFKeyword(e.target.value)} />
          <DatePicker value={fFrom ? dayjs(fFrom) : null} onChange={d => setFFrom(d ? d.format('YYYY-MM-DD') : '')} />
          <DatePicker value={fTo ? dayjs(fTo) : null} onChange={d => setFTo(d ? d.format('YYYY-MM-DD') : '')} />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => { setAType(fType); setAKeyword(fKeyword); setAFrom(fFrom); setATo(fTo); }}>查询</Button>
          <Button icon={<UndoOutlined />} onClick={() => { setFType(''); setFKeyword(''); setFFrom(''); setFTo(''); setAType(''); setAKeyword(''); setAFrom(''); setATo(''); }}>重置</Button>
          <Tag color="purple" style={{ marginLeft: 8 }}>本月订单 {monthCount} 笔</Tag>
        </Space>
        <Table rowKey="key" bordered size="middle" columns={columns} dataSource={filtered}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '暂无订单，租户在「软件续费订购 / 订购更多空间」支付后自动记录于此' }} />
      </Card>

      <Modal title="登记订单（补录线下支付等）" open={addVisible} onOk={handleAdd} onCancel={() => setAddVisible(false)} okText="保存" cancelText="取消" width={560} destroyOnClose>
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 12 }} initialValues={{ type: '软件费' }}>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="type" label="订单类型">
                <Radio.Group optionType="button" buttonStyle="solid" options={[{ value: '软件费', label: '软件费' }, { value: '空间费', label: '空间费' }]} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="username" label="客户账号" rules={[{ required: true }]}>
                <Select showSearch placeholder="选择租户账号" style={{ width: '100%' }}
                  options={(() => { try { return JSON.parse(localStorage.getItem('registeredUsers') || '[]').map((u: any) => ({ value: u.username, label: `${u.username}（${u.companyName || ''}）` })); } catch { return []; } })()} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={24}>
              <Form.Item name="planName" label="套餐名称">
                <Select placeholder={formType === '软件费' ? '点击选择软件套餐' : '点击选择空间套餐'} options={planOptions} onChange={handlePlanChange} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="months" label="月数（软件费）">
                <InputNumber disabled className="reg-plan-readonly" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sizeGB" label="空间GB（空间费）">
                <InputNumber disabled className="reg-plan-readonly" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="amount" label="金额（元）" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 客户详情弹窗 */}
      <CustomerDetailModal username={detailUser} open={!!detailUser} onClose={() => setDetailUser(null)} />
    </div>
  );
};

export default DevOrdersPage;
