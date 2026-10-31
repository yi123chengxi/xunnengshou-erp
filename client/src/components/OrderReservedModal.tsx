import React from 'react';
import { Modal, Table, Tag, Typography } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { getOrderReservedDetail } from '../utils/orderOccupied';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  productCode: string;
  productName: string;
}

const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// 订单占用明细弹窗（点击产品列表订单占用数单元格打开，版式参考实际库存明细）
const OrderReservedModal: React.FC<Props> = ({ open, onClose, productCode, productName }) => {
  const rows = React.useMemo(
    () => (open && productCode ? getOrderReservedDetail(getDataOwner(), productCode) : []),
    [open, productCode],
  );

  const totalQty = React.useMemo(() => rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0), [rows]);

  const columns = [
    {
      title: '序号', key: 'index', width: 50, align: 'center' as const,
      render: (_: any, __: any, idx: number) => <span style={{ color: '#8c8c8c' }}>{idx + 1}</span>,
    },
    {
      title: '订单编号', dataIndex: 'orderId', key: 'orderId', width: 160, align: 'center' as const,
      render: (v: string) => <Text style={{ color: '#1890ff', fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 180, align: 'center' as const,
      render: (v: string) => v || '—',
    },
    {
      title: '订单状态', dataIndex: 'orderStatus', key: 'orderStatus', width: 110, align: 'center' as const,
      render: (v: string) => {
        const colorMap: Record<string, string> = { '已付款': 'blue', '已审核': 'green', '已审核待发货': 'green', '已审核待生产': 'green', '待财务审核': 'gold', '已财务审核': 'green' };
        return <Tag color={colorMap[v] || 'default'}>{v}</Tag>;
      },
    },
    {
      title: '占用数量', dataIndex: 'quantity', key: 'quantity', width: 110, align: 'center' as const,
      render: (v: number) => (
        <span style={{ display: 'inline-block', background: '#fa8c16', color: '#fff', borderRadius: 4, padding: '2px 10px', fontWeight: 600, minWidth: 60, fontFamily: 'monospace' }}>
          {v}
        </span>
      ),
    },
    {
      title: '下单时间', dataIndex: 'createTime', key: 'createTime', width: 170, align: 'center' as const,
      render: (v: string) => v || '—',
    },
  ];

  return (
    <Modal
      title={
        <span>
          <ShoppingCartOutlined style={{ marginRight: 8, color: '#1e4a7e' }} />
          订单占用明细 — {productName || productCode}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={900}
      zIndex={1300}
      destroyOnClose
    >
      {rows.length > 0 ? (
        <Table
          bordered
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条记录` }}
          dataSource={rows}
          rowKey={(r) => r.orderId}
          columns={columns}
          scroll={{ y: 400 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4} align="center">
                  <Text strong>小计（占用中订单 {rows.length} 笔）</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center">
                  <span style={{ display: 'inline-block', background: '#fa8c16', color: '#fff', borderRadius: 4, padding: '2px 10px', fontWeight: 600, fontFamily: 'monospace' }}>
                    {totalQty}
                  </span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
          暂无占用该商品的未发货订单
        </div>
      )}
    </Modal>
  );
};

export default OrderReservedModal;
