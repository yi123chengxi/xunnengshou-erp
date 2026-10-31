import React, { useState } from 'react';
import { Tag, Tooltip, Button } from 'antd';
import { ClockCircleOutlined, SafetyCertificateOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import SubscriptionModal from './SubscriptionModal';
import { FREE_PERIOD } from '../utils/billingPolicy';

// 金色续费按钮共用样式
const goldBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #f5a623, #d4890a)',
  color: '#fff',
  border: 'none',
  fontSize: 12,
  fontWeight: 600,
  marginRight: 0,
  cursor: 'pointer',
  borderRadius: 4,
  padding: '2px 10px',
  boxShadow: '0 2px 6px rgba(245,166,35,0.4)',
  lineHeight: '22px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  transition: 'all 0.2s',
};

/**
 * 试用期倒计时组件
 * 在页面右上角显示试用剩余天数或授权有效期
 * 到期后可自助订购续费
 */
const TrialCountdown: React.FC = () => {
  const [subModalVisible, setSubModalVisible] = useState(false);
  const username = localStorage.getItem('username');
  if (!username) return null;

  // 从注册用户中查找当前用户
  const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
  const currentUser = registeredUsers.find((u: any) => u.username === username);
  if (!currentUser) return null;

  const { status, trialEndDate, authorizedUntil } = currentUser;

  // 金色续期按钮组件（用于Tooltip内）
  const goldRenewalBtn = (label: string) => (
    <Button
      size="small"
      icon={<ShoppingCartOutlined />}
      style={{
        background: 'linear-gradient(135deg, #f5a623, #d4890a)',
        border: 'none',
        color: '#fff',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(245,166,35,0.5)',
        borderRadius: 4,
        marginTop: 8,
        width: '100%',
      }}
      onClick={() => setSubModalVisible(true)}
    >
      {label}
    </Button>
  );

  // 免费期：不限使用时间，头部不显示到期倒计时（仍可查看订购窗口的限时免费价目）
  if (FREE_PERIOD) {
    return (
      <>
        <Tooltip
          title={
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, marginBottom: 4 }}>免费期内不限使用时间</p>
              {goldRenewalBtn('查看订购方案')}
            </div>
          }
        >
          <Tag color="green" style={{ fontSize: 12, marginRight: 0, cursor: 'pointer' }} onClick={() => setSubModalVisible(true)}>
            <SafetyCertificateOutlined /> 限时免费
          </Tag>
        </Tooltip>
        <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
      </>
    );
  }

  // 已审核且有授权截止日期
  if (status === '已审核' && authorizedUntil) {
    const remaining = dayjs(authorizedUntil).diff(dayjs(), 'day');
    if (remaining <= 0) {
      return (
        <>
          <Tooltip
            title={
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, marginBottom: 4 }}>软件已到期，请尽快续期</p>
                {goldRenewalBtn('立即续期')}
              </div>
            }
          >
            <Tag
              style={goldBtnStyle}
              onClick={() => setSubModalVisible(true)}
            >
              <ClockCircleOutlined /> 已到期
            </Tag>
          </Tooltip>
          <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
        </>
      );
    }
    if (remaining <= 30) {
      return (
        <>
          <Tooltip
            title={
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, marginBottom: 4 }}>
                  授权至 {authorizedUntil}，剩余 {remaining} 天
                </p>
                {goldRenewalBtn('点击续期')}
              </div>
            }
          >
            <Tag
              style={goldBtnStyle}
              onClick={() => setSubModalVisible(true)}
            >
              <SafetyCertificateOutlined /> {remaining} 天到期
            </Tag>
          </Tooltip>
          <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
        </>
      );
    }
    return (
      <>
        <Tooltip
          title={
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, marginBottom: 4 }}>
                授权至 {authorizedUntil}，剩余 {remaining} 天
              </p>
              {goldRenewalBtn('点击续期')}
            </div>
          }
        >
          <Tag color="green" style={{ fontSize: 12, marginRight: 0 }}>
            <SafetyCertificateOutlined /> 有效期 {remaining} 天
          </Tag>
        </Tooltip>
        <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
      </>
    );
  }

  // 试用期内
  if (trialEndDate) {
    const remaining = dayjs(trialEndDate).diff(dayjs(), 'day');
    if (remaining <= 0) {
      return (
        <>
          <Tooltip
            title={
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, marginBottom: 4 }}>试用期已到期，请尽快续期</p>
                {goldRenewalBtn('立即续期')}
              </div>
            }
          >
            <Tag
              style={goldBtnStyle}
              onClick={() => setSubModalVisible(true)}
            >
              <ClockCircleOutlined /> 试用已到期
            </Tag>
          </Tooltip>
          <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
        </>
      );
    }
    if (remaining <= 7) {
      return (
        <>
          <Tooltip
            title={
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, marginBottom: 4 }}>试用期将于 {trialEndDate} 到期</p>
                {goldRenewalBtn('立即续期')}
              </div>
            }
          >
            <Tag color="orange" style={{ fontSize: 12, marginRight: 0 }}>
              <ClockCircleOutlined /> 试用 {remaining} 天
            </Tag>
          </Tooltip>
          <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
        </>
      );
    }
    return (
      <>
        <Tooltip
          title={
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, marginBottom: 4 }}>试用期至 {trialEndDate}</p>
              {goldRenewalBtn('点击续期')}
            </div>
          }
        >
          <Tag color="processing" style={{ fontSize: 12, marginRight: 0 }}>
            <ClockCircleOutlined /> 试用 {remaining} 天
          </Tag>
        </Tooltip>
        <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
      </>
    );
  }

  // 默认：显示订购入口
  return (
    <>
      <Tooltip
        title={
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, marginBottom: 4 }}>订购软件服务</p>
            {goldRenewalBtn('立即订购')}
          </div>
        }
      >
        <Tag
          style={goldBtnStyle}
          onClick={() => setSubModalVisible(true)}
        >
          <ShoppingCartOutlined /> 订购软件
        </Tag>
      </Tooltip>
      <SubscriptionModal open={subModalVisible} onClose={() => setSubModalVisible(false)} />
    </>
  );
};

export default TrialCountdown;
