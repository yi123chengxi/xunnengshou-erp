import React, { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Result, Space, Typography } from 'antd';
import { LinkOutlined, ShopOutlined } from '@ant-design/icons';
import {
  decodeInviteToken, savePendingInvite, resolveUserByCompanyNo,
} from '../utils/cooperationInvite';

const { Title, Paragraph, Text } = Typography;

/**
 * 供应商邀约合作落地页（采购商打开邀约链接）：
 * - 链接 token 自包含，仅携带公司编号（不携带公司账户）；
 * - 已登录：写入待受理邀约后跳转采购商「供应商列表」页，由列表页弹窗显示邀约公司信息并可同意合作；
 * - 未登录：展示邀约公司信息并引导登录，登录后自动进入供应商列表受理。
 */
const PurchaserInvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const payload = useMemo(() => decodeInviteToken(token || ''), [token]);
  const supplier = useMemo(() => (payload ? resolveUserByCompanyNo(payload.no) : null), [payload]);
  const logged = !!localStorage.getItem('username');

  useEffect(() => {
    if (!payload) return;
    savePendingInvite(payload);
    if (localStorage.getItem('username')) {
      navigate('/purchaser/suppliers/list', { replace: true });
    }
  }, [payload, navigate]);

  if (!payload) {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result status="warning" title="邀约链接无效" subTitle="链接可能已损坏，请联系供应商重新发送邀约链接" />
      </div>
    );
  }

  // 已登录：跳转供应商列表页受理（弹窗在该页显示）
  if (logged) return null;

  const address = supplier ? [supplier.province, supplier.city, supplier.district, supplier.addressDetail || supplier.businessAddress].filter(Boolean).join('') : '';
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1e4a7e 0%, #2d6bc4 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ width: 560, borderRadius: 12 }} bordered={false}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <ShopOutlined style={{ fontSize: 40, color: '#1890ff' }} />
            <Title level={4} style={{ marginTop: 12, marginBottom: 4 }}>供应商合作邀约</Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>以下供应商邀请您建立合作关系</Paragraph>
          </div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="公司名称">{supplier?.companyName || '（未找到对应注册账号）'}</Descriptions.Item>
            <Descriptions.Item label="公司编号">{payload.no}</Descriptions.Item>
            <Descriptions.Item label="联系人">{supplier?.contactPerson || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{supplier?.phone || '-'}</Descriptions.Item>
            {address && <Descriptions.Item label="公司地址">{address}</Descriptions.Item>}
            {payload.bind === 1 && (
              <Descriptions.Item label="合作负责人">合作建立后绑定供应商负责人「{payload.salesmanName || payload.salesman}」</Descriptions.Item>
            )}
          </Descriptions>
          <Paragraph style={{ marginBottom: 0, color: '#666', fontSize: 13 }}>
            <LinkOutlined style={{ marginRight: 6, color: '#1890ff' }} />
            请先以<Text strong>采购商账号</Text>登录，登录后将自动进入「供应商列表」页面，
            在弹窗中确认邀约公司信息后即可点击「同意合作」立即建立合作关系。
          </Paragraph>
          <Button type="primary" size="large" block onClick={() => navigate('/login')}>
            前往登录
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default PurchaserInvitePage;
