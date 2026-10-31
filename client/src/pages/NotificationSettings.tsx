import React, { useState, useMemo } from 'react';
import { Card, Switch, Typography, Space, Row, Col, message, Tag, Button, Divider } from 'antd';
import { BellOutlined, SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import { getNotificationSettings, saveNotificationSettings, NotificationType } from '../utils/pushNotification';

const { Text, Title } = Typography;

const PRIMARY = '#1677ff';

interface NotifItem {
  key: NotificationType;
  label: string;
  description: string;
  tag?: string;
  tagColor?: string;
}

const NOTIFICATION_ITEMS: NotifItem[] = [
  {
    key: 'recharge-apply',
    label: '充值申请通知',
    description: '当有新的充值申请提交时，向财务负责人发送通知提醒审批',
    tag: '财务',
    tagColor: '#722ed1',
  },
  {
    key: 'recharge-result',
    label: '充值审批结果通知',
    description: '充值申请被确认支付或驳回后，通知申请人审批结果',
    tag: '财务',
    tagColor: '#722ed1',
  },
  {
    key: 'withdraw-task',
    label: '提现任务通知',
    description: '发起提现任务后，通知店铺负责人及时办理提现，直到提现完成',
    tag: '财务',
    tagColor: '#722ed1',
  },
  {
    key: 'withdraw-receipt',
    label: '提现到账通知',
    description: '提现确认到账后，通知相关人员银行流水已更新',
    tag: '财务',
    tagColor: '#722ed1',
  },
  {
    key: 'pay-request',
    label: '收/付申请待处理提醒',
    description: '收款确认、付款审核、待支付出现新记录时系统级弹窗提醒；关闭浏览器后通过 Web Push 推送提醒，点击通知可直接打开详情弹窗处理',
    tag: '财务',
    tagColor: '#722ed1',
  },
  {
    key: 'order',
    label: '订单相关通知',
    description: '新订单、订单状态变更、发货提醒等订单相关的系统通知',
    tag: '业务',
    tagColor: '#1677ff',
  },
  {
    key: 'system-alert',
    label: '系统预警',
    description: '库存不足、交期逾期、异常数据等自动预警提醒',
    tag: '系统',
    tagColor: '#fa8c16',
  },
];

const NotificationSettingsPage: React.FC = () => {
  const owner = useMemo(() => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '') : (localStorage.getItem('username') || '');
  }, []);

  const [settings, setSettings] = useState<Record<string, boolean>>(() => {
    return getNotificationSettings(owner);
  });

  const handleToggle = (key: string, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveNotificationSettings(newSettings, owner);
    message.success(value ? '已开启' : '已关闭');
  };

  const handleToggleAll = (value: boolean) => {
    const newSettings: Record<string, boolean> = {};
    NOTIFICATION_ITEMS.forEach(item => { newSettings[item.key] = value; });
    setSettings(newSettings);
    saveNotificationSettings(newSettings, owner);
    message.success(value ? '已全部开启' : '已全部关闭');
  };

  const handleReset = () => {
    const defaults: Record<string, boolean> = {};
    NOTIFICATION_ITEMS.forEach(item => { defaults[item.key] = true; });
    setSettings(defaults);
    saveNotificationSettings(defaults, owner);
    message.success('已恢复默认设置');
  };

  const enabledCount = NOTIFICATION_ITEMS.filter(item => settings[item.key] !== false).length;

  return (
    <div style={{ padding: 0 }}>
      {/* 页面头部 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '20px 24px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <BellOutlined style={{ fontSize: 24, color: PRIMARY }} />
              <div>
                <Title level={4} style={{ margin: 0 }}>弹窗设置</Title>
                <Text type="secondary">管理系统各类弹窗通知的开关，关闭后不再弹出对应类型的提醒</Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space>
              <Tag color="blue">{enabledCount}/{NOTIFICATION_ITEMS.length} 项已开启</Tag>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>恢复默认</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 全局控制 */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }} bodyStyle={{ padding: '12px 24px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <SettingOutlined style={{ color: PRIMARY }} />
              <Text strong>全局控制</Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button size="small" onClick={() => handleToggleAll(true)}>全部开启</Button>
              <Button size="small" onClick={() => handleToggleAll(false)}>全部关闭</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 通知列表 */}
      <Card bodyStyle={{ padding: 0 }} style={{ borderRadius: 8 }}>
        {NOTIFICATION_ITEMS.map((item, idx) => (
          <div
            key={item.key}
            style={{
              padding: '18px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: idx < NOTIFICATION_ITEMS.length - 1 ? '1px solid #f0f0f0' : 'none',
              background: settings[item.key] !== false ? '#fff' : '#fafafa',
              transition: 'background 0.3s',
            }}
          >
            <div style={{ flex: 1 }}>
              <Space>
                <Text strong style={{ fontSize: 15, color: '#1a2b45' }}>{item.label}</Text>
                {item.tag && <Tag style={{ background: item.tagColor, color: '#fff', border: 'none', fontSize: 11 }}>{item.tag}</Tag>}
              </Space>
              <br />
              <Text type="secondary" style={{ fontSize: 13 }}>{item.description}</Text>
            </div>
            <Switch
              checked={settings[item.key] !== false}
              onChange={(val) => handleToggle(item.key, val)}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </div>
        ))}
      </Card>

      {/* 说明 */}
      <div style={{ marginTop: 12, padding: '0 24px' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          * 通知类型开关仅控制弹窗是否弹出。如需完全关闭浏览器通知，请在浏览器设置中取消通知权限。
          关闭浏览器后仍能收到提醒需依赖 Web Push 推送服务。
        </Text>
      </div>
    </div>
  );
};

export default NotificationSettingsPage;
