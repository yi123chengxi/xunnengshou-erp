import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import { Layout, Menu, theme, Badge, Avatar, Dropdown, Space, Typography, Modal, message, Button, Descriptions, Tag, Progress, Popover, Form, Input, Select, Image, Row, Col, notification, Tabs, Alert } from 'antd';
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  TeamOutlined,
  SettingOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  InfoCircleOutlined,
  BankOutlined,
  DollarOutlined,
  EditOutlined,
  UploadOutlined,
  CloseOutlined,
  DatabaseOutlined,
  ShopOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import type { MenuProps } from 'antd';
import Logo from '../components/Logo';
import KeepAliveOutlet from '../components/KeepAliveOutlet';
import ServiceOrdersModal from '../components/ServiceOrdersModal';
import EnterpriseCertModal, { CertBadge, fetchCertStatus } from '../components/EnterpriseCertModal';
import type { CertInfo } from '../components/EnterpriseCertModal';
import StorageCleanupModal from '../components/StorageCleanupModal';
import { getUserQuota, getUsagePercent, formatStorageSize, getUsageBreakdown } from '../utils/storageQuota';
import { STORAGE_SUBSCRIBE_DISABLED } from '../utils/billingPolicy';
import { getProvinceOptions, getCityOptions, getDistrictOptions } from '../utils/regions';
import { safeSetItem } from '../utils/storageQuota';
import { saveDataset } from '../utils/dataStore';
import { showNativeNotification, showTimedNotification, isNotificationBlocked } from '../utils/pushNotification';
import { useDevPermSet, isPermAllowed } from '../utils/devPerms';
import { menuVisible, menuKeyFromPath, usePermTick } from '../utils/perm';
import { compressImageFile } from '../utils/imageCompress';
import { Result as AntResult } from 'antd';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// 统一的蓝色系配色（采购商使用不同的配色以区分）
const PRIMARY = '#1890ff';  // 采购商使用蓝色
const SIDER_BG = '#001529';
const SIDER_SUB_BG = '#000d1a';
const HEADER_BG = '#ffffff';
const HEADER_BORDER = '#e8ecf1';

