import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Button, Tag } from 'antd';
import {
  TeamOutlined, BarChartOutlined, SettingOutlined, UserOutlined, LogoutOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, FundOutlined, UsergroupAddOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { MenuProps } from 'antd';
import Logo from '../components/Logo';
import { getDevIdentity, getSubRole } from '../utils/devStore';
import { menuVisible, menuKeyFromPath, usePermTick } from '../utils/perm';
import { Result as AntResult } from 'antd';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const PRIMARY = '#1e4a7e';
const SIDER_BG = '#1e3a5f';

// 开发者后台菜单：客户管理 / 业绩分析 / 系统设置（参考 my-crm 三大模块）
const devMenus = [
  {
    key: 'customers',
    label: '客户管理',
    icon: <TeamOutlined />,
    children: [
      { key: 'mine', label: '我的客户' },
      { key: 'all', label: '全部客户' },
      { key: 'orders', label: '订单管理' },
      { key: 'pool', label: '客户公海' },
      { key: 'stats', label: '数据统计' },
    ],
  },
  {
    key: 'analytics',
    label: '业绩分析',
    icon: <BarChartOutlined />,
    children: [
      { key: 'payment', label: '客户付款' },
      { key: 'group-stats', label: '分组统计' },
      { key: 'action-points', label: '积分明细' },
      { key: 'points-stats', label: '积分兑换' },
      { key: 'performance', label: '绩效考核' },
    ],
  },
  {
    key: 'settings',
    label: '系统设置',
    icon: <SettingOutlined />,
    children: [
      { key: 'accounts', label: '账号管理' },
      { key: 'roles', label: '角色权限' },
      { key: 'points', label: '积分兑换奖品' },
      { key: 'feedback', label: '意见反馈' },
      { key: 'integration', label: '接口配置' },
    ],
  },
];

const DevLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>(['customers', 'analytics', 'settings']);

  // 登录守卫
  useEffect(() => {
    if (localStorage.getItem('devLoggedIn') !== 'true') navigate('/xunnengs/entry-7x2qf9');
  }, [navigate]);

  const identity = useMemo(() => getDevIdentity(), []);
  // PERM_V2：开发者后台子账号菜单门控（主开发者全部可见）
  const permTick = usePermTick();

  const visibleMenus = useMemo(() => devMenus.map(menu => ({
    ...menu,
    children: menu.children.filter(c => menuVisible('dev', `dev/${menu.key}/${c.key}`)),
  })).filter(m => m.children.length > 0), [permTick]);

  const activeMenu = useMemo(() => {
    const path = location.pathname.replace(/^\/xunnengs\/?/, '');
    return path || 'customers/all';
  }, [location.pathname]);

  const menuItems: MenuProps['items'] = useMemo(() => visibleMenus.map(menu => ({
    key: menu.key,
    icon: menu.icon,
    label: menu.label,
    children: menu.children.map(c => ({ key: `${menu.key}/${c.key}`, label: c.label })),
  })), [visibleMenus]);

  const onMenuClick: MenuProps['onClick'] = useCallback(({ key }: { key: string }) => {
    navigate(`/xunnengs/${key}`);
  }, [navigate]);

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{identity.name}</p>
          <p style={{ margin: 0, color: '#999', fontSize: 12 }}>账号：{identity.user}</p>
          <Tag color="purple" style={{ marginTop: 4 }}>{identity.isSub ? '开发者子账号' : '主开发者'}</Tag>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出开发者后台', danger: true },
  ];

  const handleUserMenuClick: MenuProps['onClick'] = useCallback(({ key }: { key: string }) => {
    if (key === 'logout') {
      localStorage.removeItem('devLoggedIn');
      localStorage.removeItem('devUser');
      localStorage.removeItem('devUserName');
      localStorage.removeItem('devIsSub');
      localStorage.removeItem('devParent');
      navigate('/xunnengs/entry-7x2qf9');
    }
  }, [navigate]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} collapsible collapsed={collapsed} trigger={null} style={{ background: SIDER_BG }}>
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
            <Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
            <Text strong style={{ fontSize: 16 }}>讯能手 · 开发者后台</Text>
          </Space>
          <Space size={12}>
            <Tag color="purple" style={{ marginRight: 0 }}><UsergroupAddOutlined style={{ marginRight: 4 }} />{identity.isSub ? '开发者子账号' : '主开发者'}</Tag>
            <Button
              size="small"
              icon={<FundOutlined />}
              onClick={() => { localStorage.removeItem('devLoggedIn'); navigate('/login'); }}
              style={{
                fontWeight: 700, fontSize: 13, border: 'none', borderRadius: 6,
                background: 'linear-gradient(135deg, #1e4a7e 0%, #173d6b 50%, #12325a 100%)',
                color: '#fff', boxShadow: '0 2px 8px rgba(30, 74, 126, 0.45)', padding: '4px 14px', height: 32,
              }}
            >
              切换到用户登录
            </Button>
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" style={{ background: '#722ed1' }} icon={<UserOutlined />} />
                <Text style={{ color: '#5a6d85' }}>{identity.name}</Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ background: '#eef1f5', overflow: 'auto' }}>
          {(() => {
            const deniedKey = menuKeyFromPath('dev', location.pathname);
            if (deniedKey && !menuVisible('dev', deniedKey)) {
              return <AntResult status="403" title="403" subTitle={`无权访问该页面（${deniedKey}），请联系主开发者分配权限`} style={{ paddingTop: 48 }} />;
            }
            return <Outlet />;
          })()}
        </Content>
      </Layout>
    </Layout>
  );
};

export default DevLayout;
