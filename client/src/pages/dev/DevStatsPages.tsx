import React, { useState, useEffect, useMemo } from 'react';
import { Card, Table, Tag, Typography, Row, Col, Statistic } from 'antd';
import { TeamOutlined, UserOutlined, UserAddOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getDevIdentity, loadGroups, loadDevSubAccounts, loadGroupPerms, loadCustomerPerms } from '../../utils/devStore';

const { Text } = Typography;

const loadMainCustomers = (): any[] => {
  try {
    const list = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return Array.isArray(list) ? list.filter((u: any) => !u.isSubAccount) : [];
  } catch { return []; }
};

// 开发者后台 - 客户管理 - 数据统计
export const DevCustomerStats: React.FC = () => {
  const identity = getDevIdentity();
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick(t => t + 1); }, []);
  const customers = useMemo(() => loadMainCustomers(), [tick]);
  const groups = useMemo(() => loadGroups(identity.parent), [identity.parent, tick]);

  const claimed = customers.filter(c => c.devOwner);
  const groupRows = useMemo(() => groups.map(g => ({
    key: g.id,
    name: g.name,
    memberCount: g.members.length,
    claimedCount: g.members.filter(m => customers.find(c => c.username === m)?.devOwner).length,
    approvedCount: g.members.filter(m => customers.find(c => c.username === m)?.status === '已审核').length,
    permCount: (loadGroupPerms(g.id) || []).length,
  })), [groups, customers]);

  const roleRows = useMemo(() => {
    const map: Record<string, number> = {};
    customers.forEach(c => {
      const t = c.role.includes('supplier') && c.role.includes('purchaser') ? '供应商+采购商' : c.role.includes('supplier') ? '供应商' : c.role.includes('purchaser') ? '采购商' : c.role.includes('factory') ? '加工厂' : c.role;
      map[t] = (map[t] || 0) + 1;
    });
    return Object.entries(map).map(([k, v], i) => ({ key: String(i), role: k, count: v }));
  }, [customers]);

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="总客户数" value={customers.length} prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="已审核" value={customers.filter(c => c.status === '已审核').length} valueStyle={{ color: '#52c41a' }} prefix={<UserOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="已领取" value={claimed.length} valueStyle={{ color: '#722ed1' }} prefix={<UserAddOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="公海未领取" value={customers.length - claimed.length} valueStyle={{ color: '#faad14' }} prefix={<InboxOutlined />} /></Card></Col>
      </Row>
      <Card title="客户分组分布" size="small" style={{ marginBottom: 16 }}>
        <Table rowKey="key" bordered size="middle" dataSource={groupRows} pagination={false}
          columns={[
            { title: '分组名称', dataIndex: 'name', align: 'center' },
            { title: '成员客户数', dataIndex: 'memberCount', align: 'center' },
            { title: '已领取成员', dataIndex: 'claimedCount', align: 'center' },
            { title: '已审核成员', dataIndex: 'approvedCount', align: 'center' },
            { title: '分组权限菜单数', dataIndex: 'permCount', align: 'center', render: (v: number) => v ? <Tag color="blue">{v}</Tag> : <Tag>默认全部</Tag> },
          ]}
          locale={{ emptyText: '暂无分组' }} />
      </Card>
      <Card title="客户角色分布" size="small">
        <Table rowKey="key" bordered size="middle" dataSource={roleRows} pagination={false}
          columns={[
            { title: '角色', dataIndex: 'role', align: 'center' },
            { title: '客户数', dataIndex: 'count', align: 'center' },
          ]} />
      </Card>
    </div>
  );
};

// 开发者后台 - 业绩分析（绩效考核 / 分组统计）
const DevPerformancePage: React.FC<{ type: 'performance' | 'group' }> = ({ type }) => {
  const identity = getDevIdentity();
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick(t => t + 1); }, []);
  const customers = useMemo(() => loadMainCustomers(), [tick]);
  const subs = useMemo(() => loadDevSubAccounts().filter(s => s.parentDev === identity.parent), [identity.parent, tick]);
  const groups = useMemo(() => loadGroups(identity.parent), [identity.parent, tick]);

  // 业务员业绩：主开发者 + 各子账号
  const perfRows = useMemo(() => {
    const owners = [
      { user: 'dev', name: '主开发者' },
      ...subs.map(s => ({ user: s.username, name: s.displayName })),
    ];
    return owners.map(o => {
      const mine = customers.filter(c => c.devOwner === o.user);
      return {
        key: o.user,
        name: o.name,
        username: o.user,
        claimed: mine.length,
        newThisMonth: mine.filter(c => (c.devClaimDate || '').startsWith(dayjs().format('YYYY-MM'))).length,
        approved: mine.filter(c => c.status === '已审核').length,
        pending: mine.filter(c => c.status === '待审核').length,
        customPermCustomers: mine.filter(c => loadCustomerPerms(c.username) !== null).length,
      };
    });
  }, [customers, subs]);

  const groupRows = useMemo(() => groups.map(g => ({
    key: g.id,
    name: g.name,
    memberCount: g.members.length,
    claimedCount: g.members.filter(m => customers.find(c => c.username === m)?.devOwner).length,
    approvedCount: g.members.filter(m => customers.find(c => c.username === m)?.status === '已审核').length,
    permCount: (loadGroupPerms(g.id) || []).length,
  })), [groups, customers]);

  if (type === 'group') {
    return (
      <div style={{ padding: 16 }}>
        <Card title="分组统计" size="small">
          <Table rowKey="key" bordered size="middle" dataSource={groupRows} pagination={false}
            columns={[
              { title: '分组名称', dataIndex: 'name', align: 'center' },
              { title: '成员客户数', dataIndex: 'memberCount', align: 'center' },
              { title: '已领取成员', dataIndex: 'claimedCount', align: 'center' },
              { title: '已审核成员', dataIndex: 'approvedCount', align: 'center' },
              { title: '分组权限菜单数', dataIndex: 'permCount', align: 'center', render: (v: number) => v ? <Tag color="blue">{v}</Tag> : <Tag>默认全部</Tag> },
            ]}
            locale={{ emptyText: '暂无分组，请在客户管理列表左侧创建' }} />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Card title="绩效考核 - 开发者业务员" size="small">
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          按领取归属统计各业务员（开发者子账号）的客户业绩：领取客户数、本月新领取、已审核客户等。
        </Text>
        <Table rowKey="key" bordered size="middle" dataSource={perfRows} pagination={false}
          columns={[
            { title: '业务员', dataIndex: 'name', align: 'center', render: (v: string) => <Text strong>{v}</Text> },
            { title: '登录账号', dataIndex: 'username', align: 'center' },
            { title: '领取客户数', dataIndex: 'claimed', align: 'center' },
            { title: '本月新领取', dataIndex: 'newThisMonth', align: 'center', render: (v: number) => v ? <Tag color="green">{v}</Tag> : '0' },
            { title: '已审核客户', dataIndex: 'approved', align: 'center' },
            { title: '待审核客户', dataIndex: 'pending', align: 'center' },
            { title: '单独设置权限客户', dataIndex: 'customPermCustomers', align: 'center' },
          ]} />
      </Card>
    </div>
  );
};

export default DevPerformancePage;
