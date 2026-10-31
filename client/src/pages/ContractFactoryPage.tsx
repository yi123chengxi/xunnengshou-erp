import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Table, Button, Input, Select, Space, Modal, Form, DatePicker,
  Tag, message, Typography, Tooltip, Popconfirm, Image,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, StopOutlined,
  DeleteOutlined, ReloadOutlined, ShopOutlined, LinkOutlined, ShoppingCartOutlined,
  SettingOutlined, CheckOutlined, CloseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import FieldConfigModal from '../components/FieldConfigModal';
import useResizableColumns from '../hooks/useResizableColumns';

const { Text } = Typography;

const STORAGE_KEY_PREFIX = 'contract_factories_';

// 代加工厂/加工厂列表条目（合作逻辑与表单参考采购商平台供应商列表）
interface FactoryEntry {
  key: string;
  factoryNo: string;
  factoryName: string;
  shortName?: string;
  contactPerson: string;
  contactPhone: string;
  email?: string;
  legalPerson?: string;
  wechatQr?: string;
  province?: string;
  city?: string;
  district?: string;
  address: string;
  processTypes: string[];
  status: '合作中' | '已终止' | '待合作';
  cooperateDate: string;
  terminateReason?: string;
  factoryUsername?: string; // 关联的加工厂注册账号
  companyNo?: string;       // 加工厂公司编号（填写后保存即向该工厂发起合作申请）
  creator: string;
  createdAt: string;
  remark?: string;
}

export const PROCESS_TYPE_OPTIONS = [
  { value: '复合', label: '复合' },
  { value: '针车', label: '针车' },
  { value: '成型', label: '成型' },
  { value: '裁断', label: '裁断' },
  { value: '绣花', label: '绣花' },
  { value: '印花', label: '印花' },
  { value: '高频', label: '高频' },
  { value: '其他', label: '其他' },
];

// 可配置显示/排序的字段（操作列除外）
const ALL_FIELDS = [
  { key: 'factoryNo', label: '工厂编号' },
  { key: 'factoryName', label: '工厂名称' },
  { key: 'companyNo', label: '公司编号' },
  { key: 'shortName', label: '简称' },
  { key: 'contactPerson', label: '联系人' },
  { key: 'contactPhone', label: '联系电话' },
  { key: 'email', label: '电子邮箱' },
  { key: 'legalPerson', label: '法人代表' },
  { key: 'wechatQr', label: '微信加好友二维码' },
  { key: 'province', label: '省' },
  { key: 'city', label: '市' },
  { key: 'district', label: '区' },
  { key: 'address', label: '详细地址' },
  { key: 'processTypes', label: '工序类型' },
  { key: 'status', label: '合作状态' },
  { key: 'cooperateDate', label: '合作日期' },
  { key: 'productList', label: '货品列表' },
  { key: 'remark', label: '备注' },
  { key: 'creator', label: '创建人' },
  { key: 'createdAt', label: '创建时间' },
];

interface ContractFactoryPageProps {
  /** 页面标题：主平台为"代加工厂"，采购商平台为"加工厂列表" */
  title?: string;
}

