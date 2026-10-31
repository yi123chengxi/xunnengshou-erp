import React, { useState, useEffect } from 'react';
import { Modal, Card, Row, Col, Typography, Button, message, Tag, Descriptions, Space } from 'antd';
import {
  CrownOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { SUBSCRIBE_DISABLED, FREE_PERIOD } from '../utils/billingPolicy';

const { Text, Title } = Typography;

interface SubscriptionOption {
  key: string;
  name: string;
  months: number;
  price: number;
  originalPrice: number;
  popular?: boolean;
  color?: string;
}

export const SUBSCRIPTION_OPTIONS: SubscriptionOption[] = [
  {
    key: '1m',
    name: '月度套餐',
    months: 1,
    price: 99,
    originalPrice: 99,
    color: '#1890ff',
  },
  {
    key: '3m',
    name: '季度套餐',
    months: 3,
    price: 249,
    originalPrice: 297,
    popular: true,
    color: '#faad14',
  },
  {
    key: '1y',
    name: '年度套餐',
    months: 12,
    price: 799,
    originalPrice: 1188,
    color: '#722ed1',
  },
];

export interface SubscriptionOrder {
  id: string;
  username: string;
  planName: string;
  months: number;
  price: number;
  orderTime: string;
  activatedUntil: string;
}

function loadSubscriptionOrders(): SubscriptionOrder[] {
  try {
    return JSON.parse(localStorage.getItem('subscription_orders') || '[]');
  } catch {
    return [];
  }
}

function saveSubscriptionOrders(orders: SubscriptionOrder[]) {
  localStorage.setItem('subscription_orders', JSON.stringify(orders));
}

interface SubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ open, onClose, onSuccess }) => {
  const username = localStorage.getItem('username') || '';
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionOption | null>(null);
  const [currentInfo, setCurrentInfo] = useState<{ authorizedUntil: string; status: string }>({
    authorizedUntil: '',
    status: '',
  });

  useEffect(() => {
    if (open) {
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const user = users.find((u: any) => u.username === username);
      setCurrentInfo({
        authorizedUntil: user?.authorizedUntil || '',
        status: user?.status || '',
      });
      setSelectedPlan(null);
      setConfirming(false);
    }
  }, [open, username]);

  const isExpired = currentInfo.authorizedUntil
    ? dayjs(currentInfo.authorizedUntil).isBefore(dayjs(), 'day')
    : false;

  const remainingDays = currentInfo.authorizedUntil
    ? dayjs(currentInfo.authorizedUntil).diff(dayjs(), 'day')
    : 0;

  const handleSelectPlan = (plan: SubscriptionOption) => {
    setSelectedPlan(plan);
    setConfirming(true);
  };

  const handleBack = () => {
    setConfirming(false);
    setSelectedPlan(null);
  };

  const calculateNewExpiry = (): string => {
    if (!selectedPlan) return '';
    const base = currentInfo.authorizedUntil && dayjs(currentInfo.authorizedUntil).isAfter(dayjs(), 'day')
      ? dayjs(currentInfo.authorizedUntil)
      : dayjs();
    return base.add(selectedPlan.months, 'month').format('YYYY-MM-DD');
  };

  const handleConfirm = () => {
    if (!selectedPlan) return;
    setLoading(true);

    setTimeout(() => {
      // 计算新到期日
      const newExpiry = calculateNewExpiry();
      const baseDay = currentInfo.authorizedUntil && dayjs(currentInfo.authorizedUntil).isAfter(dayjs(), 'day')
        ? dayjs(currentInfo.authorizedUntil)
        : dayjs();

      // 更新 registeredUsers 中的 authorizedUntil
      const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const updatedUsers = users.map((u: any) => {
        if (u.username === username) {
          u.authorizedUntil = baseDay.add(selectedPlan.months, 'month').format('YYYY-MM-DD');
          if (!u.authorizedUntil || dayjs(u.authorizedUntil).isAfter(dayjs(), 'day')) {
            u.status = '已审核';
          }
        }
        return u;
      });
      localStorage.setItem('registeredUsers', JSON.stringify(updatedUsers));
      localStorage.setItem('isViewOnly', 'false');

      // 记录订购订单
      const order: SubscriptionOrder = {
        id: `SUB${Date.now()}`,
        username,
        planName: selectedPlan.name,
        months: selectedPlan.months,
        price: selectedPlan.price,
        orderTime: new Date().toISOString(),
        activatedUntil: newExpiry,
      };
      const orders = loadSubscriptionOrders();
      orders.push(order);
      saveSubscriptionOrders(orders);

      setCurrentInfo({
        authorizedUntil: newExpiry,
        status: '已审核',
      });

      setLoading(false);
      setConfirming(false);
      setSelectedPlan(null);

      message.success(
        `成功订购「${selectedPlan.name}」，软件有效期已延长至 ${newExpiry}！`
      );
      onSuccess?.();
    }, 800);
  };

