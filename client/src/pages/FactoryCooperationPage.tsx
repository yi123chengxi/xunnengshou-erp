import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Table, Tag, Typography, Space, Empty, Input, Select, Button, message, Modal, Form, Popconfirm, Tooltip } from 'antd';
import { ShopOutlined, PhoneOutlined, UserOutlined, SearchOutlined, ReloadOutlined, SettingOutlined, PlusOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import FieldConfigModal from '../components/FieldConfigModal';
import useResizableColumns from '../hooks/useResizableColumns';

const { Text, Paragraph } = Typography;

// 可配置显示/排序的字段
const ALL_FIELDS = [
  { key: 'ownerAccount', label: '发包工厂' },
  { key: 'ownerAddress', label: '供应商地址' },
  { key: 'factoryName', label: '合作身份' },
  { key: 'processTypes', label: '加工类型' },
  { key: 'status', label: '合作状态' },
  { key: 'cooperateDate', label: '合作日期' },
  { key: 'contact', label: '对方联系人' },
];

// 加工厂平台 - 合作工厂：展示与本加工厂账号建立外协合作的发包工厂
// 数据来源：各发包工厂账号下 contract_factories_<owner> 中关联到本账号的条目
const FactoryCooperationPage: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  const [entries, setEntries] = useState<any[]>([]);

  // 分字段搜索：输入状态（点击查询才生效）
  const [sOwner, setSOwner] = useState('');
  const [sName, setSName] = useState('');
  const [sType, setSType] = useState('');
  const [sContact, setSContact] = useState('');
  const [sStatus, setSStatus] = useState<string>('all');
  // 已应用的搜索条件
  const [apOwner, setApOwner] = useState('');
  const [apName, setApName] = useState('');
  const [apType, setApType] = useState('');
  const [apContact, setApContact] = useState('');
  const [apStatus, setApStatus] = useState<string>('all');

  // 显示字段配置（顺序+勾选，持久化）
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`facCoopFieldOrder_${username}`) || 'null');
      if (Array.isArray(saved) && saved.length) {
        const known = saved.filter((k: string) => ALL_FIELDS.some(f => f.key === k));
        ALL_FIELDS.forEach(f => { if (!known.includes(f.key)) known.push(f.key); });
        return known;
      }
    } catch { /* ignore */ }
    return ALL_FIELDS.map(f => f.key);
  });
  const [fieldVis, setFieldVis] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`facCoopFieldVis_${username}`) || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch { /* ignore */ }
    return Object.fromEntries(ALL_FIELDS.map(f => [f.key, true]));
  });
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const saveFieldConfig = useCallback((order: string[], vis: Record<string, boolean>) => {
    setFieldOrder(order); setFieldVis(vis);
    localStorage.setItem(`facCoopFieldOrder_${username}`, JSON.stringify(order));
    localStorage.setItem(`facCoopFieldVis_${username}`, JSON.stringify(vis));
  }, [username]);

  // 新增发包工厂弹窗（填写发包工厂公司编号发起合作申请，方式同采购商-供应商合作）
  const [addVisible, setAddVisible] = useState(false);
  const [addForm] = Form.useForm();

  // 列宽拖拽调整（持久化）
  const { wrapColumns } = useResizableColumns<any>(`colWidths_factoryCooperation_${username}`);

  const load = useCallback(() => {
    const myCompany = (() => {
      try {
        const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const u = users.find(x => x.username === username);
        return (u?.companyName || '').trim();
      } catch { return ''; }
    })();
    const out: any[] = [];
    // 发包工厂账号 → 供应商名称/地址（注册信息）
    const userOf: Record<string, any> = {};
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      (Array.isArray(users) ? users : []).forEach((u: any) => { userOf[u.username] = u; });
    } catch { /* ignore */ }
    const infoOf = (owner: string) => {
      const u = userOf[owner];
      const region = [u?.province, u?.city, u?.district].filter(Boolean).join(' / ');
      return {
        ownerName: u?.companyName || '',
        ownerAddress: [region, u?.addressDetail].filter(Boolean).join(' ') || '',
      };
    };
    try {
      const prefix = 'contract_factories_';
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const owner = k.slice(prefix.length);
        if (owner === username) continue; // 本账号自己维护的代加工厂列表不算合作工厂
        let list: any[] = [];
        try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch { continue; }
        (Array.isArray(list) ? list : []).forEach((d: any) => {
          const linked = d.factoryUsername && d.factoryUsername === username;
          const nameMatched = myCompany && (d.factoryName || '').trim() === myCompany;
          if (linked || nameMatched) out.push({ ...d, key: `${k}_${d.key}`, srcKey: d.key, ownerAccount: owner, ...infoOf(owner) });
        });
      }
    } catch { /* ignore */ }
    setEntries(out);
  }, [username]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = useCallback(() => {
    load(); // 查询时自动刷新表单数据
    setApOwner(sOwner); setApName(sName); setApType(sType); setApContact(sContact); setApStatus(sStatus);
  }, [sOwner, sName, sType, sContact, sStatus, load]);

  const handleReset = useCallback(() => {
    setSOwner(''); setSName(''); setSType(''); setSContact(''); setSStatus('all');
    setApOwner(''); setApName(''); setApType(''); setApContact(''); setApStatus('all');
  }, []);

  // 新增发包工厂：填写对方公司编号发起合作申请（方式同采购商-供应商合作）
  const handleAddIssuer = useCallback(() => {
    addForm.validateFields().then(values => {
      const no = String(values.companyNo || '').trim();
      let users: any[] = [];
      try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
      const issuer = users.find((u: any) => String(u.companyNo || '') === no || String(u.companyShortName || '') === no);
      if (!issuer) { message.error(`未找到公司编号为 ${no} 的发包工厂账号，请核对后重新填写`); return; }
      if (issuer.username === username) { message.error('不能向本账号发起合作申请'); return; }
      const me = users.find((u: any) => u.username === username);
      const myCompany = me?.companyName || username;
      const issuerKey = 'contract_factories_' + issuer.username;
      let list: any[] = [];
      try { list = JSON.parse(localStorage.getItem(issuerKey) || '[]'); } catch { /* ignore */ }
      const exist = list.find((d: any) => d.factoryName === myCompany);
      if (exist && exist.status === '合作中') { message.warning('与该发包工厂已建立合作，无需重复申请'); return; }
      if (exist && exist.status === '待合作') { message.warning(`合作申请已发送，等待发包工厂「${issuer.companyName || issuer.username}」批准`); return; }
      const now = dayjs();
      const remark = values.remark || '加工厂通过发包工厂公司编号发起合作申请';
      if (exist) {
        // 曾被拒绝/终止：重新发起，重置为待合作
        list = list.map((d: any) => d.key === exist.key ? {
          ...d, status: '待合作', cooperateDate: now.format('YYYY-MM-DD'),
          factoryUsername: username, remark, terminateReason: undefined,
        } : d);
      } else {
        const seq = list.reduce((m: number, d: any) => {
          const n = Number(String(d.factoryNo || '').replace(/\D/g, ''));
          return isNaN(n) ? m : Math.max(m, n);
        }, 0) + 1;
        list.unshift({
          key: `fac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          factoryNo: `DGJ-${String(seq).padStart(6, '0')}`,
          factoryName: myCompany,
          contactPerson: me?.contactPerson || '',
          contactPhone: me?.phone || '',
          processTypes: [],
          status: '待合作',
          cooperateDate: now.format('YYYY-MM-DD'),
          factoryUsername: username,
          creator: username,
          createdAt: now.format('YYYY-MM-DD HH:mm'),
          remark,
        });
      }
      localStorage.setItem(issuerKey, JSON.stringify(list));
      load();
      setAddVisible(false);
      addForm.resetFields();
      message.success(`合作申请已发送，等待发包工厂「${issuer.companyName || issuer.username}」批准；批准后自动出现在合作工厂列表`);
    });
  }, [addForm, username, load]);

  // 同意发包工厂通过公司编号发起的合作申请（跨租户回写对方列表，建立合作关系）
  const handleApproveEntry = useCallback((rec: any) => {
    const k = 'contract_factories_' + rec.ownerAccount;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch { /* ignore */ }
    list = list.map((d: any) => d.key === rec.srcKey ? {
      ...d, status: '合作中', cooperateDate: dayjs().format('YYYY-MM-DD'),
      factoryUsername: d.factoryUsername || username, terminateReason: undefined,
    } : d);
    localStorage.setItem(k, JSON.stringify(list));
    load();
    message.success(`已同意与发包工厂「${rec.ownerName || rec.ownerAccount}」的合作申请，合作关系已建立`);
  }, [username, load]);

  // 拒绝发包工厂发起的合作申请（删除对方列表中的待合作条目）
  const handleRejectEntry = useCallback((rec: any) => {
    const k = 'contract_factories_' + rec.ownerAccount;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch { /* ignore */ }
    list = list.filter((d: any) => d.key !== rec.srcKey);
    localStorage.setItem(k, JSON.stringify(list));
    load();
    message.success(`已拒绝发包工厂「${rec.ownerName || rec.ownerAccount}」的合作申请`);
  }, [load]);

  // 过滤（分字段 AND 组合，点击查询后生效）
  const filtered = useMemo(() => {
    let list = entries;
    const kw = (s: string) => s.trim().toLowerCase();
    if (apOwner) list = list.filter(d => `${d.ownerName || ''} ${d.ownerAccount || ''}`.toLowerCase().includes(kw(apOwner)));
    if (apName) list = list.filter(d => (d.factoryName || '').toLowerCase().includes(kw(apName)));
    if (apType) list = list.filter(d => (d.processTypes || []).join(' ').toLowerCase().includes(kw(apType)));
    if (apContact) list = list.filter(d => `${d.contactPerson || ''} ${d.contactPhone || ''}`.toLowerCase().includes(kw(apContact)));
    if (apStatus !== 'all') list = list.filter(d => d.status === apStatus);
    return list;
  }, [entries, apOwner, apName, apType, apContact, apStatus]);

  const columnMap: Record<string, any> = {
    ownerAccount: {
      key: 'ownerAccount', title: '发包工厂', dataIndex: 'ownerAccount', width: 180, align: 'center',
      render: (v: string, r: any) => (
        <span>
          <Text strong>{r.ownerName || v}</Text>
          {r.ownerName ? <div><Text type="secondary" style={{ fontSize: 12 }}>{v}</Text></div> : null}
        </span>
      ),
    },
    ownerAddress: {
      key: 'ownerAddress', title: '供应商地址', dataIndex: 'ownerAddress', width: 220, align: 'center',
      render: (v: string) => v ? <Tooltip title={v}><Text ellipsis style={{ maxWidth: 200 }}>{v}</Text></Tooltip> : '—',
    },
    factoryName: {
      key: 'factoryName', title: '合作身份', dataIndex: 'factoryName', width: 180, align: 'center',
      render: (v: string) => <span><ShopOutlined style={{ color: '#389e0d', marginRight: 6 }} />{v || '—'}</span>,
    },
    processTypes: {
      key: 'processTypes', title: '加工类型', dataIndex: 'processTypes', width: 160, align: 'center',
      render: (v: string[]) => (v && v.length) ? v.map(t => <Tag key={t} color="blue" style={{ marginRight: 2 }}>{t}</Tag>) : '—',
    },
    status: {
      key: 'status', title: '合作状态', dataIndex: 'status', width: 100, align: 'center',
      render: (v: string) => v === '合作中' ? <Tag color="green">合作中</Tag> : v === '待合作' ? <Tag color="orange">待合作</Tag> : <Tag color="default">已终止</Tag>,
    },
    cooperateDate: { key: 'cooperateDate', title: '合作日期', dataIndex: 'cooperateDate', width: 120, align: 'center', render: (v: string) => v || '—' },
    contact: {
      key: 'contact', title: '对方联系人', width: 200, align: 'center',
      render: (_: any, r: any) => (
        <Space size={8}>
          {r.contactPerson ? <span><UserOutlined style={{ color: '#999', marginRight: 4 }} />{r.contactPerson}</span> : null}
          {r.contactPhone ? <span><PhoneOutlined style={{ color: '#999', marginRight: 4 }} />{r.contactPhone}</span> : null}
          {!r.contactPerson && !r.contactPhone ? '—' : null}
        </Space>
      ),
    },
  };

  // 按显示字段配置的顺序+勾选构建列；操作列固定末尾（待合作且非本方发起 → 同意/拒绝）
  const columns = useMemo(() => {
    const visible = fieldOrder.filter(k => fieldVis[k] !== false && columnMap[k]).map(k => columnMap[k]);
    visible.push({
      key: 'action', title: '操作', width: 150, align: 'center', fixed: 'right' as const,
      render: (_: any, r: any) => r.status === '待合作' && r.creator !== username ? (
        <Space size={4}>
          <Popconfirm title={`同意与发包工厂「${r.ownerName || r.ownerAccount}」的合作申请？同意后建立合作关系`} onConfirm={() => handleApproveEntry(r)} okText="同意" cancelText="取消">
            <Button size="small" type="link" style={{ color: '#52c41a' }} icon={<CheckOutlined />}>同意</Button>
          </Popconfirm>
          <Popconfirm title={`拒绝「${r.ownerName || r.ownerAccount}」的合作申请？拒绝后对方条目删除`} onConfirm={() => handleRejectEntry(r)} okText="拒绝" cancelText="取消" okButtonProps={{ danger: true }}>
            <Button size="small" type="link" danger icon={<CloseOutlined />}>拒绝</Button>
          </Popconfirm>
        </Space>
      ) : r.status === '待合作' ? (
        <Tag color="orange" style={{ marginRight: 0 }}>待同意</Tag>
      ) : null,
    });
    return wrapColumns(visible);
  }, [fieldOrder, fieldVis, wrapColumns, username, handleApproveEntry, handleRejectEntry]);

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<span><ShopOutlined style={{ color: '#389e0d', marginRight: 8 }} />合作工厂</span>}
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示字段</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { addForm.resetFields(); setAddVisible(true); }}>新增发包工厂</Button>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          展示与本加工厂建立外协代加工合作的发包工厂。发包工厂在其「供应商 - 代加工厂」菜单中填写本加工厂公司编号发起合作申请后，本页面将显示待合作记录，点击「同意」后建立合作关系；也可点击「新增发包工厂」填写对方公司编号发起合作申请，对方批准后建立合作。
        </Paragraph>
        {/* 分字段搜索栏：点击查询生效，重置清空全部条件 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Input placeholder="发包工厂" allowClear style={{ width: 150 }} value={sOwner} onChange={e => setSOwner(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="合作身份" allowClear style={{ width: 150 }} value={sName} onChange={e => setSName(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="加工类型" allowClear style={{ width: 130 }} value={sType} onChange={e => setSType(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="对方联系人" allowClear style={{ width: 130 }} value={sContact} onChange={e => setSContact(e.target.value)} onPressEnter={handleSearch} />
          <Select
            style={{ width: 120 }}
            value={sStatus}
            onChange={setSStatus}
            options={[
              { value: 'all', label: '全部状态' },
              { value: '合作中', label: '合作中' },
              { value: '待合作', label: '待合作' },
              { value: '已终止', label: '已终止' },
            ]}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
        </div>
        <Table
          rowKey="key"
          bordered
          size="middle"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description="暂无合作工厂，等待发包工厂建立合作" /> }}
        />
      </Card>

      {/* 显示字段设置（勾选+长按拖动排序） */}
      <FieldConfigModal
        open={fieldCfgVisible}
        fields={ALL_FIELDS}
        order={fieldOrder}
        visibility={fieldVis}
        onCancel={() => setFieldCfgVisible(false)}
        onSave={(o, v) => { saveFieldConfig(o, v); setFieldCfgVisible(false); message.success('字段显示设置已保存'); }}
      />

      {/* 新增发包工厂弹窗：填写对方公司编号发起合作申请 */}
      <Modal
        title="新增发包工厂 - 发起合作申请"
        open={addVisible}
        onOk={handleAddIssuer}
        onCancel={() => { setAddVisible(false); addForm.resetFields(); }}
        okText="发起申请"
        cancelText="取消"
        width={480}
        destroyOnClose
      >
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 12 }}>
          填写发包工厂的公司编号（注册账号时生成，8位字母数字）发起建立合作申请，对方在其「供应商 - 代加工厂」菜单中批准后建立合作。
        </Paragraph>
        <Form autoComplete="off" form={addForm} layout="vertical">
          <Form.Item name="companyNo" label="发包工厂公司编号" rules={[{ required: true, message: '请输入发包工厂的公司编号' }]}>
            <Input placeholder="请输入发包工厂的公司编号" maxLength={20} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="申请备注（选填）" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FactoryCooperationPage;
