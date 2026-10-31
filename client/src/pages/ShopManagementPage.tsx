import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Layout, Menu } from 'antd';
import {
  ShopOutlined, CalculatorOutlined, DollarOutlined, FileTextOutlined, ProfileOutlined,
  BarChartOutlined, TeamOutlined, TrophyOutlined, GiftOutlined, AuditOutlined, PictureOutlined,
} from '@ant-design/icons';
import ShopListPage from './ShopListPage';
import MonthEndCheckPage from './MonthEndCheckPage';
import ShopProfitPage from './ShopProfitPage';
import WithdrawalRecordPage from './WithdrawalRecordPage';
import BusinessLicensePage from './BusinessLicensePage';
import { DevStaffPaymentPage } from './dev/DevPaymentPages';
import DevGroupStatsPage from './dev/DevGroupStatsPage';
import DevActionPointsPage from './dev/DevActionPointsPage';
import DevPointsStatsPage from './dev/DevPointsStatsPage';
import DevPerformanceNewPage from './dev/DevPerformanceNewPage';
import NewStyleProgressPage from './NewStyleProgressPage';
import type { AnalyticsPlatform } from '../utils/devStore';

const { Sider, Content } = Layout;

const PRIMARY = '#1e4a7e';

type SubPageItem = { key: string; label: string; icon: React.ReactNode; component: React.FC<any> };
type SubGroupItem = { key: string; label: string; icon: React.ReactNode; children: SubPageItem[] };

const shopPages: SubPageItem[] = [
  { key: 'list', label: '店铺列表', icon: <ShopOutlined />, component: ShopListPage },
  { key: 'check', label: '月末盘点', icon: <FileTextOutlined />, component: MonthEndCheckPage },
  { key: 'profit', label: '月利润表', icon: <CalculatorOutlined />, component: ShopProfitPage },
  { key: 'withdrawal', label: '提现/充值', icon: <DollarOutlined />, component: WithdrawalRecordPage },
  { key: 'business-license', label: '营业执照列表', icon: <ProfileOutlined />, component: BusinessLicensePage },
];

const ShopManagementPage: React.FC = () => {
  const [activeKey, setActiveKey] = useState('list');

  // 检测当前平台：采购商 URL 含 /purchaser/，否则为供应商
  const platform: AnalyticsPlatform = useMemo(() => {
    return window.location.pathname.startsWith('/purchaser') ? 'purchaser' : 'supplier';
  }, []);

  // 业绩分析子页面（带 platform prop）
  const analyticsPages: SubPageItem[] = useMemo(() => [
    { key: 'analytics-payment', label: '运营统计', icon: <DollarOutlined />, component: () => <DevStaffPaymentPage platform={platform} /> },
    { key: 'analytics-group-stats', label: '分组统计', icon: <TeamOutlined />, component: () => <DevGroupStatsPage platform={platform} /> },
    { key: 'analytics-action-points', label: '积分明细', icon: <BarChartOutlined />, component: () => <DevActionPointsPage platform={platform} /> },
    { key: 'analytics-points-stats', label: '积分兑换', icon: <GiftOutlined />, component: () => <DevPointsStatsPage platform={platform} /> },
    { key: 'analytics-performance', label: '绩效考核', icon: <AuditOutlined />, component: () => <DevPerformanceNewPage platform={platform} /> },
    { key: 'analytics-newstyle', label: '新款列表', icon: <PictureOutlined />, component: () => <NewStyleProgressPage photoOnly /> },
  ], [platform]);

  // 如果 URL 中包含子页面路径，自动切换到对应标签
  useEffect(() => {
    const path = window.location.pathname;
    const allKeys = [...shopPages, ...analyticsPages];
    const match = allKeys.find(p => path.includes(`shop-management/${p.key}`));
    if (match) setActiveKey(match.key);
  }, [analyticsPages]);

  // 监听充值通知跳转事件
  useEffect(() => {
    const handler = () => setActiveKey('withdrawal');
    window.addEventListener('navigate-to-recharge', handler);
    return () => window.removeEventListener('navigate-to-recharge', handler);
  }, []);

  const handleMenuClick = useCallback(({ key }: { key: string }) => {
    setActiveKey(key);
  }, []);

  // 查找当前激活的组件
  const ActiveComponent = useMemo(() => {
    const shopMatch = shopPages.find(p => p.key === activeKey);
    if (shopMatch) return shopMatch.component;
    const analyticsMatch = analyticsPages.find(p => p.key === activeKey);
    if (analyticsMatch) return analyticsMatch.component;
    return ShopListPage;
  }, [activeKey, analyticsPages]);

  // 构建菜单项（店铺管理 + 业绩分析分组）
  const menuItems = useMemo(() => [
    ...shopPages.map(p => ({ key: p.key, icon: p.icon, label: p.label })),
    {
      key: 'analytics-group',
      icon: <TrophyOutlined />,
      label: '业绩分析',
      children: analyticsPages.map(p => ({ key: p.key, icon: p.icon, label: p.label })),
    },
  ], [analyticsPages]);

  return (
    <Layout style={{ height: 'calc(100vh - 64px)', background: 'transparent' }}>
      <Sider
        width={180}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          overflow: 'auto',
          height: '100%',
        }}
      >
        <div style={{
          padding: '16px',
          fontSize: 15,
          fontWeight: 600,
          color: PRIMARY,
          borderBottom: '1px solid #f0f0f0',
        }}>
          店铺管理
        </div>
        <style>{`
          .shop-mgmt-menu .ant-menu-item-selected {
            background: ${PRIMARY} !important;
            color: #fff !important;
          }
          .shop-mgmt-menu .ant-menu-item-selected .anticon {
            color: #fff !important;
          }
          .shop-mgmt-menu .ant-menu-item:not(.ant-menu-item-selected):hover {
            background: rgba(30, 74, 126, 0.08);
          }
          .shop-mgmt-menu .ant-menu-submenu-title:hover {
            background: rgba(30, 74, 126, 0.05) !important;
          }
        `}</style>
        <Menu
          className="shop-mgmt-menu"
          mode="inline"
          selectedKeys={[activeKey]}
          defaultOpenKeys={['analytics-group']}
          onClick={handleMenuClick}
          items={menuItems}
          style={{ border: 'none', marginTop: 4 }}
        />
      </Sider>
      <Content style={{
        overflow: 'auto',
        padding: 16,
        background: '#f5f6fa',
        height: '100%',
      }}>
        <ActiveComponent />
      </Content>
    </Layout>
  );
};

export default ShopManagementPage;
