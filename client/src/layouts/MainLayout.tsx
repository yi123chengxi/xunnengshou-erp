import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useViewOnlyBlocker } from '../hooks/useViewOnlyBlocker';
import { Layout, Menu, theme, Badge, Avatar, Dropdown, Space, Typography, Modal, message, Drawer, List, Tabs, Button, Popover, Descriptions, Tag, Progress, Tooltip, Form, Input, Select, AutoComplete, Alert } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  TeamOutlined,
  BarChartOutlined,
  ToolOutlined,
  ShoppingCartOutlined,
  InboxOutlined,
  DollarOutlined,
  SettingOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  KeyOutlined,
  LockOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  SafetyCertificateOutlined,
  UserSwitchOutlined,
  EditOutlined,
  UploadOutlined,
  ApiOutlined,
  CloseOutlined,
  ShopOutlined,
  ScheduleOutlined,
  RocketOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import type { MenuProps } from 'antd';
import Logo from '../components/Logo';
import KeepAliveOutlet from '../components/KeepAliveOutlet';
import { menuVisible, menuKeyFromPath, usePermTick, getPreviewUser, setPreviewUser } from '../utils/perm';
import { Result as AntResult } from 'antd';
import ServiceOrdersModal from '../components/ServiceOrdersModal';
import EnterpriseCertModal, { CertBadge, fetchCertStatus, getChangeLockMessage } from '../components/EnterpriseCertModal';
import type { CertInfo } from '../components/EnterpriseCertModal';
import StorageCleanupModal from '../components/StorageCleanupModal';
import TrialCountdown from '../components/TrialCountdown';
import SubscriptionModal from '../components/SubscriptionModal';
import dayjs from 'dayjs';
import { getUserQuota, getUsagePercent, formatStorageSize, getUsageBreakdown } from '../utils/storageQuota';
import { FREE_PERIOD, STORAGE_SUBSCRIBE_DISABLED } from '../utils/billingPolicy';
import { getMergedPermissions } from '../config/permissions';
import { isPermAllowed, ECOM_KEY_MIGRATION } from '../utils/devPerms';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import { fetchUnreadCount, onNewMessage as onChatNewMessage, onMarkRead } from '../utils/chatSocket';
import { compressImageFile } from '../utils/imageCompress';
import { loadUserNotices, markUserNoticeRead, markAllUserNoticesRead, clearUserNotices, USER_NOTICES_EVENT, UserNotice } from '../utils/userNotice';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// 统一的蓝色系配色
const PRIMARY = '#1e4a7e';
const SIDER_BG = '#1e3a5f';
const SIDER_SUB_BG = '#152a45';
const HEADER_BG = '#ffffff';
const HEADER_BORDER = '#e8ecf1';

// 模块定义 - 统一蓝色系
interface MenuChild { key: string; label: string; children?: MenuChild[]; }
interface MenuModule { key: string; label: string; shortLabel: string; icon: React.ReactNode; color: string; children: MenuChild[]; direct?: string; }

// 展平模块子菜单（将分组内的叶子菜单提升，用于顶部快捷栏）
const flattenChildren = (mod?: MenuModule | null): MenuChild[] => {
  if (!mod) return [];
  const out: MenuChild[] = [];
  (mod.children || []).forEach(c => {
    if (c.children && c.children.length) out.push(...c.children);
    else out.push(c);
  });
  return out;
};

const modules: MenuModule[] = [
  {
    key: 'basic-data',
    label: '基础数据',
    shortLabel: '商品',
    icon: <DatabaseOutlined />,
    color: PRIMARY,
    children: [
      { key: 'product-list', label: '全部商品' },
      { key: 'finished-product', label: '成品' },
      { key: 'product-bom', label: '半成品' },
      { key: 'raw-material', label: '原材料' },
      { key: 'prod-process', label: '生产工序' },
      { key: 'plan-design', label: '新款研发' },
      { key: 'mold', label: '模具管理' },
      { key: 'product-print', label: '商品打印' },
    ],
  },
  {
    key: 'customer',
    label: '客户管理',
    shortLabel: '客户',
    icon: <TeamOutlined />,
    color: PRIMARY,
    children: [
      { key: 'customer-info', label: '客户基础信息' },
      { key: 'cooperation-manage', label: '合作申请' },
      { key: 'bill-detail', label: '账单明细' },
      { key: 'reconciliation', label: '对账管理' },
      { key: 'price-strategy', label: '采购价设置' },
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    shortLabel: '销售',
    icon: <BarChartOutlined />,
    color: PRIMARY,
    children: [
      { key: 'order-manage', label: '订单管理' },
      { key: 'order-profit', label: '订单毛利率' },
      { key: 'sales-ranking', label: '销售排行榜' },
      { key: 'finance-audit', label: '财务审核' },
      { key: 'print-picking', label: '打单拣货' },
      { key: 'sales-out-stats', label: '销售经营分析' },
    ],
  },
  {
    key: 'production',
    label: '生产管理',
    shortLabel: '生产',
    icon: <ToolOutlined />,
    color: PRIMARY,
    children: [
      { key: 'production-order', label: '生产订单' },
      { key: 'processing-order', label: '加工订单' },
      { key: 'purchase-requisition', label: '采购申请单' },
      { key: 'workflow-templates', label: '生产流程模板' },
      { key: 'production-schedule', label: '生产排期' },
    ],
  },
  {
    key: 'market',
    label: '商机市场',
    shortLabel: '电商',
    icon: <ShopOutlined />,
    color: PRIMARY,
    children: [],
    direct: 'opportunity',
  },
  {
    key: 'newstyle',
    label: '新款进度',
    shortLabel: '新款',
    icon: <RocketOutlined />,
    color: PRIMARY,
    children: [],
    direct: 'progress',
  },
  {
    key: 'brandauth',
    label: '品牌授权',
    shortLabel: '品牌',
    icon: <SafetyCertificateOutlined />,
    color: PRIMARY,
    children: [
      { key: 'manage', label: '品牌管理' },
    ],
  },
  {
    key: 'inventory',
    label: '库存管理',
    shortLabel: '库存',
    icon: <InboxOutlined />,
    color: PRIMARY,
    children: [
      { key: 'prod-in-stats', label: '生产入库统计' },
      { key: 'purchase-receiving', label: '采购入库' },
      { key: 'inventory-check', label: '库存盘点' },
      { key: 'inventory-outbound', label: '库存出库' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    shortLabel: '财务',
    icon: <DollarOutlined />,
    color: PRIMARY,
    children: [
      { key: 'bank-account', label: '银行账户' },
      { key: 'reimbursement', label: '报销' },
      { key: 'payment-request', label: '收/付申请' },
      { key: 'invoice-apply', label: '开票申请' },
      { key: 'shop-management', label: '店铺管理' },
      { key: 'general-ledger', label: '会计账薄' },
      { key: 'simple-ledger', label: '简易账薄' },
    ],
  },
  {
    key: 'hr-manage',
    label: '人事管理',
    shortLabel: '人事',
    icon: <ScheduleOutlined />,
    color: PRIMARY,
    children: [
      { key: 'attendance', label: '考勤打卡' },
      { key: 'salary', label: '工资计算' },
      { key: 'employee', label: '员工档案' },
      { key: 'shift', label: '班次设置' },
      { key: 'leave', label: '请假管理' },
      { key: 'resigned', label: '离职人员' },
    ],
  },
  {
    key: 'settings',
    label: '系统设置',
    shortLabel: '设置',
    icon: <SettingOutlined />,
    color: PRIMARY,
    children: [
      { key: 'account-manage', label: '账号管理' },
      { key: 'role-manage', label: '角色管理' },
      { key: 'expense-fee', label: '费用管理' },
      { key: 'warehouse-manage', label: '仓位管理' },
      { key: 'print-template', label: '打印模板' },
      { key: 'notification-settings', label: '弹窗设置' },
    ],
  },
  {
    key: 'jst',
    label: '聚水潭数据',
    shortLabel: 'API',
    icon: <ApiOutlined />,
    color: PRIMARY,
    children: [
      {
        key: 'api',
        label: 'API接口',
        children: [
          { key: 'order', label: '订单API' },
          { key: 'inventory', label: '库存API' },
          { key: 'product', label: '商品API' },
          { key: 'logistics', label: '物流API' },
          { key: 'outbound', label: '出库API' },
          { key: 'shop', label: '店铺API' },
          { key: 'logistics-company', label: '物流公司API' },
        ],
      },
      {
        key: 'data',
        label: '数据管理',
        children: [
          { key: 'shop-product', label: '店铺商品' },
          { key: 'data-order', label: '订单' },
          { key: 'data-inventory', label: '库存管理' },
          { key: 'data-outbound', label: '出库单' },
        ],
      },
    ],
  },
];

// 多标签页类型
interface TabItem {
  key: string;
  title: string;
  path: string;
  pinned?: boolean;
}

// 从 localStorage 读取固定标签（完整数据）
const PINNED_STORAGE_KEY = 'supplier_pinned_tabs';
const loadPinnedTabs = (): TabItem[] => {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) {
      const items = JSON.parse(raw);
      // 兼容旧格式（字符串数组）
      if (Array.isArray(items) && items.length > 0 && typeof items[0] === 'string') {
        return items.map((key: string) => ({ key, title: key, path: `/${key}`, pinned: true }));
      }
      return (items as TabItem[]).map(t => ({ ...t, pinned: true }));
    }
  } catch { /* ignore */ }
  return [];
};
const savePinnedTabs = (tabs: TabItem[]) => {
  try {
    const pinned = tabs.filter(t => t.pinned).map(({ key, title, path }) => ({ key, title, path, pinned: true }));
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned));
  } catch { /* ignore */ }
};

