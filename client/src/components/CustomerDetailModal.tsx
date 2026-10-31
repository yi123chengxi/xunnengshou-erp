import React, { useEffect, useState } from 'react';
import { Modal, Descriptions, Tag, Typography, List } from 'antd';
import dayjs from 'dayjs';
import { loadFollowups, loadCustomerLogs } from '../utils/devStore';

const { Text } = Typography;

const getRoleColor = (role: string) => {
  if (role.includes('supplier') && role.includes('purchaser')) return 'purple';
  if (role.includes('supplier')) return 'blue';
  if (role.includes('purchaser')) return 'green';
  return 'default';
};
const getRoleText = (role: string) => {
  if (role.includes('supplier') && role.includes('purchaser')) return '供应商+采购商';
  if (role.includes('supplier')) return '供应商';
  if (role.includes('purchaser')) return '采购商';
  return role;
};

// 客户详情弹窗（共享）：全字段信息 + 跟进记录 + 客户日志
const CustomerDetailModal: React.FC<{ username: string | null; open: boolean; onClose: () => void }> = ({ username, open, onClose }) => {
  const [user, setUser] = useState<any>(null);
  const [followups, setFollowups] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (open && username) {
      try {
        const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        setUser(users.find((u: any) => u.username === username) || null);
      } catch { setUser(null); }
      setFollowups(loadFollowups(username).slice().reverse());
      setLogs(loadCustomerLogs(username).slice().reverse());
    }
  }, [open, username]);

  return (
    <Modal title="客户详情" open={open} onCancel={onClose} footer={null} width={720}>
      {user && (
        <>
          <Descriptions column={2} bordered size="small" style={{ marginTop: 16 }}>
            <Descriptions.Item label="登录账号">{user.username}</Descriptions.Item>
            <Descriptions.Item label="注册角色">
              <Tag color={getRoleColor(user.role)}>{getRoleText(user.role)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="公司名称" span={2}>{user.companyName}</Descriptions.Item>
            <Descriptions.Item label="公司编号">{user.companyNo || '-'}</Descriptions.Item>
            <Descriptions.Item label="订单号前缀">{user.orderPrefix || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系人">{user.contactPerson}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{user.phone}</Descriptions.Item>
            <Descriptions.Item label="电子邮箱" span={2}>{user.email}</Descriptions.Item>
            <Descriptions.Item label="纳税人识别号">{user.taxpayerCode || '-'}</Descriptions.Item>
            <Descriptions.Item label="法人">{user.legalPerson || '-'}</Descriptions.Item>
            <Descriptions.Item label="负责人">
              {user.devOwnerName ? (
                <span>
                  <Tag color="purple">{user.devOwnerName}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}> 领取于 {user.devClaimDate || '-'}</Text>
                </span>
              ) : <Text type="secondary">未领取</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="所在地区" span={2}>
              {[user.province, user.city, user.district].filter(Boolean).join(' / ') || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="详细地址" span={2}>{user.addressDetail || '-'}</Descriptions.Item>
            <Descriptions.Item label="经营地址" span={2}>{user.businessAddress || '-'}</Descriptions.Item>
            <Descriptions.Item label="注册日期">{user.registerDate}</Descriptions.Item>
            <Descriptions.Item label="试用截止">
              <span style={{ color: user.trialEndDate && dayjs(user.trialEndDate).isBefore(dayjs()) ? '#ff4d4f' : '#faad14' }}>
                {user.trialEndDate || '-'}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="授权至">
              {user.authorizedUntil ? (
                <Tag color={dayjs(user.authorizedUntil).isBefore(dayjs()) ? 'red' : 'green'}>
                  {user.authorizedUntil}
                </Tag>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={user.status === '已审核' ? 'green' : user.status === '已拒绝' ? 'red' : 'orange'}>
                {user.status}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 20 }}>
            <Text strong style={{ fontSize: 14 }}>跟进记录（{followups.length}）</Text>
            {followups.length ? (
              <List
                size="small"
                dataSource={followups}
                renderItem={(it: any) => (
                  <List.Item style={{ display: 'block', padding: '8px 0' }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{it.content}</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{it.authorName} · {dayjs(it.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                  </List.Item>
                )}
              />
            ) : <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无跟进记录</Text></div>}
          </div>
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ fontSize: 14 }}>客户日志（{logs.length}）</Text>
            {logs.length ? (
              <List
                size="small"
                dataSource={logs}
                renderItem={(it: any) => (
                  <List.Item style={{ display: 'block', padding: '8px 0' }}>
                    <Tag color="blue" style={{ marginRight: 6 }}>{it.action}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{it.operatorName} · {dayjs(it.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                    <div style={{ fontSize: 12, color: '#595959', whiteSpace: 'pre-wrap', marginTop: 2 }}>{it.detail}</div>
                  </List.Item>
                )}
              />
            ) : <div style={{ marginTop: 8 }}><Text type="secondary" style={{ fontSize: 12 }}>暂无日志</Text></div>}
          </div>
        </>
      )}
    </Modal>
  );
};

export default CustomerDetailModal;