const ContractFactoryPage: React.FC<ContractFactoryPageProps> = ({ title = '代加工厂' }) => {
  const username = localStorage.getItem('username') || '';
  // 数据归属账号：子账号使用主账号的 username，确保数据共享
  const getDataOwner = () => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) return localStorage.getItem('parentAccount') || username;
    return username;
  };
  const owner = getDataOwner();
  const storageKey = STORAGE_KEY_PREFIX + owner;

  const [dataSource, setDataSource] = useState<FactoryEntry[]>([]);

  // 分字段搜索：输入状态（点击查询才生效）
  const [sNo, setSNo] = useState('');
  const [sName, setSName] = useState('');
  const [sShort, setSShort] = useState('');
  const [sContact, setSContact] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sStatus, setSStatus] = useState<string>('all');
  // 已应用的搜索条件
  const [apNo, setApNo] = useState('');
  const [apName, setApName] = useState('');
  const [apShort, setApShort] = useState('');
  const [apContact, setApContact] = useState('');
  const [apPhone, setApPhone] = useState('');
  const [apStatus, setApStatus] = useState<string>('all');

  const handleSearch = useCallback(() => {
    // 查询时自动刷新表单数据
    try {
      const list = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setDataSource(Array.isArray(list) ? list : []);
    } catch { setDataSource([]); }
    setApNo(sNo); setApName(sName); setApShort(sShort);
    setApContact(sContact); setApPhone(sPhone); setApStatus(sStatus);
  }, [sNo, sName, sShort, sContact, sPhone, sStatus, storageKey]);

  const handleReset = useCallback(() => {
    setSNo(''); setSName(''); setSShort(''); setSContact(''); setSPhone(''); setSStatus('all');
    setApNo(''); setApName(''); setApShort(''); setApContact(''); setApPhone(''); setApStatus('all');
  }, []);

  // 显示字段配置（顺序+勾选，持久化）
  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`facFieldOrder_${owner}`) || 'null');
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
      const saved = JSON.parse(localStorage.getItem(`facFieldVis_${owner}`) || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch { /* ignore */ }
    return Object.fromEntries(ALL_FIELDS.map(f => [f.key, true]));
  });
  const [fieldCfgVisible, setFieldCfgVisible] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const saveFieldConfig = useCallback((order: string[], vis: Record<string, boolean>) => {
    setFieldOrder(order); setFieldVis(vis);
    localStorage.setItem(`facFieldOrder_${owner}`, JSON.stringify(order));
    localStorage.setItem(`facFieldVis_${owner}`, JSON.stringify(vis));
  }, [owner]);

  // 列宽拖拽调整（持久化）
  const { wrapColumns } = useResizableColumns<any>(`colWidths_contractFactory_${owner}`);

  // 新增/编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<FactoryEntry | null>(null);
  const [form] = Form.useForm();
  // 省市区级联选项
  const formProvince = Form.useWatch('province', form);
  const formCity = Form.useWatch('city', form);

  // 终止合作弹窗
  const [terminateVisible, setTerminateVisible] = useState(false);
  const [terminating, setTerminating] = useState<FactoryEntry | null>(null);
  const [terminateForm] = Form.useForm();

  // 货品列表弹窗（参考供应商列表：展示加工厂自己账号下的成品）
  const [productListVisible, setProductListVisible] = useState(false);
  const [productListFactory, setProductListFactory] = useState<string>('');
  const [productListData, setProductListData] = useState<Record<string, any>[]>([]);

  const load = useCallback(() => {
    try {
      const list = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setDataSource(Array.isArray(list) ? list : []);
    } catch {
      setDataSource([]);
    }
  }, [storageKey]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback((list: FactoryEntry[]) => {
    setDataSource(list);
    localStorage.setItem(storageKey, JSON.stringify(list));
  }, [storageKey]);

  // 解析加工厂注册账号（注册角色含 factory 且公司名称匹配）
  const resolveFactoryUsername = useCallback((name: string): string => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => {
        const roles: string[] = Array.isArray(x.roles) ? x.roles : (x.role ? String(x.role).split(',') : []);
        return roles.includes('factory') && (x.companyName || '').trim() === (name || '').trim();
      });
      return u?.username || '';
    } catch { return ''; }
  }, []);

  // 工厂编号：解析对应加工厂注册账号的公司编号（参考供应商列表供应商编号）
  const resolveFactoryNo = useCallback((name: string): string => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => (x.companyName || '').trim() === (name || '').trim());
      if (u?.companyNo) return String(u.companyNo);
      if (u?.companyShortName) return String(u.companyShortName);
    } catch { /* ignore */ }
    return '';
  }, []);

  // 解析账号的公司编号（兼容老账号回退公司简称）
  const resolveCompanyNo = useCallback((uname: string): string => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => x.username === uname);
      if (u?.companyNo) return String(u.companyNo);
      if (u?.companyShortName) return String(u.companyShortName);
    } catch { /* ignore */ }
    return '';
  }, []);

  // 微信加好友二维码：实时从加工厂注册账号获取（参考供应商列表）
  const resolveFactoryWechatQr = useCallback((name: string): string => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const u = users.find((x: any) => (x.companyName || '').trim() === (name || '').trim());
      if (u?.wechatQr) return String(u.wechatQr);
    } catch { /* ignore */ }
    return '';
  }, []);

  // 新增/编辑保存
  const handleModalOk = useCallback(() => {
    form.validateFields().then(values => {
      const name = String(values.factoryName || '').trim();
      if (!name) return;
      const dup = dataSource.find(d => d.factoryName === name && d.key !== editing?.key);
      if (dup) { message.error(`加工厂「${name}」已存在`); return; }
      // 公司编号：解析对应加工厂注册账号，保存后向该工厂发起合作申请
      const no = String(values.companyNo || '').trim();
      let linkedUser: any = null;
      if (no) {
        try {
          const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
          linkedUser = users.find((u: any) => String(u.companyNo || '') === no || String(u.companyShortName || '') === no) || null;
        } catch { /* ignore */ }
        if (!linkedUser) { message.error(`未找到公司编号为 ${no} 的工厂账号，请核对后重新填写`); return; }
        if (linkedUser.username === username || linkedUser.username === owner) { message.error('不能向本账号发起合作申请'); return; }
      }
      const factoryUsername = linkedUser?.username || resolveFactoryUsername(name);
      const companyNo = linkedUser ? (String(linkedUser.companyNo || no)) : (values.companyNo || '');
      const pick = (src: any, old: any) => ({
        factoryName: name,
        companyNo: companyNo || old?.companyNo || '',
        shortName: values.shortName || '',
        contactPerson: values.contactPerson || '',
        contactPhone: values.contactPhone || '',
        email: values.email || '',
        legalPerson: values.legalPerson || '',
        province: values.province || '',
        city: values.city || '',
        district: values.district || '',
        address: values.address || '',
        processTypes: (values.processTypes && values.processTypes.length)
          ? values.processTypes
          : (Array.isArray(linkedUser?.processTypes) && linkedUser.processTypes.length ? linkedUser.processTypes : (old?.processTypes || [])),
        cooperateDate: values.cooperateDate ? dayjs(values.cooperateDate).format('YYYY-MM-DD') : (old?.cooperateDate || dayjs().format('YYYY-MM-DD')),
        remark: values.remark || '',
        factoryUsername: factoryUsername || old?.factoryUsername,
      });
      if (editing) {
        // 编辑时新增/变更公司编号且原状态非合作中 → 重新发起合作申请
        const reApply = !!linkedUser && editing.status !== '合作中';
        const updated = dataSource.map(d => d.key === editing.key ? {
          ...d, ...pick(values, editing),
          status: reApply ? '待合作' as const : editing.status,
          factoryUsername: factoryUsername || d.factoryUsername,
        } : d);
        save(updated);
        message.success(reApply
          ? `已保存，合作申请已发送至加工厂「${linkedUser.companyName || linkedUser.username}」，等待对方同意`
          : (factoryUsername && !editing.factoryUsername ? `已保存，并关联加工厂账号「${factoryUsername}」` : '已保存'));
      } else {
        const seq = dataSource.reduce((m, d) => {
          const n = Number(String(d.factoryNo || '').replace(/\D/g, ''));
          return isNaN(n) ? m : Math.max(m, n);
        }, 0) + 1;
        const entry: FactoryEntry = {
          key: `fac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          factoryNo: `DGJ-${String(seq).padStart(6, '0')}`,
          ...pick(values, null),
          // 填写了公司编号：待合作（等待加工厂同意）；未填：直接合作中
          status: linkedUser ? '待合作' : '合作中',
          creator: username || '管理员',
          createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
        };
        save([entry, ...dataSource]);
        message.success(linkedUser
          ? `加工厂「${name}」已保存，合作申请已发送至加工厂「${linkedUser.companyName || linkedUser.username}」，对方同意后建立合作关系`
          : (factoryUsername
            ? `加工厂「${name}」已建立合作，并关联加工厂账号「${factoryUsername}」`
            : `加工厂「${name}」已建立合作`));
      }
      setModalVisible(false);
      setEditing(null);
      form.resetFields();
    });
  }, [form, dataSource, editing, save, username, owner, resolveFactoryUsername]);

  // 终止合作
  const handleTerminateOk = useCallback(() => {
    terminateForm.validateFields().then(values => {
      if (!terminating) return;
      const updated = dataSource.map(d => d.key === terminating.key ? {
        ...d, status: '已终止' as const, terminateReason: values.reason || '',
      } : d);
      save(updated);
      message.success(`已终止与「${terminating.factoryName}」的合作`);
      setTerminateVisible(false);
      setTerminating(null);
      terminateForm.resetFields();
    });
  }, [terminateForm, terminating, dataSource, save]);

  // 恢复合作
  const handleRestore = useCallback((rec: FactoryEntry) => {
    const updated = dataSource.map(d => d.key === rec.key ? {
      ...d, status: '合作中' as const, terminateReason: undefined,
    } : d);
    save(updated);
    message.success(`已恢复与「${rec.factoryName}」的合作`);
  }, [dataSource, save]);

  // 批准合作（加工厂通过公司编号发起的申请，批准后建立合作并关联账号）
  const handleApprove = useCallback((rec: FactoryEntry) => {
    const factoryUsername = rec.factoryUsername || resolveFactoryUsername(rec.factoryName);
    const updated = dataSource.map(d => d.key === rec.key ? {
      ...d,
      status: '合作中' as const,
      cooperateDate: dayjs().format('YYYY-MM-DD'),
      factoryUsername: factoryUsername || d.factoryUsername,
      terminateReason: undefined,
    } : d);
    save(updated);
    message.success(factoryUsername
      ? `已批准与「${rec.factoryName}」的合作，并关联加工厂账号「${factoryUsername}」`
      : `已批准与「${rec.factoryName}」的合作`);
  }, [dataSource, save, resolveFactoryUsername]);

  // 拒绝合作申请（删除待合作条目）
  const handleReject = useCallback((rec: FactoryEntry) => {
    save(dataSource.filter(d => d.key !== rec.key));
    message.success(`已拒绝「${rec.factoryName}」的合作申请`);
  }, [dataSource, save]);

  // 删除
  const handleDelete = useCallback((rec: FactoryEntry) => {
    save(dataSource.filter(d => d.key !== rec.key));
    message.success(`已删除加工厂「${rec.factoryName}」`);
  }, [dataSource, save]);

  // 过滤（分字段 AND 组合，点击查询后生效）
  const filtered = useMemo(() => {
    let list = dataSource;
    const kw = (s: string) => s.trim().toLowerCase();
    if (apNo) list = list.filter(d => `${d.factoryNo} ${resolveFactoryNo(d.factoryName)}`.toLowerCase().includes(kw(apNo)));
    if (apName) list = list.filter(d => (d.factoryName || '').toLowerCase().includes(kw(apName)));
    if (apShort) list = list.filter(d => (d.shortName || '').toLowerCase().includes(kw(apShort)));
    if (apContact) list = list.filter(d => (d.contactPerson || '').toLowerCase().includes(kw(apContact)));
    if (apPhone) list = list.filter(d => (d.contactPhone || '').toLowerCase().includes(kw(apPhone)));
    if (apStatus !== 'all') list = list.filter(d => d.status === apStatus);
    return list;
  }, [dataSource, apNo, apName, apShort, apContact, apPhone, apStatus, resolveFactoryNo]);

  // 列定义（字段与供应商列表对齐，全部居中）
  const columnMap: Record<string, any> = {
    factoryNo: { key: 'factoryNo', title: '工厂编号', dataIndex: 'factoryNo', width: 120, align: 'center', render: (v: string, r: FactoryEntry) => v || resolveFactoryNo(r.factoryName) || '—' },
    factoryName: {
      key: 'factoryName', title: '工厂名称', dataIndex: 'factoryName', width: 180, align: 'center',
      render: (v: string, r: FactoryEntry) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <ShopOutlined style={{ color: '#1e4a7e' }} />
          <Text strong>{v}</Text>
          {r.factoryUsername && (
            <Tooltip title={`已关联加工厂账号：${r.factoryUsername}`}>
              <Tag color="green" style={{ marginRight: 0 }}><LinkOutlined /> 已关联</Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    shortName: { key: 'shortName', title: '简称', dataIndex: 'shortName', width: 100, align: 'center', render: (v: string) => v || '—' },
    contactPerson: { key: 'contactPerson', title: '联系人', dataIndex: 'contactPerson', width: 100, align: 'center', render: (v: string) => v || '—' },
    contactPhone: { key: 'contactPhone', title: '联系电话', dataIndex: 'contactPhone', width: 130, align: 'center', render: (v: string) => v || '—' },
    email: { key: 'email', title: '电子邮箱', dataIndex: 'email', width: 160, align: 'center', render: (v: string) => v || '—' },
    legalPerson: { key: 'legalPerson', title: '法人代表', dataIndex: 'legalPerson', width: 100, align: 'center', render: (v: string) => v || '—' },
    wechatQr: {
      key: 'wechatQr', title: '微信加好友二维码', width: 110, align: 'center',
      render: (_: any, r: FactoryEntry) => {
        const qr = r.wechatQr || resolveFactoryWechatQr(r.factoryName);
        return qr ? <Image src={qr} alt="微信加好友二维码" width={40} height={40} style={{ objectFit: 'contain', borderRadius: 4, cursor: 'pointer' }} preview={{ mask: '查看' }} /> : '—';
      },
    },
    province: { key: 'province', title: '省', dataIndex: 'province', width: 80, align: 'center', render: (v: string) => v || '—' },
    city: { key: 'city', title: '市', dataIndex: 'city', width: 80, align: 'center', render: (v: string) => v || '—' },
    district: { key: 'district', title: '区', dataIndex: 'district', width: 80, align: 'center', render: (v: string) => v || '—' },
    address: {
      key: 'address', title: '详细地址', dataIndex: 'address', width: 160, align: 'center', ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><Text ellipsis>{v}</Text></Tooltip> : '—',
    },
    processTypes: {
      key: 'processTypes', title: '工序类型', dataIndex: 'processTypes', width: 160, align: 'center',
      render: (v: string[]) => (v && v.length)
        ? <span>{v.map(t => <Tag key={t} color="blue" style={{ marginRight: 2 }}>{t}</Tag>)}</span>
        : '—',
    },
    status: {
      key: 'status', title: '合作状态', dataIndex: 'status', width: 100, align: 'center',
      render: (v: string, r: FactoryEntry) => v === '合作中'
        ? <Tag color="green">合作中</Tag>
        : v === '待合作'
          ? <Tooltip title={(r.creator === username || r.creator === owner) ? '已通过公司编号发送合作申请，等待加工厂同意' : '加工厂通过公司编号发起的合作申请，待批准'}><Tag color="orange">待合作</Tag></Tooltip>
          : <Tooltip title={r.terminateReason ? `终止原因：${r.terminateReason}` : ''}><Tag color="default">已终止</Tag></Tooltip>,
    },
    companyNo: {
      key: 'companyNo', title: '公司编号', dataIndex: 'companyNo', width: 120, align: 'center',
      render: (v: string, r: FactoryEntry) => v || (r.factoryUsername ? resolveCompanyNo(r.factoryUsername) : '') || '—',
    },
    cooperateDate: { key: 'cooperateDate', title: '合作日期', dataIndex: 'cooperateDate', width: 110, align: 'center', render: (v: string) => v || '—' },
    productList: {
      key: 'productList', title: '货品列表', width: 100, align: 'center',
      render: (_: any, record: FactoryEntry) => {
        // 产品存储在加工厂自己的账号下，通过 registeredUsers 解析加工厂 username
        const factoryUser = record.factoryUsername || resolveFactoryUsername(record.factoryName);
        const productOwner = factoryUser || owner;
        let allProducts: any[] = [];
        try { allProducts = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${productOwner}`) || '[]'); } catch { /* ignore */ }
        const finishedProducts = allProducts.filter((p: any) => p.productType === '成品');
        const count = finishedProducts.length;
        return (
          <Button type="link" size="small" icon={<ShoppingCartOutlined />}
            onClick={() => {
              let latest: any[] = [];
              try { latest = JSON.parse(localStorage.getItem(`pageData_basic-data_product-list_${productOwner}`) || '[]'); } catch { /* ignore */ }
              setProductListFactory(record.factoryName);
              setProductListData(latest.filter((p: any) => p.productType === '成品'));
              setProductListVisible(true);
            }}>
            {count > 0 ? <Tag color="blue">{count}</Tag> : '查看'}
          </Button>
        );
      },
    },
    remark: {
      key: 'remark', title: '备注', dataIndex: 'remark', width: 160, align: 'center', ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><Text ellipsis>{v}</Text></Tooltip> : '—',
    },
    creator: { key: 'creator', title: '创建人', dataIndex: 'creator', width: 100, align: 'center', render: (v: string) => v || '—' },
    createdAt: { key: 'createdAt', title: '创建时间', dataIndex: 'createdAt', width: 140, align: 'center', render: (v: string) => v || '—' },
  };

  // 按显示字段配置的顺序+勾选构建列，操作列固定末尾
  const columns = useMemo(() => {
    const visible = fieldOrder.filter(k => fieldVis[k] !== false && columnMap[k]).map(k => columnMap[k]);
    visible.push({
      key: 'action', title: '操作', width: 160, align: 'center', fixed: 'right' as const,
      render: (_: any, r: FactoryEntry) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
              setEditing(r);
              form.setFieldsValue({
                factoryName: r.factoryName, companyNo: r.companyNo, shortName: r.shortName, contactPerson: r.contactPerson,
                contactPhone: r.contactPhone, email: r.email, legalPerson: r.legalPerson,
                province: r.province, city: r.city, district: r.district,
                address: r.address, processTypes: r.processTypes, remark: r.remark,
                cooperateDate: r.cooperateDate ? dayjs(r.cooperateDate) : undefined,
              });
              setModalVisible(true);
            }} />
          </Tooltip>
          {r.status === '待合作' && (r.creator === username || r.creator === owner) ? (
            <Tooltip title="已通过公司编号发送合作申请，等待加工厂同意">
              <Tag color="orange" style={{ marginRight: 0 }}>待同意</Tag>
            </Tooltip>
          ) : r.status === '待合作' ? (
            <>
              <Popconfirm title={`批准与「${r.factoryName}」的合作？批准后建立合作关系`} onConfirm={() => handleApprove(r)} okText="批准" cancelText="取消">
                <Tooltip title="批准合作">
                  <Button size="small" type="link" style={{ color: '#52c41a' }} icon={<CheckOutlined />} />
                </Tooltip>
              </Popconfirm>
              <Popconfirm title={`拒绝「${r.factoryName}」的合作申请？拒绝后该条目删除`} onConfirm={() => handleReject(r)} okText="拒绝" cancelText="取消" okButtonProps={{ danger: true }}>
                <Tooltip title="拒绝申请">
                  <Button size="small" type="link" danger icon={<CloseOutlined />} />
                </Tooltip>
              </Popconfirm>
            </>
          ) : r.status === '合作中' ? (
            <Tooltip title="终止合作">
              <Button size="small" type="link" danger icon={<StopOutlined />} onClick={() => {
                setTerminating(r);
                setTerminateVisible(true);
              }} />
            </Tooltip>
          ) : (
            <Popconfirm title={`确认恢复与「${r.factoryName}」的合作？`} onConfirm={() => handleRestore(r)} okText="确认" cancelText="取消">
              <Tooltip title="恢复合作">
                <Button size="small" type="link" style={{ color: '#52c41a' }} icon={<ReloadOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          <Popconfirm title={`确认删除加工厂「${r.factoryName}」？删除后不可恢复`} onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除">
              <Button size="small" type="link" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    });
    return wrapColumns(visible);
  }, [fieldOrder, fieldVis, wrapColumns, resolveFactoryNo, resolveFactoryWechatQr, resolveFactoryUsername, resolveCompanyNo, owner, username, handleRestore, handleDelete, form]);

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<span><ShopOutlined style={{ color: '#1e4a7e', marginRight: 8 }} />{title}</span>}
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => setFieldCfgVisible(true)}>显示字段</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              setEditing(null);
              form.resetFields();
              setModalVisible(true);
            }}>新增加工厂</Button>
          </Space>
        }
      >
        {/* 分字段搜索栏：点击查询生效，重置清空全部条件 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Input placeholder="工厂编号" allowClear style={{ width: 130 }} value={sNo} onChange={e => setSNo(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="工厂名称" allowClear style={{ width: 150 }} value={sName} onChange={e => setSName(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="简称" allowClear style={{ width: 110 }} value={sShort} onChange={e => setSShort(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="联系人" allowClear style={{ width: 110 }} value={sContact} onChange={e => setSContact(e.target.value)} onPressEnter={handleSearch} />
          <Input placeholder="联系电话" allowClear style={{ width: 130 }} value={sPhone} onChange={e => setSPhone(e.target.value)} onPressEnter={handleSearch} />
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
          scroll={{ x: 2400 }}
          pagination={{ pageSize: pageSize, showSizeChanger: true, onShowSizeChange: (_c, s) => setPageSize(s), showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: `暂无合作加工厂，点击「新增加工厂」建立外协合作` }}
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

      {/* 新增/编辑弹窗（表单字段参考供应商列表） */}
      <Modal
        title={editing ? `编辑加工厂 - ${editing.factoryNo}` : `新增加工厂 - ${title}`}
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditing(null); form.resetFields(); }}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="factoryName" label="工厂名称" rules={[{ required: true, message: '请输入工厂名称' }]}>
            <Input placeholder="请输入加工厂的公司名称" maxLength={50} />
          </Form.Item>
          <Form.Item name="companyNo" label="公司编号" extra="填写对应工厂的公司编号，保存后该工厂页面将显示合作申请，对方同意后建立合作关系">
            <Input placeholder="请输入加工厂的公司编号（选填）" maxLength={20} />
          </Form.Item>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="shortName" label="简称" style={{ width: 290 }}>
              <Input placeholder="加工厂简称（选填）" maxLength={20} />
            </Form.Item>
            <Form.Item name="legalPerson" label="法人代表" style={{ width: 290 }}>
              <Input placeholder="法人代表（选填）" maxLength={20} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="contactPerson" label="联系人" style={{ width: 290 }}>
              <Input placeholder="联系人姓名" maxLength={20} />
            </Form.Item>
            <Form.Item name="contactPhone" label="联系电话" style={{ width: 290 }}>
              <Input placeholder="联系电话" maxLength={20} />
            </Form.Item>
          </Space>
          <Form.Item name="email" label="电子邮箱">
            <Input placeholder="电子邮箱（选填）" maxLength={50} />
          </Form.Item>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="province" label="省" style={{ width: 190 }}>
              <Select placeholder="省" allowClear showSearch options={getProvinceOptions()}
                onChange={() => form.setFieldsValue({ city: undefined, district: undefined })} />
            </Form.Item>
            <Form.Item name="city" label="市" style={{ width: 190 }}>
              <Select placeholder="市" allowClear showSearch options={getCityOptions(formProvince)}
                onChange={() => form.setFieldsValue({ district: undefined })} />
            </Form.Item>
            <Form.Item name="district" label="区/县" style={{ width: 190 }}>
              <Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(formProvince, formCity)} />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="详细地址">
            <Input placeholder="请输入详细地址（街道、门牌号等）" maxLength={100} />
          </Form.Item>
          <Form.Item name="processTypes" label="工序类型" extra="该工厂可承接的外协加工工序类型">
            <Select mode="multiple" placeholder="请选择工序类型" options={PROCESS_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="cooperateDate" label="合作日期">
            <DatePicker style={{ width: '100%' }} placeholder="默认今天" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息（选填）" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 终止合作弹窗 */}
      <Modal
        title={`终止合作 - ${terminating?.factoryName || ''}`}
        open={terminateVisible}
        onOk={handleTerminateOk}
        onCancel={() => { setTerminateVisible(false); setTerminating(null); terminateForm.resetFields(); }}
        okText="终止合作"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={460}
        destroyOnClose
      >
        <Form form={terminateForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="reason" label="终止原因">
            <Input.TextArea rows={3} placeholder="请填写终止合作的原因（选填）" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 货品列表弹窗（加工厂自己账号下的成品） */}
      <Modal
        title={`货品列表 - ${productListFactory}`}
        open={productListVisible}
        onCancel={() => setProductListVisible(false)}
        footer={<Button onClick={() => setProductListVisible(false)}>关闭</Button>}
        width={760}
        destroyOnClose
      >
        <Table
          rowKey={(r: any) => r.key || r.productCode}
          bordered
          size="small"
          dataSource={productListData}
          columns={[
            { title: '商品编码', dataIndex: 'productCode', width: 140, align: 'center' },
            { title: '商品简称', dataIndex: 'shortName', width: 140, align: 'center', render: (v: string) => v || '—' },
            { title: '款式编号', dataIndex: 'styleCode', width: 120, align: 'center', render: (v: string) => v || '—' },
            { title: '建议售价', dataIndex: 'suggestedPrice', width: 100, align: 'center', render: (v: any) => v !== undefined && v !== '' ? `¥${v}` : '—' },
            { title: '状态', dataIndex: 'productStatus', width: 90, align: 'center', render: (v: string) => v || '—' },
          ]}
          pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }}
          locale={{ emptyText: '该加工厂暂无成品货品' }}
        />
      </Modal>
    </div>
  );
};

export default ContractFactoryPage;