// 读取开发者后台设置的客户软件菜单权限（dev_customer_perms_<账号>，未设置=全部允许）
const readDevPermSet = (): Set<string> | null => {
  try {
    const u = localStorage.getItem('username') || '';
    const raw = localStorage.getItem(`dev_customer_perms_${u}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set<string>(arr) : null;
  } catch { return null; }
};

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(true);
  // 登录守卫：未登录直接访问后台路由时回登录页（避免无会话时渲染回退身份）；
  // 响应式：他标签清除会话（storage 事件）或切回本标签（visibilitychange）时即刻跳转
  useEffect(() => {
    const check = () => { if (!localStorage.getItem('username')) window.location.replace('/login'); };
    check();
    window.addEventListener('storage', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('storage', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  const [collapsedOpenKeys, setCollapsedOpenKeys] = useState<string[]>([]);
  const [collapsedHoverKey, setCollapsedHoverKey] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState('dashboard');
  const [activeChild, setActiveChild] = useState('');
  const allOpenKeys = ['basic-data', 'customer', 'sales', 'production', 'ecommerce', 'inventory', 'finance', 'hr-manage', 'settings', 'jst'];
  const [openKeys, setOpenKeys] = useState<string[]>(allOpenKeys);
  const [isViewOnly, setIsViewOnly] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // 聊天未读数（显示在商机市场按钮上）
  const [chatUnreadBadge, setChatUnreadBadge] = useState(0);
  useEffect(() => {
    const loadBadge = () => { fetchUnreadCount().then((n: number) => setChatUnreadBadge(n)); };
    loadBadge();
    const unsub1 = onChatNewMessage(() => loadBadge());
    const unsub2 = onMarkRead(() => loadBadge());
    const iv = setInterval(loadBadge, 30000);
    return () => { unsub1(); unsub2(); clearInterval(iv); };
  }, []);

  // 多标签页状态
  const [tabs, setTabs] = useState<TabItem[]>(() => {
    const pinnedTabs = loadPinnedTabs();
    // 确保“供应商首页”始终存在
    const hasDashboard = pinnedTabs.some(t => t.key === 'dashboard');
    const dashboardTab: TabItem = { key: 'dashboard', title: '供应商首页', path: '/dashboard', pinned: true };
    const otherPinned = pinnedTabs.filter(t => t.key !== 'dashboard');
    return [dashboardTab, ...otherPinned];
  });
  const [activeTab, setActiveTab] = useState(() => {
    // 恢复上次激活的标签页
    try { return localStorage.getItem('supplier_active_tab') || 'dashboard'; } catch { return 'dashboard'; }
  });

  // 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; tabKey: string }>({ visible: false, x: 0, y: 0, tabKey: '' });

  // 持久化激活的标签页
  useEffect(() => {
    try { localStorage.setItem('supplier_active_tab', activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // 只读模式：自动禁用内容区域内所有交互元素
  useViewOnlyBlocker(contentRef, isViewOnly);

  // 同步只读模式状态
  useEffect(() => {
    const checkViewOnly = () => {
      setIsViewOnly(localStorage.getItem('isViewOnly') === 'true');
    };
    checkViewOnly();
    window.addEventListener('storage', checkViewOnly);
    return () => window.removeEventListener('storage', checkViewOnly);
  }, []);

  // === 安全防护：子账号首次登录强制改密 ===
  const [forcePwdVisible, setForcePwdVisible] = useState(false);
  const [forcePwdForm] = Form.useForm();

  useEffect(() => {
    if (localStorage.getItem('forcePasswordChange') === 'true') {
      setForcePwdVisible(true);
    }
  }, []);

  const handleForcePasswordChange = useCallback(() => {
    forcePwdForm.validateFields().then(values => {
      const username = localStorage.getItem('username') || '';
      const registeredUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const idx = registeredUsers.findIndex((u: any) => u.username === username);
      if (idx >= 0) {
        registeredUsers[idx].password = values.newPwd;
        registeredUsers[idx].needsPasswordChange = false;
        localStorage.setItem('registeredUsers', JSON.stringify(registeredUsers));
      }
      localStorage.removeItem('forcePasswordChange');
      setForcePwdVisible(false);
      forcePwdForm.resetFields();
      message.success('密码修改成功，请牢记新密码');
    });
  }, [forcePwdForm]);

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    const handler = () => setCtxMenu(prev => ({ ...prev, visible: false }));
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // 通知相关状态
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  // 空间用量：本地增量账本 + 服务端增量计数器合成，后台异步刷新
  const [spaceUsedKB, setSpaceUsedKB] = useState(0);
  useEffect(() => {
    let on = true;
    const uname0 = localStorage.getItem('username') || '';
    const load = () => { getUsageBreakdown(uname0).then(b => { if (on) setSpaceUsedKB(b.totalKB); }); };
    load();
    window.addEventListener('storage-usage-updated', load);
    return () => { on = false; window.removeEventListener('storage-usage-updated', load); };
  }, []);
  // 顶栏消息通知：读取站内通知库（user_notice_<账号>_* 逐条键，含开发者反馈处理提醒）
  const [notifications, setNotifications] = useState<UserNotice[]>([]);
  const reloadNotifications = useCallback(() => {
    const uname = localStorage.getItem('username') || '';
    const list = loadUserNotices(uname);
    setNotifications(list);
    setNotificationCount(list.filter(n => !n.read).length);
  }, []);
  useEffect(() => {
    reloadNotifications();
    const onUpd = () => reloadNotifications();
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith('user_notice_')) reloadNotifications(); };
    window.addEventListener(USER_NOTICES_EVENT, onUpd);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(USER_NOTICES_EVENT, onUpd);
      window.removeEventListener('storage', onStorage);
    };
  }, [reloadNotifications]);

  // 设置模态框
  const [settingsVisible, setSettingsVisible] = useState(false);
  
  // 个人中心弹窗
  const [profileVisible, setProfileVisible] = useState(false);

  // 服务订单弹窗
  const [serviceOrdersVisible, setServiceOrdersVisible] = useState(false);

  // 企业认证弹窗
  const [enterpriseCertVisible, setEnterpriseCertVisible] = useState(false);
  const [cleanupModalVisible, setCleanupModalVisible] = useState(false);

  // 当前用户企业认证状态
  const [ownCertInfo, setOwnCertInfo] = useState<CertInfo | null>(null);
  const loadOwnCert = useCallback(async () => {
    const un = localStorage.getItem('username') || '';
    const s = await fetchCertStatus(un);
    setOwnCertInfo(s);
  }, []);
  useEffect(() => { void loadOwnCert(); }, [loadOwnCert]);

  // 企业信息编辑弹窗
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editProfileForm] = Form.useForm();
  const [wechatQrPreview, setWechatQrPreview] = useState('');
  const [payQrPreview, setPayQrPreview] = useState('');
  // 收款银行账户下拉选项（财务管理-银行账户列表，可按户名/开户银行/账号/类型检索）
  const [bankAcctOptions, setBankAcctOptions] = useState<{ value: string; searchText: string; label: React.ReactNode }[]>([]);
  const [bankAcctOpen, setBankAcctOpen] = useState(false);
  const [bankAcctRecords, setBankAcctRecords] = useState<any[]>([]);
  // 下拉选项值串（选中后用于反查原始记录回填字段）
  const composeBankValue = (b: any) =>
    `${b.bankName || ''}${b.branchName ? `（${b.branchName}）` : ''} 户名：${b.name || b.accountName || b.id || ''} 账号：${b.bankAccountNo || ''}`.trim();
  const loadBankAcctOptions = () => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    const owner = (isSub ? localStorage.getItem('parentAccount') : localStorage.getItem('username')) || localStorage.getItem('username') || '';
    let banks: any[] = [];
    try { banks = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${owner}`) || '[]'); } catch { /* ignore */ }
    setBankAcctRecords(banks);
    setBankAcctOptions(banks.map((b: any) => {
      const name = b.name || b.accountName || b.id || '';
      const bank = `${b.bankName || ''}${b.branchName ? `（${b.branchName}）` : ''}`;
      const last4 = b.bankAccountNo ? '****' + String(b.bankAccountNo).slice(-4) : '';
      return {
        value: composeBankValue(b),
        searchText: `${name} ${b.bankName || ''} ${b.branchName || ''} ${b.bankAccountNo || ''} ${last4} ${b.accountType || ''}`.toLowerCase(),
        label: (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 600 }}>{name || '—'}</span>
            <span style={{ color: '#888' }}>开户银行：{b.bankName || '—'}{b.branchName ? `（${b.branchName}）` : ''}</span>
            <span style={{ color: '#888' }}>尾号：{last4 || '—'}</span>
            <Tag color="blue" style={{ marginRight: 0 }}>{b.accountType || '—'}</Tag>
          </span>
        ),
      };
    }));
  };
  // 省市区级联选项
  const editProvince = Form.useWatch('province', editProfileForm);
  const editCity = Form.useWatch('city', editProfileForm);

  // 软件订购弹窗
  const [subModalVisible, setSubModalVisible] = useState(false);

  // 获取当前用户注册信息
  const getUserInfo = () => {
    const username = localStorage.getItem('username');
    if (!username) return null;
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return registeredUsers.find((u: any) => u.username === username) || null;
  };

  // 打开企业信息编辑弹窗
  const handleOpenEditProfile = () => {
    const userInfo = getUserInfo();
    if (!userInfo) return;
    loadBankAcctOptions();
    editProfileForm.setFieldsValue({
      companyName: userInfo.companyName || '',
      taxpayerCode: userInfo.taxpayerCode || '',
      legalPerson: userInfo.legalPerson || '',
      contactPerson: userInfo.contactPerson || '',
      phone: userInfo.phone || '',
      wechatQr: userInfo.wechatQr || '',
      businessAddress: userInfo.businessAddress || '',
      province: userInfo.province || '',
      city: userInfo.city || '',
      district: userInfo.district || '',
      addressDetail: userInfo.addressDetail || '',
      payBankInfo: userInfo.payBankInfo || '',
      payQrImage: userInfo.payQrImage || '',
      accountName: userInfo.accountName || '',
      bankName: userInfo.bankName || '',
      branchName: userInfo.branchName || '',
      bankAccountNo: userInfo.bankAccountNo || '',
    });
    setWechatQrPreview(userInfo.wechatQr || '');
    setPayQrPreview(userInfo.payQrImage || '');
    setEditProfileVisible(true);
  };

  // 保存企业信息
  const handleSaveProfile = () => {
    editProfileForm.validateFields().then(values => {
      const username = localStorage.getItem('username');
      if (!username) return;
      const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const updated = registeredUsers.map((u: any) => {
        if (u.username === username) {
          return {
            ...u,
            companyName: values.companyName?.trim() || u.companyName,
            taxpayerCode: values.taxpayerCode?.trim() || '',
            legalPerson: values.legalPerson?.trim() || '',
            contactPerson: values.contactPerson?.trim() || u.contactPerson,
            phone: values.phone?.trim() || u.phone,
            wechatQr: values.wechatQr?.trim() || '',
            businessAddress: values.businessAddress?.trim() || '',
            province: values.province?.trim() || '',
            city: values.city?.trim() || '',
            district: values.district?.trim() || '',
            addressDetail: values.addressDetail?.trim() || '',
            payBankInfo: values.payBankInfo?.trim() || '',
            payQrImage: values.payQrImage || '',
            accountName: values.accountName?.trim() || '',
            bankName: values.bankName?.trim() || '',
            branchName: values.branchName?.trim() || '',
            bankAccountNo: values.bankAccountNo?.trim() || '',
          };
        }
        return u;
      });
      localStorage.setItem('registeredUsers', JSON.stringify(updated));
      setEditProfileVisible(false);
      message.success('企业信息已保存');
    });
  };

  // 个人中心内容
  const renderProfileContent = () => {
    const userInfo = getUserInfo();
    const currentUsername = localStorage.getItem('username');
    const userRole = localStorage.getItem('userRole');
    // 只有系统管理员（主账号）可以编辑企业信息，子账号不可编辑
    const isSystemAdmin = localStorage.getItem('isSubAccount') !== 'true';

    if (!userInfo) {
      return (
        <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
          <p>暂无用户信息</p>
        </div>
      );
    }

    const getRoleText = (role: string) => {
      if (role.includes('supplier') && role.includes('purchaser')) return '供应商+采购商';
      if (role.includes('factory')) return '加工厂';
      if (role.includes('supplier')) return '供应商';
      if (role.includes('purchaser')) return '采购商';
      return role;
    };

    const trialRemaining = userInfo.trialEndDate ? dayjs(userInfo.trialEndDate).diff(dayjs(), 'day') : null;
    const authRemaining = userInfo.authorizedUntil ? dayjs(userInfo.authorizedUntil).diff(dayjs(), 'day') : null;

    return (
      <div>
        {isSystemAdmin && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, marginBottom: 4 }}>
            <Button size="small" type="primary" icon={<EditOutlined />} onClick={handleOpenEditProfile}>
              编辑企业信息
            </Button>
          </div>
        )}
        <Tabs size="small" items={[
          { key: 'basic', label: '基本信息', children: (
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="登录账号">{currentUsername}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={userRole === 'both' ? 'purple' : userRole === 'supplier' ? 'blue' : 'green'}>
                  {getRoleText(userRole || '')}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="公司名称" span={2}>
                {userInfo.companyName}
                <CertBadge info={ownCertInfo} showUncertified />
                {ownCertInfo?.status === 'certified' ? (
                  <Button type="link" size="small" icon={<EditOutlined />} style={{ marginLeft: 8, padding: 0, fontSize: 12 }} onClick={() => {
                    const lock = getChangeLockMessage(ownCertInfo);
                    if (lock) { message.warning(lock, 5); return; }
                    setEnterpriseCertVisible(true);
                  }}>申请变更认证</Button>
                ) : (
                  <Button type="primary" size="small" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setEnterpriseCertVisible(true)}>去认证</Button>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="法人代表">
                {userInfo.legalPerson || '-'}
                {ownCertInfo?.status === 'certified' && <Tag color="green" style={{ marginLeft: 6, fontSize: 11 }}>已认证</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="公司编号">
                <Tag color="blue">{userInfo.companyNo || userInfo.companyShortName || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="单号前缀">
                <Tag color="cyan">{userInfo.orderPrefix || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="纳税人识别码" span={2}>{userInfo.taxpayerCode || '-'}</Descriptions.Item>
              <Descriptions.Item label="联系人">{userInfo.contactPerson}</Descriptions.Item>
              <Descriptions.Item label="联系电话">{userInfo.phone}</Descriptions.Item>
              <Descriptions.Item label="经营地址" span={2}>
                {userInfo.province || userInfo.city || userInfo.district || userInfo.addressDetail
                  ? [userInfo.province, userInfo.city, userInfo.district, userInfo.addressDetail].filter(Boolean).join(' ')
                  : (userInfo.businessAddress || '-')}
              </Descriptions.Item>
              <Descriptions.Item label="电子邮箱" span={2}>{userInfo.email}</Descriptions.Item>
              <Descriptions.Item label="注册日期">{userInfo.registerDate}</Descriptions.Item>
              <Descriptions.Item label="审核状态">
                <Tag color={userInfo.status === '已审核' ? 'green' : userInfo.status === '已拒绝' ? 'red' : 'orange'}>
                  {userInfo.status}
                </Tag>
              </Descriptions.Item>
              {userInfo.trialEndDate && (
                <Descriptions.Item label="试用截止">
                  {trialRemaining !== null && trialRemaining <= 0 ? (
                    <Tag color="red">已到期 ({userInfo.trialEndDate})</Tag>
                  ) : (
                    <span style={{ color: '#faad14' }}>
                      {userInfo.trialEndDate}（剩余 {trialRemaining} 天）
                    </span>
                  )}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="软件有效期" span={userInfo.trialEndDate ? 1 : 2}>
                {userInfo.authorizedUntil ? (
                  authRemaining !== null && authRemaining <= 0 ? (
                    <Space>
                      <Tag color="red">已到期 ({userInfo.authorizedUntil})</Tag>
                      <Button size="small" type="link" onClick={() => setSubModalVisible(true)}
                        style={{ padding: 0, fontWeight: 600, color: '#faad14' }}>订购续费</Button>
                    </Space>
                  ) : (
                    <Tag color="green">至 {userInfo.authorizedUntil}（剩余 {authRemaining} 天）</Tag>
                  )
                ) : (
                  <span style={{ color: '#999' }}>待审核授权</span>
                )}
              </Descriptions.Item>
            </Descriptions>
          )},
          { key: 'bank', label: '银行与收款', children: (
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="账户名称">{userInfo.accountName || '-'}</Descriptions.Item>
              <Descriptions.Item label="开户银行">{userInfo.bankName || '-'}</Descriptions.Item>
              <Descriptions.Item label="支行名称">{userInfo.branchName || '-'}</Descriptions.Item>
              <Descriptions.Item label="银行账户">{userInfo.bankAccountNo ? <span style={{ fontFamily: 'monospace' }}>{userInfo.bankAccountNo}</span> : '-'}</Descriptions.Item>
              <Descriptions.Item label="收款银行账户" span={2}>
                {userInfo.payBankInfo ? <span style={{ whiteSpace: 'pre-wrap' }}>{userInfo.payBankInfo}</span> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="收款码" span={2}>
                {userInfo.payQrImage ? (
                  <img src={userInfo.payQrImage} alt="收款码" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, border: '1px solid #eee' }} />
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="微信加好友二维码" span={2}>
                {userInfo.wechatQr ? (
                  <img src={userInfo.wechatQr} alt="微信加好友二维码" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, border: '1px solid #eee' }} />
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>
          )},
        ]} />

        {userInfo.status === '待审核' && (
          <div style={{
            marginTop: 16,
            padding: '12px 16px',
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: 8,
          }}>
            <Text style={{ color: '#ad6800', fontSize: 13 }}>
              <InfoCircleOutlined style={{ marginRight: 8 }} />
              您的账号正在审核中，请耐心等待。试用期至 {userInfo.trialEndDate}。
            </Text>
          </div>
        )}

        {!FREE_PERIOD && userInfo.status === '已审核' && userInfo.authorizedUntil && authRemaining !== null && authRemaining <= 30 && authRemaining > 0 && (
          <div style={{
            marginTop: 16,
            padding: '12px 16px',
            background: '#fff7e6',
            border: '1px solid #ffd591',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Text style={{ color: '#d48806', fontSize: 13 }}>
              <WarningOutlined style={{ marginRight: 8 }} />
              软件授权还剩 {authRemaining} 天到期
            </Text>
            <Button
              size="small"
              onClick={() => setSubModalVisible(true)}
              style={{
                fontWeight: 700,
                border: 'none',
                background: 'linear-gradient(135deg, #f5a623 0%, #d4890a 100%)',
                color: '#fff',
              }}
            >
              立即续费
            </Button>
          </div>
        )}

        {!FREE_PERIOD && userInfo.authorizedUntil && authRemaining !== null && authRemaining <= 0 && (
          <div style={{
            marginTop: 16,
            padding: '12px 16px',
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <Text style={{ color: '#cf1322', fontSize: 13 }}>
              <CloseCircleOutlined style={{ marginRight: 8 }} />
              软件授权已到期，请尽快订购续费！
            </Text>
            <Button
              size="small"
              onClick={() => setSubModalVisible(true)}
              style={{
                fontWeight: 700,
                border: 'none',
                background: 'linear-gradient(135deg, #f5a623 0%, #d4890a 100%)',
                color: '#fff',
              }}
            >
              立即续费
            </Button>
          </div>
        )}
      </div>
    );
  };

  const currentModule = modules.find(m => m.key === activeModule);
  const barChildren = flattenChildren(currentModule);

  // 用户菜单处理
  const handleUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    switch (key) {
      case 'profile':
        setProfileVisible(true);
        break;
      case 'settings':
        setSettingsVisible(true);
        break;
      case 'serviceOrders':
        setServiceOrdersVisible(true);
        break;
      case 'enterpriseCert':
        setEnterpriseCertVisible(true);
        break;
        case 'logout':
        Modal.confirm({
          title: '确认退出',
          icon: <InfoCircleOutlined style={{ color: '#faad14' }} />,
          content: '确定要退出登录吗？',
          okText: '确定退出',
          cancelText: '取消',
          onOk: () => {
            // 清除用户角色和只读模式状态
            localStorage.removeItem('userRole');
            localStorage.removeItem('username');
            localStorage.removeItem('isViewOnly');
            // 清除子账号权限标识
            localStorage.removeItem('isSubAccount');
            localStorage.removeItem('parentAccount');
            localStorage.removeItem('userRoles');
            localStorage.removeItem('userCustomPermissions');
            message.success('已安全退出，即将跳转到登录页');
            setTimeout(() => navigate('/login'), 1000);
          },
        });
        break;
    }
  };

  const userMenuItems: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: '企业信息' },
    { key: 'serviceOrders', icon: <ShoppingCartOutlined />, label: '服务订单' },
    { key: 'enterpriseCert', icon: <SafetyCertificateOutlined />, label: '企业认证' },
    { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  // 通知点击处理（标记已读并回写站内通知库）
  const handleNotificationClick = (id: string) => {
    markUserNoticeRead(id);
    message.info('已标记为已读');
  };

  // 全部已读
  const handleMarkAllRead = () => {
    markAllUserNoticesRead(localStorage.getItem('username') || '');
    message.success('已全部标记为已读');
  };

  // 清除通知
  const handleClearNotifications = () => {
    Modal.confirm({
      title: '确认清除',
      content: '确定要清除所有通知吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        clearUserNotices(localStorage.getItem('username') || '');
        message.success('已清除所有通知');
      },
    });
  };

  const handleChildClick = (childKey: string) => {
    setActiveChild(childKey);
    navigate(`/${activeModule}/${childKey}`);
  };

  // 根据路由同步状态（支持三级菜单：模块/分组/叶子）
  React.useEffect(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 1) {
      const moduleKey = pathParts[0];
      const childKey = pathParts.slice(1).join('/') || '';
      const mod = modules.find(m => m.key === moduleKey);
      if (mod) {
        setActiveModule(moduleKey);
        setActiveChild(childKey);
        // 同步标签页
        const tabKey = childKey || moduleKey;
        const title = getMenuTitle(tabKey);
        const path = `/${pathParts.join('/')}`;
        setTabs(prev => {
          if (prev.some(t => t.key === tabKey)) return prev;
          const pinned = prev.filter(t => t.pinned);
          const unpinned = prev.filter(t => !t.pinned);
          return [...pinned, ...unpinned, { key: tabKey, title, path, pinned: false }];
        });
        setActiveTab(tabKey);
      }
    }
  }, [location.pathname]);

  // PERM_V2 统一权限解析（用户>开发者>角色>legacy白名单，事件驱动实时刷新）
  const permTick = usePermTick();
  const vis = (key: string) => menuVisible('supplier', key);
  const previewUser = getPreviewUser();

  // 构建左侧菜单 items（支持三级嵌套 + 子账号权限过滤 + 开发者客户权限过滤）
  const menuItems: MenuProps['items'] = useMemo(() => {
    // 折叠时：图标在上 + 简称（前2字）在下，合为一个 icon 元素
    const collapsedIcon = (icon: React.ReactNode, short: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.2, width: '100%' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 56, textAlign: 'center' }}>{short}</span>
      </div>
    );
    const buildChild = (modKey: string, child: MenuChild): any => {
      if (child.children && child.children.length) {
        const sub = child.children
          .filter(g => vis(`${modKey}/${g.key}`))
          .map(g => ({ key: `${modKey}/${g.key}`, label: g.label }));
        if (sub.length === 0) return null;
        return { key: `${modKey}/${child.key}`, label: child.label, children: sub };
      }
      if (!vis(`${modKey}/${child.key}`)) return null;
      return { key: `${modKey}/${child.key}`, label: child.label };
    };
    // 电商常用：把 新款进度/店铺管理/商机市场 归为一个一级菜单（叶子 key 用真实路由全路径）
    const ecomVisible = (key: string) => vis(key);
    const ecomLeaves = [
      { key: 'ecommerce/progress', label: '新款进度' },
      { key: 'ecommerce/shop-management', label: '店铺管理' },
      { key: 'ecommerce/opportunity', label: '商机市场' },
      { key: 'ecommerce/warehouse-stats', label: '仓库统计' },
    ].filter(l => ecomVisible(l.key));
    // 品牌管理：电商常用下单一入口（页面内页签切换 授权品牌/自有品牌）
    const brandLeaves = [
      { key: 'ecommerce/manage', label: '品牌管理' },
    ].filter(l => ecomVisible(l.key));
    const ecommerceChildren: any[] = [
      ...ecomLeaves.map(l => ({ key: l.key, label: l.label })),
      ...brandLeaves.map(l => ({ key: l.key, label: l.label })),
    ];
    const ecommerceItem = ecommerceChildren.length
      ? { key: 'ecommerce', icon: collapsed ? collapsedIcon(<ShoppingOutlined />, '电商') : <ShoppingOutlined />, label: '电商常用', children: ecommerceChildren }
      : null;
    return modules
      .map(mod => {
        // 新款进度已并入电商常用，不再作为顶级直跳模块渲染
        if (mod.key === 'newstyle') return null;
        // 品牌授权两个子页已并入电商常用，不单独渲染顶级模块
        if (mod.key === 'brandauth') return null;
        // 商机市场位置替换为电商常用分组
        if (mod.key === 'market') return ecommerceItem;
        // 无子菜单的直跳模块：点击主菜单直接跳转
        if (mod.direct) {
          const dk = `${mod.key}/${mod.direct}`;
          if (!vis(dk)) return null;
          return { key: dk, icon: collapsed ? collapsedIcon(mod.icon, mod.shortLabel || mod.label.slice(0, 2)) : mod.icon, label: mod.label };
        }
        // 店铺管理已移入电商常用，从财务管理侧边栏子项中剔除
        const children = (mod.children || [])
          .filter(c => !(mod.key === 'finance' && c.key === 'shop-management'))
          .map(c => buildChild(mod.key, c)).filter(Boolean);
        if (children.length === 0) return null;
        return { key: mod.key, icon: collapsed ? collapsedIcon(mod.icon, mod.shortLabel || mod.label.slice(0, 2)) : mod.icon, label: mod.label, children };
      })
      .filter(Boolean);
  }, [permTick, collapsed]);

  // 折叠侧边栏菜单项计算（自定义渲染用）
  interface CollapsedMenuItem {
    key: string; icon: React.ReactNode; shortLabel: string;
    children?: { key: string; label: string }[];
    direct?: boolean;
  }
  const collapsedMenuItems: CollapsedMenuItem[] = useMemo(() => {
    const ecomVisible = (key: string) => vis(key);
    const ecomLeaves = [
      { key: 'ecommerce/progress', label: '新款进度' },
      { key: 'ecommerce/shop-management', label: '店铺管理' },
      { key: 'ecommerce/opportunity', label: '商机市场' },
      { key: 'ecommerce/warehouse-stats', label: '仓库统计' },
    ].filter(l => ecomVisible(l.key));
    const brandLeaves = [
      { key: 'ecommerce/manage', label: '品牌管理' },
    ].filter(l => ecomVisible(l.key));
    const ecomChildren = [...ecomLeaves, ...brandLeaves];
    const ecomItem: CollapsedMenuItem | null = ecomChildren.length
      ? { key: 'ecommerce', icon: <ShoppingOutlined />, shortLabel: '电商', children: ecomChildren }
      : null;
    return modules
      .map(mod => {
        if (mod.key === 'newstyle' || mod.key === 'brandauth') return null;
        if (mod.key === 'market') return ecomItem;
        if (mod.direct) {
          const dk = `${mod.key}/${mod.direct}`;
          if (!vis(dk)) return null;
          return { key: dk, icon: mod.icon, shortLabel: mod.shortLabel || mod.label.slice(0, 2), direct: true } as CollapsedMenuItem;
        }
        const children = (mod.children || [])
          .filter(c => !(mod.key === 'finance' && c.key === 'shop-management'))
          .filter(c => {
            if (c.children && c.children.length) {
              const sub = c.children.filter(g => vis(`${mod.key}/${g.key}`));
              return sub.length > 0;
            }
            return vis(`${mod.key}/${c.key}`);
          })
          .flatMap(c => {
            if (c.children && c.children.length) {
              return c.children.filter(g => vis(`${mod.key}/${g.key}`)).map(g => ({ key: `${mod.key}/${g.key}`, label: g.label }));
            }
            return [{ key: `${mod.key}/${c.key}`, label: c.label }];
          });
        if (children.length === 0) return null;
        return { key: mod.key, icon: mod.icon, shortLabel: mod.shortLabel || mod.label.slice(0, 2), children } as CollapsedMenuItem;
      })
      .filter(Boolean) as CollapsedMenuItem[];
  }, [permTick]);

  // 根据 key 获取菜单标题
  // 非菜单路由标题映射
  const extraTitles: Record<string, string> = {
    'daily-bookkeeping-stats': '记账统计分析',
    'finance/daily-bookkeeping-stats': '记账统计分析',
    'daily-bookkeeping': '日常记账',
    'finance/daily-bookkeeping': '日常记账',
    'opportunity': '商机市场',
    'newstyle/progress': '新款进度',
    'progress': '新款进度',
    'warehouse-stats': '仓库统计',
    'ecommerce/warehouse-stats': '仓库统计',
    'shop-management': '店铺管理',
    'finance/shop-management': '店铺管理',
  };

  const getMenuTitle = (key: string): string => {
    if (key === 'dashboard') return '供应商首页';
    if (extraTitles[key]) return extraTitles[key];
    for (const mod of modules) {
      for (const child of mod.children) {
        if (child.key === key) return child.label;
        if (child.key === `${mod.key}/${key}`) return child.label;
        if (child.children) {
          const sub = child.children.find(s => s.key === key || s.key === `${mod.key}/${key}`);
          if (sub) return sub.label;
        }
      }
    }
    return key;
  };

  const onMenuClick: MenuProps['onClick'] = (info) => {
    const parts = info.key.split('/');
    if (parts.length === 2) {
      setActiveModule(parts[0]);
      setActiveChild(parts[1]);
      const title = getMenuTitle(parts[1]);
      const path = `/${parts[0]}/${parts[1]}`;
      // 添加标签页
      setTabs(prev => {
        if (prev.some(t => t.key === parts[1])) return prev;
        const pinned = prev.filter(t => t.pinned);
        const unpinned = prev.filter(t => !t.pinned);
        return [...pinned, ...unpinned, { key: parts[1], title, path, pinned: false }];
      });
      setActiveTab(parts[1]);
      navigate(path);
    } else if (parts.length >= 3) {
      const mod = parts[0];
      const rest = parts.slice(1).join('/');
      setActiveModule(mod);
      setActiveChild(rest);
      const title = getMenuTitle(rest);
      const path = `/${info.key}`;
      setTabs(prev => {
        if (prev.some(t => t.key === rest)) return prev;
        const pinned = prev.filter(t => t.pinned);
        const unpinned = prev.filter(t => !t.pinned);
        return [...pinned, ...unpinned, { key: rest, title, path, pinned: false }];
      });
      setActiveTab(rest);
      navigate(path);
    }
  };

  // 切换标签页
  const switchTab = (key: string) => {
    const tab = tabs.find(t => t.key === key);
    if (!tab) return;
    setActiveTab(key);
    if (key === 'dashboard') {
      setActiveModule('dashboard');
      setActiveChild('');
    } else {
      // 查找所属模块
      for (const mod of modules) {
        for (const child of mod.children) {
          if (child.key === key) {
            setActiveModule(mod.key);
            setActiveChild(key);
            break;
          }
          if (child.children) {
            const sub = child.children.find(s => s.key === key);
            if (sub) {
              setActiveModule(mod.key);
              setActiveChild(key);
              break;
            }
          }
        }
      }
    }
    navigate(tab.path);
  };

  // 关闭标签页
  const closeTab = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (key === 'dashboard') return;
    const tab = tabs.find(t => t.key === key);
    if (tab?.pinned) return;
    setTabs(prev => {
      const idx = prev.findIndex(t => t.key === key);
      const next = prev.filter(t => t.key !== key);
      if (activeTab === key && next.length > 0) {
        const newIdx = Math.min(idx, next.length - 1);
        const newTab = next[newIdx];
        setActiveTab(newTab.key);
        navigate(newTab.path);
      }
      return next;
    });
  };

  // 右键菜单处理
  const handleTabContextMenu = (e: React.MouseEvent, tabKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, tabKey });
  };

  const closeCtxMenu = () => setCtxMenu(prev => ({ ...prev, visible: false }));

  const pinTab = () => {
    const key = ctxMenu.tabKey;
    setTabs(prev => {
      const next = prev.map(t => t.key === key ? { ...t, pinned: true } : t);
      const pinned = next.filter(t => t.pinned);
      const unpinned = next.filter(t => !t.pinned);
      savePinnedTabs(next);
      return [...pinned, ...unpinned];
    });
    closeCtxMenu();
  };

  const unpinTab = () => {
    const key = ctxMenu.tabKey;
    setTabs(prev => {
      const next = prev.map(t => t.key === key ? { ...t, pinned: false } : t);
      savePinnedTabs(next);
      return next;
    });
    closeCtxMenu();
  };

  const onOpenChange = (keys: string[]) => {
    const added = keys.filter(k => !openKeys.includes(k));
    setOpenKeys(keys);
    // 仅当展开新的一级模块时跳转；展开/收起二级分组（含 / 的 key）不跳转
    const topAdded = added.find(k => !k.includes('/'));
    // ecommerce 为纯分组菜单无对应路由，展开时不跳转
    if (topAdded && topAdded !== activeModule && topAdded !== 'ecommerce') {
      setActiveModule(topAdded);
      setActiveChild('');
      navigate(`/${topAdded}`);
    }
  };

  const selectedKeys = activeChild ? [`${activeModule}/${activeChild}`] : [activeModule];

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* 左侧菜单导航 - 深蓝色风格 */}
      <Sider
        className="main-layout-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        style={{ background: SIDER_BG, height: '100vh', display: 'flex', flexDirection: 'column' }}
        width={220}
        collapsedWidth={72}
        trigger={null}
      >
        {/* Logo */}
        <div style={{
          height: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: `1px solid rgba(255,255,255,0.08)`,
          padding: '0 16px',
        }}>
          {collapsed ? (
            <Logo size={32} showText={false} />
          ) : (
            <Logo size={32} showText={true} textColor="#fff" fontSize={16} />
          )}
        </div>

        {/* 菜单 */}
        <style>{`
          .main-layout-sider > .ant-layout-sider-children {
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: visible;
          }
          .main-sider-menu > .ant-menu-submenu > .ant-menu-sub {
            display: flex;
            flex-wrap: wrap;
          }
          .main-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-item {
            width: 50%;
            min-width: 0;
            padding-left: 12px !important;
            padding-right: 4px !important;
            margin: 0;
            box-sizing: border-box;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .main-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-submenu {
            width: 50%;
            min-width: 0;
            padding-left: 0 !important;
            box-sizing: border-box;
          }
          .main-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-submenu > .ant-menu-submenu-title {
            padding-left: 12px !important;
            padding-right: 4px !important;
            margin: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .main-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-submenu > .ant-menu-sub .ant-menu-item {
            padding-left: 24px !important;
          }
          /* 标签栏滚动条隐藏 */
          .tab-scroll-hide::-webkit-scrollbar { display: none; }
          .tab-scroll-hide { -ms-overflow-style: none; scrollbar-width: none; }
          /* 折叠时弹出子菜单样式 */
          .ant-menu-submenu-popup {
            z-index: 1050 !important;
          }
          .ant-menu-submenu-popup .ant-menu.ant-menu-dark {
            background: ${SIDER_BG} !important;
          }
          .ant-menu-submenu-popup .ant-menu.ant-menu-dark .ant-menu-sub {
            background: ${SIDER_BG} !important;
          }
          .ant-menu-submenu-popup .ant-menu.ant-menu-dark .ant-menu-item:hover {
            background: rgba(255,255,255,0.08) !important;
          }
          .ant-menu-submenu-popup .ant-menu.ant-menu-dark .ant-menu-item {
            color: rgba(255,255,255,0.85) !important;
          }
          /* 折叠时菜单项居中显示图标+简称 */
          .main-sider-menu.ant-menu-inline-collapsed > .ant-menu-item {
            padding: 0 !important;
            text-align: center;
          }
          .main-sider-menu.ant-menu-inline-collapsed > .ant-menu-submenu > .ant-menu-submenu-title {
            padding: 0 !important;
            text-align: center;
          }
        `}</style>
        {collapsed ? (
          /* 自定义折叠侧边栏：图标 + 2字简称 + 悬浮弹出子菜单 */
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 8 }}>
            {collapsedMenuItems.map(item => {
              const isActive = selectedKeys.includes(item.key) || (item.children && item.children.some(c => selectedKeys.includes(c.key)));
              const popoverContent = item.children && item.children.length > 0 ? (
                <div style={{ minWidth: 140, maxHeight: 400, overflowY: 'auto' }}>
                  {item.children.map(child => (
                    <div key={child.key} onClick={() => onMenuClick({ key: child.key, keyPath: [child.key], domEvent: {} as any, item: null as any })} style={{
                      padding: '8px 12px', cursor: 'pointer', color: 'rgba(255,255,255,0.85)', fontSize: 13,
                      borderRadius: 4, marginBottom: 2, transition: 'background 0.2s', whiteSpace: 'nowrap',
                      background: selectedKeys.includes(child.key) ? 'rgba(255,255,255,0.12)' : 'transparent',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = selectedKeys.includes(child.key) ? 'rgba(255,255,255,0.12)' : 'transparent'; }}
                    >{child.label}</div>
                  ))}
                </div>
              ) : undefined;
              const trigger = (
                <div key={item.key} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0',
                  cursor: 'pointer', borderRadius: 6, margin: '8px 6px', transition: 'background 0.2s',
                  background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                }}
                onClick={() => { if (item.direct) onMenuClick({ key: item.key, keyPath: [item.key], domEvent: {} as any, item: null as any }); }}
                >
                  <span style={{ fontSize: 20, color: '#fff', lineHeight: 1 }}>{item.icon}</span>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4, lineHeight: 1 }}>{item.shortLabel}</span>
                </div>
              );
              if (popoverContent) {
                return (
                  <Popover key={item.key} content={popoverContent} placement="rightTop"
                    trigger="hover" open={collapsedHoverKey === item.key}
                    onOpenChange={open => setCollapsedHoverKey(open ? item.key : null)}
                    overlayInnerStyle={{ padding: 8, background: SIDER_BG, borderRadius: 8 }}
                    getPopupContainer={() => document.body}
                    arrow={false}
                  >{trigger}</Popover>
                );
              }
              return trigger;
            })}
          </div>
        ) : (
          <Menu
            className="main-sider-menu"
            mode="inline"
            theme="dark"
            selectedKeys={selectedKeys}
            openKeys={openKeys}
            onOpenChange={onOpenChange}
            items={menuItems}
            onClick={onMenuClick}
            getPopupContainer={() => document.body}
            style={{
              borderRight: 0,
              background: 'transparent',
              paddingTop: 8,
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          />
        )}
        {/* 底部展开/折叠按钮 */}
        <div
          onClick={() => setCollapsed(!collapsed)}
          style={{
            flexShrink: 0,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.65)',
            fontSize: 13,
            gap: 6,
            transition: 'all 0.2s',
            userSelect: 'none',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 16 }} /> : <MenuFoldOutlined style={{ fontSize: 16 }} />}
          {!collapsed && <span>收起菜单</span>}
        </div>
      </Sider>

      {/* 右侧主体 */}
      <Layout>
        {/* 顶部导航 - 白色背景 */}
        <Header style={{
          background: HEADER_BG,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${HEADER_BORDER}`,
          height: 56,
          lineHeight: '56px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 18, cursor: 'pointer', color: '#8b9db5', lineHeight: 1 }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <div style={{
              fontSize: 16,
              fontWeight: 600,
              color: '#1a2b45',
              whiteSpace: 'nowrap',
            }}>
              讯能手 ERP 管理系统
            </div>
            {currentModule && (
              <>
                <span style={{ color: '#cdd5e0', margin: '0 6px', fontSize: 16 }}>/</span>
                <span style={{
                  fontSize: 14,
                  color: PRIMARY,
                  fontWeight: 500,
                  background: '#e8f4fc',
                  padding: '2px 12px',
                  borderRadius: 4,
                }}>
                  {currentModule.label}
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <TrialCountdown />
            
            {/* 空间使用情况 */}
            {(() => {
              const uname = localStorage.getItem('username') || '';
              const used = spaceUsedKB;
              const quota = getUserQuota(uname);
              const percent = getUsagePercent(used, quota);
              const popoverContent = (
                <div style={{ width: 220, padding: '4px 0' }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, color: '#333' }}>数据库空间</Text>
                        <Text strong style={{ fontSize: 13, color: percent > 90 ? '#ff4d4f' : '#1a2b45' }}>
                          {percent.toFixed(1)}%
                        </Text>
                      </div>
                      {ownCertInfo?.status !== 'certified' && (
                        <div
                          style={{ marginTop: 4, cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); setEnterpriseCertVisible(true); }}
                        >
                          <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>
                            🎁 认证领取10G永久空间
                          </Tag>
                        </div>
                      )}
                    </div>
                    <Progress
                      percent={percent}
                      showInfo={false}
                      size="small"
                      strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : PRIMARY}
                      trailColor="#f0f0f0"
                      style={{ marginBottom: 6 }}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatStorageSize(used)} / {formatStorageSize(quota)}
                    </Text>
                  </div>
                  <Button
                    type="default"
                    block
                    disabled={STORAGE_SUBSCRIBE_DISABLED}
                    icon={<ShoppingCartOutlined />}
                    onClick={() => navigate('/storage-pricing')}
                    title={STORAGE_SUBSCRIBE_DISABLED ? '暂不支持订购：免费期内所有租户默认赠送 10G 空间' : undefined}
                    style={{
                      height: 36,
                      fontWeight: 700,
                      fontSize: 13,
                      border: 'none',
                      borderRadius: 8,
                      background: STORAGE_SUBSCRIBE_DISABLED ? '#d9d9d9' : 'linear-gradient(135deg, #f5a623 0%, #e8960a 50%, #d4890a 100%)',
                      color: STORAGE_SUBSCRIBE_DISABLED ? 'rgba(0,0,0,0.45)' : '#fff',
                      boxShadow: STORAGE_SUBSCRIBE_DISABLED ? 'none' : '0 3px 12px rgba(245, 166, 35, 0.4)',
                      marginBottom: 8,
                    }}
                  >
                    订购更多空间
                  </Button>
                  <Button
                    type="default"
                    block
                    icon={<DatabaseOutlined />}
                    onClick={(e) => { e.stopPropagation(); setCleanupModalVisible(true); }}
                    style={{
                      height: 32,
                      fontSize: 12,
                      borderRadius: 6,
                    }}
                  >
                    整理空间
                  </Button>
                </div>
              );
              return (
                <Popover content={popoverContent} trigger="hover" placement="bottomRight">
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                    onClick={() => navigate('/storage-pricing')}
                  >
                    <Progress
                      type="circle"
                      percent={percent}
                      size={22}
                      showInfo={false}
                      strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : PRIMARY}
                      trailColor="#e8ecf1"
                      strokeWidth={6}
                    />
                    <Text style={{ fontSize: 11, color: '#8b9db5', whiteSpace: 'nowrap' }}>
                      {formatStorageSize(used)}
                    </Text>
                  </div>
                </Popover>
              );
            })()}
            
            <Badge count={notificationCount} size="small" offset={[-2, 2]}>
              <BellOutlined
                style={{ fontSize: 18, cursor: 'pointer', color: '#8b9db5' }}
                onClick={() => setNotificationVisible(true)}
              />
            </Badge>
            
            {/* 商机市场入口 - 切换到采购商视图左边，点击在当前页打开 */}
            <Badge count={chatUnreadBadge} size="small" offset={[-4, 2]}>
              <button
                type="button"
                onClick={() => navigate('/market/opportunity')}
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  border: 'none',
                  background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 50%, #23780a 100%)',
                  color: '#fff',
                  boxShadow: '0 2px 8px rgba(82, 196, 26, 0.45)',
                  padding: '4px 14px',
                  height: 32,
                  lineHeight: '24px',
                  borderRadius: 6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <ShopOutlined />
                商机市场
              </button>
            </Badge>

            {/* 角色切换按钮 - 所有人可见，新窗口打开采购商视图 */}
            <Button
              size="small"
              icon={<ShoppingCartOutlined />}
              onClick={() => window.open('/purchaser/dashboard', '_blank')}
              style={{
                fontWeight: 700,
                fontSize: 13,
                border: 'none',
                borderRadius: 6,
                background: 'linear-gradient(135deg, #f5a623 0%, #e8960a 50%, #d4890a 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(245, 166, 35, 0.45)',
                padding: '4px 14px',
                height: 32,
                lineHeight: '24px',
              }}
            >
              我是采购商
            </Button>

            {/* 角色切换按钮 - 所有人可见，新窗口打开加工厂视图 */}
            <Button
              size="small"
              icon={<ShopOutlined />}
              onClick={() => window.open('/factory/dashboard', '_blank')}
              style={{
                fontWeight: 700,
                fontSize: 13,
                border: 'none',
                borderRadius: 6,
                background: 'linear-gradient(135deg, #52c41a 0%, #3fad14 50%, #389e0d 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(82, 196, 26, 0.45)',
                padding: '4px 14px',
                height: 32,
                lineHeight: '24px',
              }}
            >
              我是加工厂
            </Button>
            
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" style={{ background: PRIMARY }} icon={<UserOutlined />} />
                <Text style={{ color: '#5a6d85' }}>
                  {(() => { const info = getUserInfo(); const un = localStorage.getItem('username') || ''; if (info?.companyName) return `${info.companyName}（${info.contactPerson || ''}）`; if (un) return un; return '未登录'; })()}
                </Text>
              </Space>
            </Dropdown>
          </div>
        </Header>

        {/* 通知抽屉 */}
        <Drawer
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span><BellOutlined style={{ marginRight: 8, color: PRIMARY }} />消息通知</span>
              <Space size="small">
                <Button type="link" size="small" onClick={handleMarkAllRead}>全部已读</Button>
                <Button type="link" size="small" danger onClick={handleClearNotifications}>清除全部</Button>
              </Space>
            </div>
          }
          placement="right"
          width={400}
          open={notificationVisible}
          onClose={() => setNotificationVisible(false)}
        >
          <Tabs
            defaultActiveKey="all"
            items={[
              {
                key: 'all',
                label: `全部 (${notifications.length})`,
                children: (
                  <List
                    dataSource={notifications}
                    renderItem={(item) => (
                      <div
                        onClick={() => handleNotificationClick(item.id)}
                        style={{
                          padding: '12px 16px',
                          borderRadius: 8,
                          marginBottom: 8,
                          cursor: 'pointer',
                          background: item.read ? '#fafcfd' : '#f0f7ff',
                          border: `1px solid ${item.read ? '#e8ecf1' : '#d0e0f5'}`,
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ marginTop: 2 }}>
                            {item.type === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />}
                            {item.type === 'warning' && <WarningOutlined style={{ color: '#faad14', fontSize: 16 }} />}
                            {item.type === 'info' && <InfoCircleOutlined style={{ color: PRIMARY, fontSize: 16 }} />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text strong style={{ fontSize: 13, color: item.read ? '#5a6d85' : '#1a2b45' }}>
                                {item.title}
                                {!item.read && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', marginLeft: 6, verticalAlign: 'middle' }} />}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>{item.time}</Text>
                            </div>
                            <Text style={{ fontSize: 12, color: '#5a6d85', display: 'block', marginTop: 4 }}>
                              {item.content}
                            </Text>
                          </div>
                        </div>
                      </div>
                    )}
                    locale={{ emptyText: '暂无通知消息' }}
                  />
                ),
              },
              {
                key: 'unread',
                label: `未读 (${notificationCount})`,
                children: (
                  <List
                    dataSource={notifications.filter(n => !n.read)}
                    renderItem={(item) => (
                      <div
                        onClick={() => handleNotificationClick(item.id)}
                        style={{
                          padding: '12px 16px', borderRadius: 8, marginBottom: 8,
                          cursor: 'pointer', background: '#f0f7ff', border: '1px solid #d0e0f5',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ marginTop: 2 }}>
                            {item.type === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />}
                            {item.type === 'warning' && <WarningOutlined style={{ color: '#faad14', fontSize: 16 }} />}
                            {item.type === 'info' && <InfoCircleOutlined style={{ color: PRIMARY, fontSize: 16 }} />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <Text strong style={{ fontSize: 13, color: '#1a2b45' }}>{item.title}</Text>
                            <Text style={{ fontSize: 12, color: '#5a6d85', display: 'block', marginTop: 4 }}>
                              {item.content}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>{item.time}</Text>
                          </div>
                        </div>
                      </div>
                    )}
                    locale={{ emptyText: '暂无未读消息' }}
                  />
                ),
              },
            ]}
          />
        </Drawer>

        {/* 系统设置模态框 */}
        <Modal
          title={<span><SettingOutlined style={{ marginRight: 8, color: PRIMARY }} />系统设置</span>}
          open={settingsVisible}
          onCancel={() => setSettingsVisible(false)}
          onOk={() => {
            message.success('设置已保存');
            setSettingsVisible(false);
          }}
          okText="保存设置"
          cancelText="取消"
          width={500}
        >
          <div style={{ padding: '8px 0' }}>
            <div style={{ padding: '12px 0', borderBottom: '1px solid #f0f4f8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ color: '#1a2b45' }}>消息通知</Text>
                <br /><Text type="secondary" style={{ fontSize: 12 }}>开启后接收系统推送的消息通知</Text>
              </div>
              <Badge status="processing" text="已开启" />
            </div>
            <div style={{ padding: '12px 0', borderBottom: '1px solid #f0f4f8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ color: '#1a2b45' }}>数据自动刷新</Text>
                <br /><Text type="secondary" style={{ fontSize: 12 }}>每5分钟自动刷新页面数据</Text>
              </div>
              <Badge status="processing" text="已开启" />
            </div>
            <div style={{ padding: '12px 0', borderBottom: '1px solid #f0f4f8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ color: '#1a2b45' }}>预警提醒</Text>
                <br /><Text type="secondary" style={{ fontSize: 12 }}>库存不足、交期逾期等自动预警</Text>
              </div>
              <Badge status="processing" text="已开启" />
            </div>
            <div style={{ padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ color: '#1a2b45' }}>夜间模式</Text>
                <br /><Text type="secondary" style={{ fontSize: 12 }}>18:00后自动切换深色主题</Text>
              </div>
              <Badge status="default" text="已关闭" />
            </div>
          </div>
        </Modal>

        {/* 多标签页栏 - 蓝底白字高亮 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: '#fff',
          borderBottom: '1px solid #e8ecf1',
          padding: '0 8px',
          height: 38,
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            overflowX: 'auto',
            overflowY: 'hidden',
            flex: 1,
            gap: 2,
            scrollbarWidth: 'none',
          }} className="tab-scroll-hide">
            {tabs.map(tab => (
              <div
                key={tab.key}
                onClick={() => switchTab(tab.key)}
                onContextMenu={(e) => handleTabContextMenu(e, tab.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: tab.pinned ? '4px 8px' : '4px 10px',
                  cursor: 'pointer',
                  borderRadius: '6px 6px 0 0',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  background: activeTab === tab.key ? '#1890ff' : tab.pinned ? '#f6ffed' : 'transparent',
                  color: activeTab === tab.key ? '#fff' : tab.pinned ? '#389e0d' : '#595959',
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  transition: 'all 0.2s',
                  borderBottom: activeTab === tab.key ? '2px solid transparent' : '2px solid transparent',
                }}
              >
                {tab.pinned && <span style={{ fontSize: 10, color: activeTab === tab.key ? '#fff' : '#52c41a', marginRight: 1 }}>📌</span>}
                <span>{tab.title}</span>
                {!tab.pinned && tab.key !== 'dashboard' && (
                  <CloseOutlined
                    onClick={(e) => closeTab(tab.key, e)}
                    style={{ fontSize: 10, color: activeTab === tab.key ? 'rgba(255,255,255,0.7)' : '#999', marginLeft: 2, borderRadius: '50%', padding: 1 }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* 右键菜单 */}
          {ctxMenu.visible && (
            <div style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 6px 16px rgba(0,0,0,0.12), 0 3px 6px rgba(0,0,0,0.08)',
              padding: '4px 0',
              zIndex: 9999,
              minWidth: 140,
              border: '1px solid #e8ecf1',
            }} onClick={(e) => e.stopPropagation()}>
              {(() => {
                const targetTab = tabs.find(t => t.key === ctxMenu.tabKey);
                const isPinned = targetTab?.pinned || false;
                return (
                  <>
                    {isPinned ? (
                      <div onClick={unpinTab} style={{
                        padding: '8px 16px', cursor: 'pointer', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span>📌</span> 取消固定
                      </div>
                    ) : (
                      <div onClick={pinTab} style={{
                        padding: '8px 16px', cursor: 'pointer', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span>📌</span> 固定标签
                      </div>
                    )}
                    {ctxMenu.tabKey !== 'dashboard' && !isPinned && (
                      <div onClick={() => { closeTab(ctxMenu.tabKey, { stopPropagation: () => {} } as React.MouseEvent); closeCtxMenu(); }} style={{
                        padding: '8px 16px', cursor: 'pointer', fontSize: 13, color: '#ff4d4f',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#fff1f0')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <CloseOutlined /> 关闭标签
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* 子菜单栏 - 绿底白字高亮（订单管理、商机市场等无子菜单页面隐藏） */}
        {currentModule && activeChild !== 'order-manage' && activeChild !== 'opportunity' && activeChild !== 'progress' && activeChild !== 'manage' && (
          <div style={{
            background: '#f6f9fc',
            borderBottom: `1px solid ${HEADER_BORDER}`,
            padding: '0 24px',
            height: 42,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
          }}>
            {barChildren.map((child, index) => (
              <React.Fragment key={child.key}>
                <span
                  onClick={() => handleChildClick(child.key)}
                  style={{
                    padding: '5px 14px',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: activeChild === child.key ? '#fff' : '#5a6d85',
                    background: activeChild === child.key ? '#52c41a' : 'transparent',
                    borderRadius: 4,
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    fontWeight: activeChild === child.key ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (activeChild !== child.key) {
                      (e.currentTarget as HTMLElement).style.color = '#389e0d';
                      (e.currentTarget as HTMLElement).style.background = '#f6ffed';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeChild !== child.key) {
                      (e.currentTarget as HTMLElement).style.color = '#5a6d85';
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }
                  }}
                >
                  {child.label}
                </span>
                {index < barChildren.length - 1 && (
                  <span style={{ color: '#d0d8e0', margin: '0 2px', fontSize: 12 }}>|</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* 主内容区域 - 浅蓝灰背景 */}
        <Content style={{
          margin: 0,
          padding: 8,
          background: 'linear-gradient(180deg, #f0f7ff 0%, #e8f0f9 100%)',
          overflow: activeChild ? 'hidden' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 64px - 38px)',
        }}>
          {/* PERM_V2 视角预览横幅 */}
          {previewUser && (
            <div style={{ marginBottom: 8, padding: '8px 16px', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ color: '#0958d9', fontSize: 13 }}>正在以子账号「{previewUser}」视角预览菜单与页面门控（仅影响可见性演示，不影响数据）</span>
              <Button size="small" type="link" onClick={() => setPreviewUser('')}>退出预览</Button>
            </div>
          )}
          {/* 只读模式提示横幅 */}
          {isViewOnly && (
            <div style={{
              marginBottom: 16,
              padding: '12px 20px',
              background: 'linear-gradient(90deg, #fff1f0, #fff7e6)',
              border: '1px solid #ffa39e',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <WarningOutlined style={{ fontSize: 20, color: '#ff4d4f' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: '#cf1322', fontSize: 14 }}>
                  数据保留期 · 只读模式
                </div>
                <div style={{ color: '#a8071a', fontSize: 12, marginTop: 2 }}>
                  您的试用期已结束，当前处于数据保留期（6个月），仅可查看历史数据，无法进行新增、编辑、删除等操作。
                  若需恢复使用，请联系管理员续期。
                </div>
              </div>
            </div>
          )}
          <div ref={contentRef} style={{
            minHeight: activeChild ? 0 : '100%',
            ...(activeChild ? { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } : {}),
          }}>
            {isViewOnly && (
              <div style={{
                marginBottom: 16,
                padding: '12px 20px',
                background: 'linear-gradient(90deg, #fff1f0, #fff7e6)',
                border: '1px solid #ffa39e',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <WarningOutlined style={{ fontSize: 20, color: '#ff4d4f' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#cf1322', fontSize: 14 }}>
                    数据保留期 · 只读模式
                  </div>
                  <div style={{ color: '#ad8101', fontSize: 12, marginTop: 2 }}>
                    您的试用期已结束，当前处于数据保留期（6个月），仅可查看历史数据，无法进行新增、编辑、删除等操作。
                    若需恢复使用，请联系管理员续期。
                  </div>
                </div>
              </div>
            )}
            {(() => {
              const deniedKey = menuKeyFromPath('supplier', location.pathname);
              if (deniedKey && !menuVisible('supplier', deniedKey)) {
                return <AntResult status="403" title="403" subTitle={`无权访问该页面（${deniedKey}），请联系管理员分配权限`} style={{ paddingTop: 48 }} />;
              }
              return <KeepAliveOutlet cacheKeys={tabs.map(t => t.path)} context={{ activeModule, activeChild, currentModule }} />;
            })()}
          </div>
        </Content>
      </Layout>

      {/* 服务订单弹窗 */}
      <ServiceOrdersModal open={serviceOrdersVisible} onClose={() => setServiceOrdersVisible(false)} />

      {/* 企业认证弹窗（三要素核验） */}
      <EnterpriseCertModal open={enterpriseCertVisible} onClose={() => setEnterpriseCertVisible(false)} onCertChanged={loadOwnCert} />
      <StorageCleanupModal open={cleanupModalVisible} onClose={() => setCleanupModalVisible(false)} onCleanupComplete={() => { const uname = localStorage.getItem('username') || ''; getUsageBreakdown(uname).then(b => setSpaceUsedKB(b.totalKB)); }} />

      {/* 企业信息弹窗 */}
      <Modal
        title={<span><UserOutlined style={{ marginRight: 8 }} />企业信息</span>}
        open={profileVisible}
        onCancel={() => setProfileVisible(false)}
        footer={<Button onClick={() => setProfileVisible(false)}>关闭</Button>}
        width={560}
      >
        {renderProfileContent()}
      </Modal>

      {/* 企业信息编辑弹窗 */}
      <Modal
        title={<span><EditOutlined style={{ marginRight: 8 }} />编辑企业信息</span>}
        open={editProfileVisible}
        onCancel={() => setEditProfileVisible(false)}
        onOk={handleSaveProfile}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form autoComplete="off" form={editProfileForm} layout="vertical" style={{ marginTop: 16 }}>
          {ownCertInfo?.status === 'certified' && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }}
              message="企业已通过认证，公司名称和法人代表不可修改。如需变更，请先申请变更认证。"
              action={<Button size="small" type="link" onClick={() => {
                const lock = getChangeLockMessage(ownCertInfo);
                if (lock) { message.warning(lock, 5); return; }
                setEditProfileVisible(false); setEnterpriseCertVisible(true);
              }}>申请变更认证</Button>}
            />
          )}
          <Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
            <Input placeholder="请输入公司名称" disabled={ownCertInfo?.status === 'certified'} />
          </Form.Item>
          <Form.Item name="taxpayerCode" label="纳税人识别码">
            <Input placeholder="请输入纳税人识别码" />
          </Form.Item>
          <Form.Item name="legalPerson" label="法人代表">
            <Input placeholder="请输入法人代表姓名" disabled={ownCertInfo?.status === 'certified'} />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="contactPerson" label="联系人" style={{ width: '50%', marginRight: 8 }}>
              <Input placeholder="联系人姓名" />
            </Form.Item>
            <Form.Item name="phone" label="联系电话" style={{ width: '50%' }}>
              <Input placeholder="联系电话" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="province" label="省份" style={{ width: '25%', marginRight: 4 }}>
              <Select placeholder="省份" allowClear showSearch options={getProvinceOptions()}
                onChange={() => editProfileForm.setFieldsValue({ city: undefined, district: undefined })} />
            </Form.Item>
            <Form.Item name="city" label="城市" style={{ width: '25%', marginRight: 4 }}>
              <Select placeholder="城市" allowClear showSearch options={getCityOptions(editProvince)}
                onChange={() => editProfileForm.setFieldsValue({ district: undefined })} />
            </Form.Item>
            <Form.Item name="district" label="区/县" style={{ width: '25%', marginRight: 4 }}>
              <Select placeholder="区/县" allowClear showSearch options={getDistrictOptions(editProvince, editCity)} />
            </Form.Item>
            <Form.Item name="addressDetail" label="详细地址" style={{ width: '25%' }}>
              <Input placeholder="详细地址" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="accountName" label="账户名称" style={{ width: '25%', marginRight: 4 }}>
              <Input placeholder="账户名称" />
            </Form.Item>
            <Form.Item name="bankName" label="开户银行" style={{ width: '25%', marginRight: 4 }}>
              <Input placeholder="开户银行" />
            </Form.Item>
            <Form.Item name="branchName" label="支行名称" style={{ width: '25%', marginRight: 4 }}>
              <Input placeholder="支行名称" />
            </Form.Item>
            <Form.Item name="bankAccountNo" label="银行账户" style={{ width: '25%' }}>
              <Input placeholder="银行卡号" />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="微信加好友二维码">
            <div>
              <Form.Item name="wechatQr" noStyle>
                <Input type="hidden" />
              </Form.Item>
              <div
                tabIndex={0}
                onPaste={(e) => {
                  const cd = (e as any).clipboardData as DataTransfer | undefined;
                  if (!cd) return;
                  const items = Array.from(cd.items || []);
                  for (const it of items) {
                    if (it.type.startsWith('image/')) {
                      const file = it.getAsFile();
                      if (file) {
                        compressImageFile(file).then(dataUrl => {
                          editProfileForm.setFieldsValue({ wechatQr: dataUrl });
                          setWechatQrPreview(dataUrl);
                        }).catch(() => message.error('图片处理失败'));
                      }
                      break;
                    }
                  }
                }}
                style={{ width: 100, height: 100, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12, cursor: 'pointer', overflow: 'hidden' }}
                onClick={() => document.getElementById('wechatQrUpload')?.click()}
              >
                {wechatQrPreview ? (
                  <img src={wechatQrPreview} alt="微信加好友二维码" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : '点击/粘贴'}
              </div>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                id="wechatQrUpload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  compressImageFile(file).then(dataUrl => {
                    editProfileForm.setFieldsValue({ wechatQr: dataUrl });
                    setWechatQrPreview(dataUrl);
                  }).catch(() => message.error('图片处理失败'));
                }}
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>点击上传或 Ctrl+V 粘贴</div>
            </div>
          </Form.Item>
          <Form.Item name="payBankInfo" label="收款银行账户" extra="点击输入框下拉选择银行账户（可输入检索），也可手动填写；成品市场采购商下单时展示的收款信息（开户行+户名+账号）">
            <AutoComplete
              open={bankAcctOpen}
              onDropdownVisibleChange={(v) => setBankAcctOpen(v)}
              onFocus={() => setBankAcctOpen(true)}
              onSelect={(v: string) => {
                setBankAcctOpen(false);
                // 选中银行账户后自动回填上方四个字段
                const rec = bankAcctRecords.find((b: any) => composeBankValue(b) === v);
                if (rec) {
                  editProfileForm.setFieldsValue({
                    accountName: rec.accountName || rec.name || '',
                    bankName: rec.bankName || '',
                    branchName: rec.branchName || '',
                    bankAccountNo: rec.bankAccountNo || '',
                  });
                  message.success('已按所选银行账户填充账户名称/开户银行/支行名称/银行账户');
                }
              }}
              options={bankAcctOptions}
              filterOption={(input, option) => ((option as any)?.searchText || '').includes(input.toLowerCase())}
              style={{ width: '100%' }}
            >
              <Input.TextArea rows={2} maxLength={200} placeholder="点击下拉选择银行账户，或输入户名/开户银行/账号检索" />
            </AutoComplete>
          </Form.Item>
          <Form.Item label="收款码">
            <div>
              <Form.Item name="payQrImage" noStyle>
                <Input type="hidden" />
              </Form.Item>
              <div
                tabIndex={0}
                onPaste={(e) => {
                  const cd = (e as any).clipboardData as DataTransfer | undefined;
                  if (!cd) return;
                  const items = Array.from(cd.items || []);
                  for (const it of items) {
                    if (it.type.startsWith('image/')) {
                      const file = it.getAsFile();
                      if (file) {
                        compressImageFile(file).then(dataUrl => {
                          editProfileForm.setFieldsValue({ payQrImage: dataUrl });
                          setPayQrPreview(dataUrl);
                        }).catch(() => message.error('图片处理失败'));
                      }
                      break;
                    }
                  }
                }}
                style={{ width: 100, height: 100, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12, cursor: 'pointer', overflow: 'hidden' }}
                onClick={() => document.getElementById('payQrUpload')?.click()}
              >
                {payQrPreview ? (
                  <img src={payQrPreview} alt="收款码" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : '点击/粘贴'}
              </div>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                id="payQrUpload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  compressImageFile(file).then(dataUrl => {
                    editProfileForm.setFieldsValue({ payQrImage: dataUrl });
                    setPayQrPreview(dataUrl);
                  }).catch(() => message.error('图片处理失败'));
                }}
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>点击上传或 Ctrl+V 粘贴</div>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {/* 软件订购弹窗 */}
      <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />

      {/* 强制修改密码弹窗 */}
      <Modal
        title={
          <Space>
            <LockOutlined style={{ color: '#faad14' }} />
            <span>首次登录 - 请修改密码</span>
          </Space>
        }
        open={forcePwdVisible}
        closable={false}
        maskClosable={false}
        footer={null}
        width={420}
      >
        <div style={{ marginBottom: 16, color: '#fa8c16' }}>
          为保障账号安全，首次登录请修改初始密码。
        </div>
        <Form autoComplete="off" form={forcePwdForm} layout="vertical">
          <Form.Item
            name="newPwd"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6位' },
              { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '密码必须包含字母和数字' },
            ]}
          >
            <Input.Password placeholder="请输入新密码（字母+数字）" prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item
            name="confirmPwd"
            label="确认新密码"
            dependencies={['newPwd']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPwd') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleForcePasswordChange} block>
              确认修改
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default MainLayout;
export { modules };