// 采购商菜单定义（支持子菜单）
const purchaserMenus = [
  {
    key: 'dashboard',
    label: '采购商首页',
    icon: <DashboardOutlined />,
  },
  {
    key: 'orders',
    label: '订单管理',
    icon: <ShoppingCartOutlined />,
  },
  {
    key: 'ecommerce',
    label: '电商常用',
    icon: <RocketOutlined />,
    children: [
      { key: 'ecommerce/progress', label: '新款进度' },
      { key: 'ecommerce/shop-management', label: '店铺管理' },
      { key: 'market/finished', label: '成品市场' },
      { key: 'ecommerce/manage', label: '品牌管理' },
      { key: 'ecommerce/warehouse-stats', label: '仓库统计' },
    ],
  },
  {
    key: 'suppliers',
    label: '供应商',
    icon: <TeamOutlined />,
    children: [
      { key: 'list', label: '供应商列表' },
      { key: 'factory-list', label: '加工厂列表' },
      { key: 'cooperation', label: '合作申请' },
      { key: 'bill', label: '采购账单' },
    ],
  },
  {
    key: 'product-data',
    label: '商品资料',
    icon: <DatabaseOutlined />,
    children: [
      { key: 'finished-product', label: '成品' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    icon: <DollarOutlined />,
    children: [
      { key: 'bank-account', label: '银行账户' },
      { key: 'reimbursement', label: '报销' },
      { key: 'payment-request', label: '收/付申请' },
      { key: 'reconciliation', label: '对账管理' },
      { key: 'general-ledger', label: '会计账薄' },
      { key: 'simple-ledger', label: '简易账薄' },
    ],
  },
  {
    key: 'profile',
    label: '企业信息',
    icon: <FileTextOutlined />,
  },
  {
    key: 'settings',
    label: '系统设置',
    icon: <SettingOutlined />,
    children: [
      { key: 'account-manage', label: '账号管理' },
      { key: 'role-manage', label: '角色管理' },
      { key: 'expense-fee', label: '费用管理' },
      { key: 'warehouse-manage', label: '仓位管理' },
      { key: 'print-template', label: '打印模板' },
      { key: 'notification-settings', label: '弹窗设置' },
    ],
  },
];

// 非菜单路由标题映射
const EXTRA_TITLES: Record<string, string> = {
  'finance/daily-bookkeeping-stats': '记账统计分析',
  'finance/daily-bookkeeping': '日常记账',
};

// 根据菜单 key 查找标题
const getMenuTitle = (key: string): string => {
  if (EXTRA_TITLES[key]) return EXTRA_TITLES[key];
  for (const menu of purchaserMenus) {
    if (menu.key === key) return menu.label;
    if (menu.children) {
      for (const child of menu.children) {
        // 绝对键子项（如电商常用下的 newstyle/progress）直接匹配
        if (child.key === key) return child.label;
        const childKey = `${menu.key}/${child.key}`;
        if (childKey === key) return child.label;
        if ((child as any).children) {
          for (const grandChild of (child as any).children) {
            // 孙级 key 可能是完整路径（如 shop-management/list），直接拼接父级
            const gcKey = `${menu.key}/${grandChild.key}`;
            if (gcKey === key) return grandChild.label;
            // 也尝试完整拼接
            const gcKey2 = `${menu.key}/${child.key}/${grandChild.key}`;
            if (gcKey2 === key) return grandChild.label;
          }
        }
      }
    }
  }
  // 回退：取最后一段作为标题
  const parts = key.split('/');
  return parts[parts.length - 1] || key;
};

interface TabItem {
  key: string;
  title: string;
  path: string;
  pinned?: boolean;
}

// 从 localStorage 读取固定标签（完整数据）
const PINNED_STORAGE_KEY = 'purchaser_pinned_tabs';
const loadPinnedTabs = (): TabItem[] => {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) {
      const items = JSON.parse(raw);
      // 兼容旧格式（字符串数组）
      if (Array.isArray(items) && items.length > 0 && typeof items[0] === 'string') {
        return items.map((key: string) => ({ key, title: getMenuTitle(key), path: `/purchaser/${key}`, pinned: true }));
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

const PurchaserLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const allOpenKeys = ['ecommerce', 'suppliers', 'product-data', 'finance', 'settings'];
  const [openKeys, setOpenKeys] = useState<string[]>(allOpenKeys);
  const navigate = useNavigate();
  const location = useLocation();

  // 多标签页状态
  const [tabs, setTabs] = useState<TabItem[]>(() => {
    const pinnedTabs = loadPinnedTabs();
    // 确保“采购商首页”始终存在
    const hasDashboard = pinnedTabs.some(t => t.key === 'dashboard');
    const dashboardTab: TabItem = { key: 'dashboard', title: '采购商首页', path: '/purchaser/dashboard', pinned: true };
    const otherPinned = pinnedTabs.filter(t => t.key !== 'dashboard');
    return [dashboardTab, ...otherPinned];
  });
  const [activeTab, setActiveTab] = useState(() => {
    // 恢复上次激活的标签页
    try { return localStorage.getItem('purchaser_active_tab') || 'dashboard'; } catch { return 'dashboard'; }
  });

  // 持久化激活的标签页
  useEffect(() => {
    try { localStorage.setItem('purchaser_active_tab', activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  // 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; tabKey: string }>({ visible: false, x: 0, y: 0, tabKey: '' });

  // 通知相关状态
  const [notificationCount] = useState(3);
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

  // PERM_V2 统一权限解析（响应式刷新）
  const permTick = usePermTick();

  // 企业信息编辑弹窗
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editProfileForm] = Form.useForm();
  const [wechatQrPreview, setWechatQrPreview] = useState('');
  // 省市区级联选项
  const editProvince = Form.useWatch('province', editProfileForm);
  const editCity = Form.useWatch('city', editProfileForm);

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
      accountName: userInfo.accountName || '',
      bankName: userInfo.bankName || '',
      branchName: userInfo.branchName || '',
      bankAccountNo: userInfo.bankAccountNo || '',
    });
    setWechatQrPreview(userInfo.wechatQr || '');
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
      if (role.includes('supplier')) return '供应商';
      if (role.includes('purchaser')) return '采购商';
      return role;
    };

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
                  <Button type="link" size="small" icon={<EditOutlined />} style={{ marginLeft: 8, padding: 0, fontSize: 12 }} onClick={() => setEnterpriseCertVisible(true)}>申请变更认证</Button>
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
              <Descriptions.Item label="软件授权" span={2}>
                <Tag color="green">免费使用</Tag>
              </Descriptions.Item>
            </Descriptions>
          )},
          { key: 'bank', label: '银行与收款', children: (
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="账户名称">{userInfo.accountName || '-'}</Descriptions.Item>
              <Descriptions.Item label="开户银行">{userInfo.bankName || '-'}</Descriptions.Item>
              <Descriptions.Item label="支行名称">{userInfo.branchName || '-'}</Descriptions.Item>
              <Descriptions.Item label="银行账户">{userInfo.bankAccountNo ? <span style={{ fontFamily: 'monospace' }}>{userInfo.bankAccountNo}</span> : '-'}</Descriptions.Item>
              <Descriptions.Item label="微信加好友二维码" span={2}>
                {userInfo.wechatQr ? (
                  <img src={userInfo.wechatQr} alt="微信加好友二维码" style={{ maxWidth: 120, maxHeight: 120, borderRadius: 6, border: '1px solid #eee' }} />
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>
          )},
        ]} />

        {userInfo.status === '待审核' && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8 }}>
            <Text style={{ color: '#ad6800', fontSize: 13 }}>
              <InfoCircleOutlined style={{ marginRight: 8 }} />
              您的账号正在审核中，采购商平台免费使用，不受授权期限限制。
            </Text>
          </div>
        )}
      </div>
    );
  };

  // 用户菜单处理
  const handleUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    switch (key) {
      case 'profile':
        setProfileVisible(true);
        break;
      case 'settings':
        navigate('/purchaser/settings');
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
            message.success('已安全退出');
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
    { key: 'settings', icon: <SettingOutlined />, label: '账号设置' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  // 根据路由同步状态（保持所有菜单默认展开 + 同步标签页）
  React.useEffect(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2 && pathParts[0] === 'purchaser') {
      let menuKey: string;
      if (pathParts.length >= 3) {
        menuKey = pathParts.slice(1).join('/');
      } else {
        menuKey = pathParts[1] || 'dashboard';
      }
      setActiveMenu(menuKey);
      // 同步标签页
      const title = getMenuTitle(menuKey);
      const path = `/purchaser/${menuKey}`;
      setTabs(prev => {
        if (prev.some(t => t.key === menuKey)) return prev;
        return [...prev, { key: menuKey, title, path }];
      });
      setActiveTab(menuKey);
    }
  }, [location.pathname]);

  const handleOpenChange = (keys: string[]) => {
    setOpenKeys(keys);
  };

  const menuItems: MenuProps['items'] = useMemo(() => {
    // PERM_V2：用户>开发者>角色 解析链（含采购商平台页面控制，保存后实时刷新）
    const allow = (k: string) => menuVisible('purchaser', `purchaser/${k}`);
    return purchaserMenus.map(menu => {
      const buildItem = (parentKey: string, item: any): any => {
        // 子项 key 含 '/' 时为真实路由全路径（电商常用归组项），直接用作菜单键，不再拼接父键
        const key = item.key.includes('/') ? item.key : `${parentKey}/${item.key}`;
        if (item.children && item.children.length) {
          const children = item.children.map((c: any) => buildItem(parentKey, c)).filter(Boolean);
          if (!children.length) return null;
          return { key, label: item.label, children };
        }
        if (!allow(key)) return null;
        return { key, label: item.label };
      };
      const result: any = { key: menu.key, icon: menu.icon, label: menu.label };
      if (menu.children) {
        const children = menu.children.map((child: any) => buildItem(menu.key, child)).filter(Boolean);
        if (!children.length) return null;
        result.children = children;
      } else if (!allow(menu.key)) {
        return null;
      }
      return result;
    }).filter(Boolean);
  }, [permTick]);

  const onMenuClick: MenuProps['onClick'] = (info) => {
    const key = info.key;
    const title = getMenuTitle(key);
    const path = `/purchaser/${key}`;
    setActiveMenu(key);
    // 添加标签页（如果不存在）
    setTabs(prev => {
      if (prev.some(t => t.key === key)) return prev;
      const pinned = prev.filter(t => t.pinned);
      const unpinned = prev.filter(t => !t.pinned);
      return [...pinned, ...unpinned, { key, title, path, pinned: false }];
    });
    setActiveTab(key);
    navigate(path);
  };

  // 全局监听：充值通知跳转（从任何页面跳转到店铺管理 > 提现/充值）
  useEffect(() => {
    const handler = () => {
      const key = 'finance/shop-management';
      const title = '店铺管理';
      const path = `/purchaser/${key}`;
      setActiveMenu(key);
      setTabs(prev => {
        if (prev.some(t => t.key === key)) return prev;
        const pinned = prev.filter(t => t.pinned);
        const unpinned = prev.filter(t => !t.pinned);
        return [...pinned, ...unpinned, { key, title, path, pinned: false }];
      });
      setActiveTab(key);
      navigate(path);
    };
    window.addEventListener('navigate-to-recharge', handler);
    return () => window.removeEventListener('navigate-to-recharge', handler);
  }, [navigate]);

  // ===================== 全局确认支付弹窗 =====================
  const [globalPayVisible, setGlobalPayVisible] = useState(false);
  const [globalPayRecord, setGlobalPayRecord] = useState<any>(null);
  const [globalPayBankKey, setGlobalPayBankKey] = useState('');
  const [globalBankAccounts, setGlobalBankAccounts] = useState<any[]>([]);

  const getDataOwner = useCallback((): string => {
    const username = localStorage.getItem('username') || '';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || username) : username;
  }, []);

  const globalPayFmt = (v: number | undefined | null) => {
    if (v === undefined || v === null || isNaN(v)) return '—';
    return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const { recordKey } = (e as CustomEvent).detail;
      const owner = getDataOwner();
      try {
        const records = JSON.parse(localStorage.getItem(`recharge_record_${owner}`) || '[]');
        const rec = records.find((r: any) => r.key === recordKey);
        if (!rec) { message.warning('未找到该充值记录'); return; }
        setGlobalPayRecord(rec);
        setGlobalPayBankKey('');
        const bankData = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${owner}`) || '[]');
        setGlobalBankAccounts(bankData.filter((b: any) => b.status !== 'disabled' || !b.status));
        setGlobalPayVisible(true);
      } catch { message.error('加载充值记录失败'); }
    };
    window.addEventListener('show-recharge-pay', handler);
    return () => window.removeEventListener('show-recharge-pay', handler);
  }, [getDataOwner]);

  // ===================== 全局通知恢复：任何页面加载时自动恢复待处理通知（系统级） =====================
  // 待审核通知：持续显示，用户关闭后定期重新弹出
  // 被驳回通知：点击关闭
  // 已支付通知：5秒自动关闭
  useEffect(() => {
    const owner = getDataOwner();
    const currentUser = localStorage.getItem('username') || '';
    if (!owner || !currentUser) return;

    const showNotifications = () => {
      try {
        const records: any[] = JSON.parse(localStorage.getItem(`recharge_record_${owner}`) || '[]');
        if (records.length === 0) return;
        // 已显示过的通知记录（避免重复）
        const paidShownKey = `rech_paid_shown_${owner}`;
        const rejectedShownKey = `rech_rejected_shown_${owner}`;
        const paidShown: string[] = JSON.parse(localStorage.getItem(paidShownKey) || '[]');
        const rejectedShown: string[] = JSON.parse(localStorage.getItem(rejectedShownKey) || '[]');
        const newPaidShown = [...paidShown];
        const newRejectedShown = [...rejectedShown];

        records.forEach((r: any) => {
          const amountStr = `¥${(r.amount || 0).toFixed(2)}`;

          // 财务负责人视角：待审核记录 → 持续通知（关闭后定期重新弹出）
          if (r.status === 'pending' && r.financePerson === currentUser) {
            if (!isNotificationBlocked(currentUser)) {
              showNativeNotification(
                '【充值审批】' + (r.shopName || ''),
                `${r.shopName} 申请充值 ${amountStr}，请点击处理`,
                () => window.dispatchEvent(new CustomEvent('show-recharge-pay', { detail: { recordKey: r.key } })),
                `rech-pending-${r.key}`
              );
            }
          }

          // 申请人视角：被驳回记录 → 仅首次弹出一次（不随间隔重复）
          if (r.status === 'rejected' && r.applicant === currentUser && !rejectedShown.includes(r.key)) {
            if (!isNotificationBlocked(currentUser)) {
              showNativeNotification(
                '【充值被驳回】' + (r.shopName || ''),
                `${r.shopName} 充值申请已被驳回，原因：${r.rejectReason || '未说明'}`,
                () => { sessionStorage.setItem('navigate_recharge_tab', '1'); window.dispatchEvent(new CustomEvent('navigate-to-recharge')); },
                `rech-rejected-${r.key}`
              );
            }
            newRejectedShown.push(r.key);
          }

          // 申请人视角：已支付记录 → 5秒自动关闭（仅首次显示）
          if (r.status === 'paid' && r.applicant === currentUser && !paidShown.includes(r.key)) {
            if (!isNotificationBlocked(currentUser)) {
              showTimedNotification(
                '【充值已支付】' + (r.shopName || ''),
                `${r.shopName} 充值 ${amountStr} 已由财务确认支付`,
                5000,
                `rech-paid-${r.key}`
              );
            }
            newPaidShown.push(r.key);
          }
        });

        // 保存已显示记录（避免重复弹出）
        if (newPaidShown.length > paidShown.length) {
          localStorage.setItem(paidShownKey, JSON.stringify(newPaidShown));
        }
        if (newRejectedShown.length > rejectedShown.length) {
          localStorage.setItem(rejectedShownKey, JSON.stringify(newRejectedShown));
        }
      } catch {}
    };

    // 首次延迟 800ms 后显示
    const initTimer = setTimeout(showNotifications, 800);
    // 每 30 秒重新检查待审核记录并重新弹出（用户关闭后自动恢复）
    const interval = setInterval(showNotifications, 30000);
    return () => { clearTimeout(initTimer); clearInterval(interval); };
  }, [getDataOwner]);

  const handleGlobalConfirmPay = () => {
    if (!globalPayRecord) return;
    if (!globalPayBankKey) { message.warning('请选择付款银行账户'); return; }
    const owner = getDataOwner();
    const bank = globalBankAccounts.find((b: any) => b.key === globalPayBankKey);
    // 写入银行支出明细
    try {
      const bankStorageKey = `pageData_finance_bank-account_${owner}`;
      const accounts: any[] = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
      const acc = accounts.find((a: any) => a.key === globalPayBankKey);
      if (!acc) { message.error('银行账户数据中未找到该账户'); return; }
      const txns = Array.isArray(acc.transactions) ? acc.transactions : [];
      const prevBalance = Number(acc.balance) || 0;
      txns.push({
        key: `txn-rech-${Date.now()}`,
        time: new Date().toLocaleString('zh-CN'),
        type: 'out',
        amount: globalPayRecord.amount,
        balanceAfter: prevBalance - globalPayRecord.amount,
        counterparty: globalPayRecord.shopName,
        orderNo: '', orderId: '',
        person: localStorage.getItem('username') || 'admin',
        remark: `充值支出 — ${globalPayRecord.shopName} ${globalPayFmt(globalPayRecord.amount)}`,
      });
      acc.transactions = txns;
      acc.balance = prevBalance - globalPayRecord.amount;
      const json = JSON.stringify(accounts);
      safeSetItem(bankStorageKey, json);
      saveDataset(bankStorageKey, json);
      safeSetItem(`${bankStorageKey}_ts`, String(Date.now()));
    } catch (err) {
      message.error('写入银行流水失败：' + (err as Error).message);
      return;
    }
    // 更新充值记录状态
    try {
      const rechKey = `recharge_record_${owner}`;
      const records: any[] = JSON.parse(localStorage.getItem(rechKey) || '[]');
      const updated = records.map((r: any) => r.key === globalPayRecord.key ? {
        ...r, status: 'paid', operator: localStorage.getItem('username') || '',
        accountName: bank?.name || '', bankName: `${bank?.bankName}${bank?.branchName ? '(' + bank.branchName + ')' : ''}`,
        bankAccountNo: bank?.bankAccountNo || '', paidAt: dayjs().format('YYYY-MM-DD HH:mm:ss'), updatedAt: new Date().toLocaleString('zh-CN'),
      } : r);
      const jsonStr = JSON.stringify(updated);
      safeSetItem(rechKey, jsonStr);
      safeSetItem(`${rechKey}_ts`, String(Date.now()));
      saveDataset(rechKey, jsonStr);
      // 触发充值记录页面刷新
      window.dispatchEvent(new CustomEvent('recharge-record-updated'));
    } catch {}
    setGlobalPayVisible(false);
    notification.destroy(`rech-notify-${globalPayRecord.key}`);
    // 通知申请人“已支付”（5秒自动关闭，已屏蔽则跳过）
    if (globalPayRecord.applicant && !isNotificationBlocked(globalPayRecord.applicant)) {
      showTimedNotification(
        '【充值已支付】' + (globalPayRecord.shopName || ''),
        `${globalPayRecord.shopName} 充值 ${globalPayFmt(globalPayRecord.amount)} 已由财务确认支付`,
        5000,
        `rech-paid-${globalPayRecord.key}`
      );
    }
    message.success(`已确认支付 ${globalPayFmt(globalPayRecord.amount)}，银行支出明细已记录`);
    setGlobalPayRecord(null);
  };

  const globalBankOptions = globalBankAccounts.map((b: any) => {
    const last4 = b.bankAccountNo ? '****' + String(b.bankAccountNo).slice(-4) : '';
    const branch = b.branchName ? `（${b.branchName}）` : '';
    return { value: b.key, label: `${b.name} - ${b.bankName}${branch} ${last4}` };
  });

  // 切换标签页
  const switchTab = (key: string) => {
    const tab = tabs.find(t => t.key === key);
    if (!tab) return;
    setActiveTab(key);
    setActiveMenu(key);
    navigate(tab.path);
  };

  // 关闭标签页
  const closeTab = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (key === 'dashboard') return; // 首页不可关闭
    const tab = tabs.find(t => t.key === key);
    if (tab?.pinned) return; // 固定标签不可关闭
    setTabs(prev => {
      const idx = prev.findIndex(t => t.key === key);
      const next = prev.filter(t => t.key !== key);
      if (activeTab === key && next.length > 0) {
        // 关闭当前标签，切换到相邻标签
        const newIdx = Math.min(idx, next.length - 1);
        const newTab = next[newIdx];
        setActiveTab(newTab.key);
        setActiveMenu(newTab.key);
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
      // 固定标签移到前面
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

  // 点击其他地方关闭右键菜单
  React.useEffect(() => {
    if (ctxMenu.visible) {
      const handler = () => closeCtxMenu();
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [ctxMenu.visible]);

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* 左侧菜单导航 */}
      <Sider
        className="purchaser-layout-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        style={{ background: SIDER_BG, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        width={220}
      >
        {/* Logo */}
        <div style={{
          height: 64,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          {collapsed ? (
            <Logo size={32} showText={false} />
          ) : (
            <Logo size={32} showText={true} textColor="#fff" fontSize={16} />
          )}
        </div>

        {/* 菜单 */}
        <style>{`
          .purchaser-layout-sider > .ant-layout-sider-children {
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
          }
          .purchaser-sider-menu > .ant-menu-submenu > .ant-menu-sub {
            display: flex;
            flex-wrap: wrap;
          }
          .purchaser-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-item {
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
          .purchaser-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-submenu {
            width: 50%;
            min-width: 0;
            padding-left: 0 !important;
            box-sizing: border-box;
          }
          .purchaser-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-submenu > .ant-menu-submenu-title {
            padding-left: 12px !important;
            padding-right: 4px !important;
            margin: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .purchaser-sider-menu > .ant-menu-submenu > .ant-menu-sub > .ant-menu-submenu > .ant-menu-sub .ant-menu-item {
            padding-left: 24px !important;
          }
          /* 标签栏滚动条隐藏 */
          .tab-scroll-hide::-webkit-scrollbar { display: none; }
          .tab-scroll-hide { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>
        <Menu
          className="purchaser-sider-menu"
          theme="dark"
          mode="inline"
          selectedKeys={[activeMenu]}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={handleOpenChange}
          items={menuItems}
          onClick={onMenuClick}
          style={{ borderRight: 0, background: 'transparent', marginTop: 8, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        />
      </Sider>

      {/* 右侧主体 */}
      <Layout>
        {/* 顶部导航 */}
        <Header style={{
          background: HEADER_BG,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${HEADER_BORDER}`,
          height: 64,
          lineHeight: '64px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 18, cursor: 'pointer', color: '#8b9db5' }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a2b45' }}>
              讯能手 · 采购商平台
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* 采购商平台免费使用，不显示到期时间 */}
            <Tag color="green" style={{ fontWeight: 600 }}>免费使用</Tag>
            
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
                      strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : '#1890ff'}
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
                    onClick={() => navigate('/purchaser/storage-pricing')}
                    title={STORAGE_SUBSCRIBE_DISABLED ? '暂不支持订购：默认 2G 空间，企业认证通过可领取 10G 永久空间' : undefined}
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
                    onClick={() => navigate('/purchaser/storage-pricing')}
                  >
                    <Progress
                      type="circle"
                      percent={percent}
                      size={22}
                      showInfo={false}
                      strokeColor={percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : '#1890ff'}
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
              <BellOutlined style={{ fontSize: 18, cursor: 'pointer', color: '#8b9db5' }} />
            </Badge>
            
            {/* 角色切换按钮 - 所有人可见，切换到供应商视图体验供应商功能 */}
            <Button
              size="small"
              icon={<BankOutlined />}
              onClick={() => navigate('/dashboard')}
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
              切换到供应商视图
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
                  {(() => { const info = getUserInfo(); return info?.companyName ? `${info.companyName}（${info.contactPerson || ''}）` : localStorage.getItem('username') || '采购商'; })()}
                </Text>
              </Space>
            </Dropdown>
          </div>
        </Header>

        {/* 多标签页导航栏 */}
        {tabs.length > 0 && (
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
                    background: activeTab === tab.key ? '#e6f7ff' : tab.pinned ? '#f6ffed' : 'transparent',
                    color: activeTab === tab.key ? PRIMARY : tab.pinned ? '#389e0d' : '#595959',
                    fontWeight: activeTab === tab.key ? 600 : 400,
                    transition: 'all 0.2s',
                    ...(tab.pinned ? { border: '1px solid #b7eb8f', borderBottom: activeTab === tab.key ? `2px solid ${PRIMARY}` : '1px solid #b7eb8f' } : { borderBottom: activeTab === tab.key ? `2px solid ${PRIMARY}` : '2px solid transparent' }),
                  }}
                >
                  {tab.pinned && <span style={{ fontSize: 10, color: '#52c41a', marginRight: 1 }}>📌</span>}
                  <span>{tab.title}</span>
                  {!tab.pinned && tab.key !== 'dashboard' && (
                    <CloseOutlined
                      onClick={(e) => closeTab(tab.key, e)}
                      style={{ fontSize: 10, color: '#999', marginLeft: 2, borderRadius: '50%', padding: 1 }}
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
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* 主内容区域 */}
        <Content style={{
          margin: 0,
          padding: 8,
          background: '#f0f2f5',
          height: 'calc(100vh - 102px)',
          overflow: 'auto',
        }}>
          <div style={{ minHeight: '100%' }}>
            {(() => {
              const deniedKey = menuKeyFromPath('purchaser', location.pathname);
              if (deniedKey && !menuVisible('purchaser', deniedKey)) {
                return <AntResult status="403" title="403" subTitle={`无权访问该页面（${deniedKey}），请联系管理员分配权限`} style={{ paddingTop: 48 }} />;
              }
              return <KeepAliveOutlet cacheKeys={tabs.map(t => t.path)} />;
            })()}
          </div>
        </Content>
      </Layout>

      {/* 服务订单弹窗 */}
      <ServiceOrdersModal open={serviceOrdersVisible} onClose={() => setServiceOrdersVisible(false)} />

      {/* 企业认证弹窗（三要素核验） */}
      <EnterpriseCertModal open={enterpriseCertVisible} onClose={() => setEnterpriseCertVisible(false)} onCertChanged={loadOwnCert} />
      <StorageCleanupModal open={cleanupModalVisible} onClose={() => setCleanupModalVisible(false)} onCleanupComplete={() => { const uname = localStorage.getItem('username') || ''; getUsageBreakdown(uname).then(b => setSpaceUsedKB(b.totalKB)); }} />

      {/* 个人中心弹窗 */}
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
              action={<Button size="small" type="link" onClick={() => { setEditProfileVisible(false); setEnterpriseCertVisible(true); }}>申请变更认证</Button>}
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
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="accountName" label="账户名称">
                <Input placeholder="收款账户名称（公司名/姓名）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankName" label="开户银行">
                <Input placeholder="如：中国工商银行" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branchName" label="支行名称">
                <Input placeholder="如：城东支行" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bankAccountNo" label="银行账户">
                <Input placeholder="银行卡号" />
              </Form.Item>
            </Col>
          </Row>
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
                onClick={() => document.getElementById('wechatQrUploadPurchaser')?.click()}
              >
                {wechatQrPreview ? (
                  <img src={wechatQrPreview} alt="微信加好友二维码" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : '点击/粘贴'}
              </div>
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                id="wechatQrUploadPurchaser"
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
        </Form>
      </Modal>

      {/* ============ 全局确认支付弹窗 ============ */}
      <Modal title={globalPayRecord?.status === 'paid' ? '充值详情' : '确认支付'} open={globalPayVisible} onCancel={() => { setGlobalPayVisible(false); setGlobalPayRecord(null); }} footer={null} width={500}>
        {globalPayRecord && (() => {
          const isPaid = globalPayRecord.status === 'paid';
          return (
          <div style={{ padding: '8px 0' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="店铺名称">{globalPayRecord.shopName}</Descriptions.Item>
              <Descriptions.Item label="充值金额"><Text strong style={{ color: PRIMARY }}>{globalPayFmt(globalPayRecord.amount)}</Text></Descriptions.Item>
              <Descriptions.Item label="店铺编码">{globalPayRecord.shopCode}</Descriptions.Item>
              <Descriptions.Item label="所属平台">{globalPayRecord.platform || '—'}</Descriptions.Item>
              <Descriptions.Item label="申请人">{globalPayRecord.applicant}</Descriptions.Item>
              <Descriptions.Item label="申请时间">{globalPayRecord.createdAt}</Descriptions.Item>
              {isPaid && (
                <>
                  <Descriptions.Item label="状态"><Tag color="success">已支付</Tag></Descriptions.Item>
                  <Descriptions.Item label="充值日期">{globalPayRecord.paidAt || '—'}</Descriptions.Item>
                  <Descriptions.Item label="操作人">{globalPayRecord.operator || '—'}</Descriptions.Item>
                  <Descriptions.Item label="付款银行">{globalPayRecord.bankName || '—'}</Descriptions.Item>
                  {globalPayRecord.bankAccountNo && (
                    <Descriptions.Item label="银行账号" span={2}>{globalPayRecord.bankAccountNo}</Descriptions.Item>
                  )}
                </>
              )}
            </Descriptions>
            {!isPaid && globalPayRecord.qrcode && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>充值二维码</Text>
                <Image src={globalPayRecord.qrcode} width={200} style={{ borderRadius: 8 }} />
              </div>
            )}
            {!isPaid && (
              <div style={{ marginTop: 16 }}>
                <Text style={{ display: 'block', marginBottom: 4 }}>选择付款银行账户 <Text type="danger">*</Text></Text>
                <Select value={globalPayBankKey || undefined} onChange={v => setGlobalPayBankKey(v)} style={{ width: '100%' }}
                  options={globalBankOptions} placeholder="选择银行账户" showSearch
                  filterOption={(input, option) => (option?.label || '').toLowerCase().includes(input.toLowerCase())} />
              </div>
            )}
            <Row justify="end" style={{ marginTop: 16 }}>
              <Space>
                <Button onClick={() => { setGlobalPayVisible(false); setGlobalPayRecord(null); }}>{isPaid ? '关闭' : '取消'}</Button>
                {!isPaid && <Button type="primary" onClick={handleGlobalConfirmPay}>已支付</Button>}
              </Space>
            </Row>
          </div>
          );
        })()}
      </Modal>
    </Layout>
  );
};

export default PurchaserLayout;
