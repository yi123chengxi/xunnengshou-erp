import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Tag } from 'antd';
import {
  HomeOutlined, ShopOutlined, ToolOutlined, DollarOutlined,
  SettingOutlined, UserOutlined, LogoutOutlined, ProfileOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, BankOutlined, ShoppingCartOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { MenuProps } from 'antd';
import Logo from '../components/Logo';
import ServiceOrdersModal from '../components/ServiceOrdersModal';
import { useDevPermSet, isPermAllowed } from '../utils/devPerms';
import { menuVisible, menuKeyFromPath, usePermTick } from '../utils/perm';
import { Result as AntResult } from 'antd';
import AccountManage from '../pages/AccountManage';
import RoleManage from '../pages/RoleManage';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// 统一蓝色系配色（与供应商/采购商平台一致）
const PRIMARY = '#1e4a7e';
const SIDER_BG = '#1e3a5f';

// 加工厂平台菜单
const factoryMenus = [
  { key: 'dashboard', label: '加工厂首页', icon: <HomeOutlined /> },
  { key: 'production/processing-order', label: '加工订单', icon: <ToolOutlined /> },
  { key: 'cooperation', label: '合作工厂', icon: <ShopOutlined /> },
  { key: 'market/opportunity', label: '商机市场', icon: <ShopOutlined /> },
  {
    key: 'finance',
    label: '财务管理',
    icon: <DollarOutlined />,
    children: [
      { key: 'bank-account', label: '银行账户' },
      { key: 'reimbursement', label: '报销' },
      { key: 'general-ledger', label: '会计账薄' },
      { key: 'simple-ledger', label: '简易账薄' },
    ],
  },
  {
    key: 'settings',
    label: '系统设置',
    icon: <SettingOutlined />,
    children: [
      { key: 'account-manage', label: '账号管理' },
      { key: 'role-manage', label: '角色管理' },
    ],
  },
  { key: 'profile', label: '企业信息', icon: <ProfileOutlined /> },
];

const FactoryLayout: React.FC = () => {
  const navigate = useNavigate();
  // 登录守卫：未登录直接访问后台路由时回登录页（避免无会话时渲染回退身份）；
  // 响应式：他标签清除会话（storage 事件）或切回本标签（visibilitychange）时即刻跳转
  useEffect(() => {
    const check = () => { if (!localStorage.getItem('username')) window.location.replace('/login'); };
    check();
    window.addEventListener('storage', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('storage', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>(['finance', 'settings']);

  // PERM_V2 统一权限解析（响应式刷新）
  const permTick = usePermTick();

  // 当前选中菜单：/factory/xxx/yyy → xxx/yyy
  const activeMenu = useMemo(() => {
    const path = location.pathname.replace(/^\/factory\/?/, '');
    return path || 'dashboard';
  }, [location.pathname]);

  const menuItems: MenuProps['items'] = useMemo(() => {
    // PERM_V2：用户>开发者>角色 解析链（含加工厂平台页面控制，保存后实时刷新）
    const allow = (k: string) => menuVisible('factory', `factory/${k}`);
    return factoryMenus.map((menu: any) => {
      if (menu.children && menu.children.length) {
        const children = menu.children
          .filter((c: any) => allow(`${menu.key}/${c.key}`))
          .map((c: any) => ({ key: `${menu.key}/${c.key}`, label: c.label }));
        if (!children.length) return null;
        return { key: menu.key, icon: menu.icon, label: menu.label, children };
      }
      if (!allow(menu.key)) return null;
      return { key: menu.key, icon: menu.icon, label: menu.label };
    }).filter(Boolean);
  }, [permTick]);

  const onMenuClick: MenuProps['onClick'] = useCallback(({ key }: { key: string }) => {
    navigate(`/factory/${key}`);
  }, [navigate]);

  const username = localStorage.getItem('username') || '';
  const userInfo = useMemo(() => {
    try {
      const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      return users.find(u => u.username === username) || null;
    } catch { return null; }
  }, [username]);

  const [serviceOrdersVisible, setServiceOrdersVisible] = useState(false);

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{userInfo?.companyName || username}</p>
          <p style={{ margin: 0, color: '#999', fontSize: 12 }}>账号：{username}</p>
          <Tag color="green" style={{ marginTop: 4 }}>加工厂</Tag>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    { key: 'serviceOrders', icon: <ShoppingCartOutlined />, label: '服务订单' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenuClick: MenuProps['onClick'] = useCallback(({ key }: { key: string }) => {
    if (key === 'serviceOrders') {
      setServiceOrdersVisible(true);
      return;
    }
    if (key === 'logout') {
      localStorage.removeItem('username');
      localStorage.removeItem('isSubAccount');
      localStorage.removeItem('parentAccount');
      localStorage.removeItem('token'); // 同步接口鉴权令牌
      navigate('/login');
    }
  }, [navigate]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        collapsible
        collapsed={collapsed}
        trigger={null}
        style={{ background: SIDER_BG }}
      >
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#152a45' }}>
          <Logo size={32} showText={!collapsed} fontSize={16} />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeMenu]}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={keys => setOpenKeys(keys as string[])}
          items={menuItems}
          onClick={onMenuClick}
          style={{ borderRight: 0, background: 'transparent', marginTop: 8, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e8ecf1', height: 56, lineHeight: '56px' }}>
          <Space size={12}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Text strong style={{ fontSize: 16 }}>讯能手 · 加工厂平台</Text>
          </Space>
          <Space size={12}>
            <Tag color="green" style={{ marginRight: 0 }}>加工厂视图</Tag>
            <Button
              size="small"
              icon={<BankOutlined />}
              onClick={() => navigate('/')}
              onMouseEnter={() => { void import('../pages/Dashboard'); }}
              style={{
                fontWeight: 700,
                fontSize: 13,
                border: 'none',
                borderRadius: 6,
                background: 'linear-gradient(135deg, #1e4a7e 0%, #173d6b 50%, #12325a 100%)',
                color: '#fff',
                boxShadow: '0 2px 8px rgba(30, 74, 126, 0.45)',
                padding: '4px 14px',
                height: 32,
              }}
            >
              切换到供应商视图
            </Button>
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" style={{ background: '#389e0d' }} icon={<UserOutlined />} />
                <Text style={{ color: '#5a6d85' }}>
                  {userInfo?.companyName ? `${userInfo.companyName}（${userInfo.contactPerson || username}）` : username}
                </Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ background: '#eef1f5', overflow: 'auto' }}>
          {(() => {
            const deniedKey = menuKeyFromPath('factory', location.pathname);
            if (deniedKey && !menuVisible('factory', deniedKey)) {
              return <AntResult status="403" title="403" subTitle={`无权访问该页面（${deniedKey}），请联系管理员分配权限`} style={{ paddingTop: 48 }} />;
            }
            return <Outlet />;
          })()}
        </Content>
      </Layout>
      <ServiceOrdersModal open={serviceOrdersVisible} onClose={() => setServiceOrdersVisible(false)} />
    </Layout>
  );
};

export default FactoryLayout;
