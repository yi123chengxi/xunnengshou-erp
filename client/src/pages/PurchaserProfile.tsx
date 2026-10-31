import React, { useState, useEffect } from 'react';
import {
  Card, Descriptions, Typography, Tag, Space, Spin, Avatar,
} from 'antd';
import {
  BankOutlined,
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  IdcardOutlined,
  CalendarOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const PRIMARY = '#1e4a7e';

const PurchaserProfile: React.FC = () => {
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const username = localStorage.getItem('username') || '';
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const found = registeredUsers.find((u: any) => u.username === username) || null;
    setUserInfo(found);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!userInfo) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Text type="secondary">暂无企业信息，请先完善注册信息</Text>
      </div>
    );
  }

  const getRoleText = (role: string) => {
    if (!role) return '-';
    if (role.includes('supplier') && role.includes('purchaser')) return '供应商+采购商';
    if (role.includes('supplier')) return '供应商';
    if (role.includes('purchaser')) return '采购商';
    return role;
  };

  return (
    <div>
      {/* 页面头部 */}
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`,
        color: '#fff',
        padding: '24px 28px',
        borderRadius: 12,
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}>
        <Avatar
          size={64}
          style={{ background: 'rgba(255,255,255,0.2)', flexShrink: 0 }}
          icon={<BankOutlined style={{ fontSize: 30 }} />}
        />
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            {userInfo.companyName || '未设置公司名称'}
          </Title>
          <Space style={{ marginTop: 4 }}>
            <Tag color="blue" style={{ fontSize: 12 }}>
              {userInfo.companyId || '无ID'}
            </Tag>
            <Tag color={userInfo.status === '已审核' ? 'green' : 'orange'}>
              {userInfo.status || '未知'}
            </Tag>
          </Space>
        </div>
      </div>

      {/* 基本信息卡片 */}
      <Card
        title={
          <Space>
            <IdcardOutlined style={{ color: PRIMARY }} />
            <span>基本信息</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="公司名称" span={2}>
            <Text strong>{userInfo.companyName}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="公司ID">
            <Tag color="processing">{userInfo.companyId || '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="公司编号">
            <Tag color="blue" style={{ fontWeight: 600 }}>
              {userInfo.companyNo || userInfo.companyShortName || '-'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="注册角色">
            <TeamOutlined style={{ marginRight: 6, color: PRIMARY }} />
            {getRoleText(userInfo.role)}
          </Descriptions.Item>
          <Descriptions.Item label="注册日期">
            <CalendarOutlined style={{ marginRight: 6, color: PRIMARY }} />
            {userInfo.registerDate || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 联系信息卡片 */}
      <Card
        title={
          <Space>
            <UserOutlined style={{ color: PRIMARY }} />
            <span>联系信息</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="联系人">
            <UserOutlined style={{ marginRight: 6, color: PRIMARY }} />
            {userInfo.contactPerson || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="联系电话">
            <PhoneOutlined style={{ marginRight: 6, color: PRIMARY }} />
            {userInfo.phone || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="电子邮箱" span={2}>
            <MailOutlined style={{ marginRight: 6, color: PRIMARY }} />
            {userInfo.email || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 提示信息 */}
      <div style={{
        padding: '12px 16px',
        background: '#f6f9fc',
        border: '1px solid #e8ecf1',
        borderRadius: 8,
      }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          公司ID和公司编号在注册时生成，不可修改。如需变更请联系系统管理员。
        </Text>
      </div>
    </div>
  );
};

export default PurchaserProfile;
