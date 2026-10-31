import React, { useMemo } from 'react';
import { Modal, Table, Tag } from 'antd';
import dayjs from 'dayjs';

interface SubOrder { id: string; username: string; planName: string; months: number; price: number; orderTime: string; activatedUntil: string; }
interface StorageOrder { id: string; username: string; tierName: string; sizeGB: number; price: number; orderTime: string; status?: string; refundCredit?: number; }

const loadSubs = (): SubOrder[] => {
  try { const l = JSON.parse(localStorage.getItem('subscription_orders') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
};
const loadStor = (): StorageOrder[] => {
  try { const l = JSON.parse(localStorage.getItem('storage_orders') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
};

// 租户服务订单弹窗：显示当前登录账号订购的软件费/空间费订单（与开发者后台订单管理同源）
const ServiceOrdersModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const username = localStorage.getItem('username') || '';
  const rows = useMemo(() => {
    if (!open) return [];
    const mine = [
      ...loadSubs().filter(o => o.username === username).map(o => ({
        key: o.id, type: '软件费', name: o.planName, spec: `${o.months} 个月`, amount: Number(o.price) || 0,
        orderTime: o.orderTime, extra: `生效至 ${o.activatedUntil}`,
      })),
      ...loadStor().filter(o => o.username === username && o.status !== '已退款').map(o => ({
        key: o.id, type: '空间费', name: o.tierName, spec: o.sizeGB >= 1024 ? `${(o.sizeGB / 1024).toFixed(0)}TB` : `${o.sizeGB}GB`,
        amount: Number(o.price) || 0, orderTime: o.orderTime,
        extra: o.refundCredit ? `旧套餐退款 ¥${Number(o.refundCredit).toFixed(2)} 抵扣，实付差价` : '空间配额已生效',
      })),
    ];
    return mine.sort((a, b) => (a.orderTime < b.orderTime ? 1 : -1));
  }, [open, username]);

  const columns: any[] = [
    { title: '订单号', dataIndex: 'key', width: 170, align: 'center' },
    { title: '类型', dataIndex: 'type', width: 90, align: 'center', render: (v: string) => <Tag color={v === '软件费' ? 'gold' : 'cyan'}>{v}</Tag> },
    { title: '套餐/档位', dataIndex: 'name', width: 140, align: 'center' },
    { title: '规格', dataIndex: 'spec', width: 90, align: 'center' },
    { title: '金额', dataIndex: 'amount', width: 100, align: 'center', render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 700 }}>¥{(v || 0).toFixed(2)}</span> },
    { title: '订购时间', dataIndex: 'orderTime', width: 150, align: 'center', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '备注', dataIndex: 'extra', width: 140, align: 'center' },
  ];

  return (
    <Modal title="服务订单" open={open} onCancel={onClose} footer={null} width={880}>
      <Table
        rowKey="key"
        bordered
        size="middle"
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '暂无服务订单，订购软件或空间后订单将自动记录于此' }}
      />
    </Modal>
  );
};

export default ServiceOrdersModal;