  return (
    <Modal
      title={
        <span>
          <CrownOutlined style={{ marginRight: 8, color: '#faad14' }} />
          {confirming ? '确认订购' : '软件续费订购'}
        </span>
      }
      open={open}
      onCancel={onClose}
      width={confirming ? 520 : 780}
      footer={
        confirming
          ? [
              <Button key="back" onClick={handleBack}>
                返回选择
              </Button>,
              <Button
                key="confirm"
                type="primary"
                loading={loading}
                onClick={handleConfirm}
                style={{
                  background: 'linear-gradient(135deg, #f5a623 0%, #e8960a 50%, #d4890a 100%)',
                  border: 'none',
                  fontWeight: 700,
                }}
              >
                确认支付 ¥{selectedPlan?.price.toFixed(0)}
              </Button>,
            ]
          : null
      }
    >
      {/* 状态信息 */}
      <div
        style={{
          padding: '12px 16px',
          marginBottom: 20,
          background: FREE_PERIOD ? '#f6ffed' : isExpired ? '#fff2f0' : remainingDays > 0 && remainingDays <= 30 ? '#fff7e6' : '#f6ffed',
          border: `1px solid ${FREE_PERIOD ? '#b7eb8f' : isExpired ? '#ffccc7' : remainingDays > 0 && remainingDays <= 30 ? '#ffd591' : '#b7eb8f'}`,
          borderRadius: 8,
        }}
      >
        {isExpired && !FREE_PERIOD ? (
          <Text style={{ color: '#cf1322', fontSize: 13 }}>
            <CloseCircleOutlined style={{ marginRight: 6 }} />
            软件已到期 ({currentInfo.authorizedUntil || '无记录'})，请订购续费恢复使用
          </Text>
        ) : remainingDays > 0 ? (
          FREE_PERIOD ? (
            <Text style={{ color: '#389e0d', fontSize: 13 }}>
              <SafetyCertificateOutlined style={{ marginRight: 6 }} />
              免费期内不限使用时间（原有效期 {currentInfo.authorizedUntil} 不作限制），订购通道暂未开放
            </Text>
          ) : (
            <Text style={{ color: remainingDays <= 30 ? '#d48806' : '#389e0d', fontSize: 13 }}>
              <SafetyCertificateOutlined style={{ marginRight: 6 }} />
              软件有效期至 {currentInfo.authorizedUntil}（剩余 {remainingDays} 天）
              {remainingDays <= 30 && ' — 建议尽快续费'}
            </Text>
          )
        ) : FREE_PERIOD ? (
          <Text style={{ color: '#389e0d', fontSize: 13 }}>
            <SafetyCertificateOutlined style={{ marginRight: 6 }} />
            免费期内不限使用时间（原有效期 {currentInfo.authorizedUntil || '无'} 不作限制），订购通道暂未开放
          </Text>
        ) : (
          <Text style={{ color: '#389e0d', fontSize: 13 }}>
            <SafetyCertificateOutlined style={{ marginRight: 6 }} />
            软件有效期至 {currentInfo.authorizedUntil}
          </Text>
        )}
      </div>

      {!confirming ? (
        /* 套餐选择 */
        <Row gutter={[16, 16]}>
          {SUBSCRIPTION_OPTIONS.map((plan) => (
            <Col xs={24} sm={8} key={plan.key}>
              <Card
                hoverable
                style={{
                  borderRadius: 12,
                  border: plan.popular ? `2px solid ${plan.color}` : '1px solid #f0f0f0',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                bodyStyle={{ padding: '20px 16px', textAlign: 'center' }}
              >
                {plan.popular && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: -30,
                      background: plan.color,
                      color: '#fff',
                      padding: '2px 32px',
                      transform: 'rotate(45deg)',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    推荐
                  </div>
                )}
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: plan.color }}>
                  {plan.name}
                </div>
                <div style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
                  {plan.months}个月有效期
                </div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 32, fontWeight: 700, color: '#bfbfbf', textDecoration: 'line-through' }}>
                    ¥{plan.price}
                  </span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Tag color="green" style={{ fontSize: 13, fontWeight: 700, padding: '2px 12px', marginRight: 0 }}>限时免费</Tag>
                </div>
                {plan.originalPrice > plan.price ? (
                  <div style={{ marginBottom: 12 }}>
                    <Text delete type="secondary" style={{ fontSize: 12 }}>
                      ¥{plan.originalPrice}
                    </Text>
                    <Tag color="red" style={{ marginLeft: 6, fontSize: 11 }}>
                      省 ¥{plan.originalPrice - plan.price}
                    </Tag>
                  </div>
                ) : (
                  <div style={{ marginBottom: 12, minHeight: 22 }} />
                )}
                <div style={{ marginBottom: 16, fontSize: 12, color: '#666' }}>
                  <div style={{ marginBottom: 4 }}>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    {(plan.price / plan.months).toFixed(0)} 元/月
                  </div>
                  <div>
                    <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                    延长至 {calculateNewExpiryForPlan(plan)}
                  </div>
                </div>
                <Button
                  block
                  disabled={SUBSCRIBE_DISABLED}
                  title={SUBSCRIBE_DISABLED ? '订购通道暂未开放：当前为限时免费期，无需订购' : undefined}
                  onClick={() => handleSelectPlan(plan)}
                  style={{
                    height: 40,
                    fontWeight: 700,
                    fontSize: 15,
                    border: 'none',
                    borderRadius: 8,
                    background: SUBSCRIBE_DISABLED
                      ? '#d9d9d9'
                      : plan.popular
                        ? 'linear-gradient(135deg, #f5a623 0%, #e8960a 50%, #d4890a 100%)'
                        : 'linear-gradient(135deg, #1677ff 0%, #0958d9 50%, #003eb3 100%)',
                    color: SUBSCRIBE_DISABLED ? 'rgba(0,0,0,0.45)' : '#fff',
                    boxShadow: SUBSCRIBE_DISABLED
                      ? 'none'
                      : plan.popular
                        ? '0 4px 14px rgba(245, 166, 35, 0.45)'
                        : '0 4px 14px rgba(22, 119, 255, 0.35)',
                  }}
                >
                  立即订购
                </Button>
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        /* 确认信息 */
        selectedPlan && (
          <div>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="订购套餐">{selectedPlan.name}</Descriptions.Item>
              <Descriptions.Item label="有效期">{selectedPlan.months} 个月</Descriptions.Item>
              <Descriptions.Item label="当前到期日">
                {currentInfo.authorizedUntil && dayjs(currentInfo.authorizedUntil).isAfter(dayjs(), 'day')
                  ? currentInfo.authorizedUntil
                  : '已到期'}
              </Descriptions.Item>
              <Descriptions.Item label="续费后到期">
                <Tag color="green">{calculateNewExpiry()}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="支付金额">
                <Text style={{ color: '#ff4d4f', fontWeight: 700, fontSize: 16 }}>
                  ¥{selectedPlan.price}
                </Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  (约 ¥{(selectedPlan.price / selectedPlan.months).toFixed(0)}/月)
                </Text>
              </Descriptions.Item>
            </Descriptions>
            <Text type="secondary" style={{ fontSize: 12 }}>
              付费后软件有效期将立即延长，所有功能恢复正常使用。
            </Text>
          </div>
        )
      )}
    </Modal>
  );
};

/** 快捷计算某套餐的到期日（用于展示） */
function calculateNewExpiryForPlan(plan: { months: number }): string {
  const username = localStorage.getItem('username') || '';
  const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
  const user = users.find((u: any) => u.username === username);
  const base = user?.authorizedUntil && dayjs(user.authorizedUntil).isAfter(dayjs(), 'day')
    ? dayjs(user.authorizedUntil)
    : dayjs();
  return base.add(plan.months, 'month').format('YYYY-MM-DD');
}

export default SubscriptionModal;
