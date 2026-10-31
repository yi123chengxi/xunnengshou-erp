import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Tag, Typography, Select, Modal, message } from 'antd';
import { DollarOutlined, CheckOutlined, SyncOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
import { API_BASE } from '../../utils/apiBase';

const billStatusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'processing', text: '待付款' },
  confirmed: { color: 'blue', text: '已确认' },
  partial: { color: 'warning', text: '部分付款' },
  paid: { color: 'success', text: '已付款' },
  overdue: { color: 'error', text: '已逾期' },
};

const recStatusMap: Record<string, { color: string; text: string }> = {
  reconciled: { color: 'success', text: '对账成功' },
  matched_amount_only: { color: 'warning', text: '金额一致，明细不一致' },
  mismatch: { color: 'error', text: '不匹配' },
  unreconciled: { color: 'default', text: '未对账' },
};

const PayableBills: React.FC = () => {
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [detailModal, setDetailModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => { fetchBills(); }, [page, statusFilter]);

  const fetchBills = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/finance/payable/bills`, {
        params: { status: statusFilter || undefined, page, pageSize: 20 },
      });
      setBills(res.data.data.list);
      setTotal(res.data.data.total);
    } catch (error) {
      message.error('获取应付账单失败');
    } finally {
      setLoading(false);
    }
  };

  const showDetail = async (bill: any) => {
    setSelectedBill(bill);
    try {
      const res = await axios.get(`${API_BASE}/finance/payable/bills/${bill.id}/items`);
      setItems(res.data.data);
    } catch (error) {
      setItems([]);
    }
    setDetailModal(true);
  };

  const confirmBill = async () => {
    if (!selectedBill) return;
    try {
      await axios.post(`${API_BASE}/finance/payable/bills/confirm`, {
        supplierId: selectedBill.supplier_id,
        billNo: selectedBill.bill_no,
      });
      message.success('供应商确认成功，已自动入账');
      setDetailModal(false);
      fetchBills();
    } catch (error: any) {
      message.error(error.response?.data?.message || '确认失败');
    }
  };

  const columns = [
    { title: '账单编号', dataIndex: 'bill_no', key: 'bill_no', width: 160, render: (v: string) => <Text code>{v}</Text> },
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier_name', width: 120 },
    { title: '来源单据', dataIndex: 'ref_no', key: 'ref_no', width: 150, render: (v: string) => <Text code>{v}</Text> },
    { title: '账单日期', dataIndex: 'bill_date', key: 'bill_date', width: 110, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const, render: (v: number) => <Text strong style={{ color: '#1677ff' }}>¥{v?.toFixed(2)}</Text> },
    { title: '已付', dataIndex: 'paid_amount', key: 'paid_amount', width: 100, align: 'right' as const, render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '付款状态', dataIndex: 'bill_status', key: 'bill_status', width: 100, render: (v: string) => {
      const cfg = billStatusMap[v] || { color: 'default', text: v };
      return <Tag color={cfg.color}>{cfg.text}</Tag>;
    }},
    { title: '供应商确认', dataIndex: 'supplier_status', key: 'supplier_status', width: 100, render: (v: string) => (
      v === 'confirmed' ? <Tag color="success">已确认</Tag> : <Tag color="default">待确认</Tag>
    )},
    { title: '对账状态', dataIndex: 'reconciliation_status', key: 'reconciliation_status', width: 180, render: (v: string) => {
      const cfg = recStatusMap[v] || { color: 'default', text: v };
      return <Tag color={cfg.color}>{cfg.text}</Tag>;
    }},
    { title: '操作', key: 'action', width: 150, render: (_: any, record: any) => (
      <Space>
        <Button type="link" size="small" onClick={() => showDetail(record)}>详情</Button>
        <Button type="link" size="small" icon={<DollarOutlined />}>付款</Button>
      </Space>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}><DollarOutlined /> 应付账款</Title>
        <Space>
          <Select placeholder="对账状态" allowClear style={{ width: 200 }} value={statusFilter || undefined}
            onChange={(v) => { setStatusFilter(v || ''); setPage(1); }}
            options={[
              { label: '全部', value: '' },
              { label: '未对账', value: 'unreconciled' },
              { label: '对账成功', value: 'reconciled' },
              { label: '金额一致，明细不一致', value: 'matched_amount_only' },
              { label: '不匹配', value: 'mismatch' },
            ]}
          />
          <Button icon={<SyncOutlined />} onClick={fetchBills}>刷新</Button>
        </Space>
      </div>
      <Card>
        <Table columns={columns} dataSource={bills} rowKey="id" loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: (p) => setPage(p), showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      <Modal title={`账单详情 - ${selectedBill?.bill_no || ''}`} open={detailModal}
        onCancel={() => setDetailModal(false)} width={700}
        footer={[
          <Button key="cancel" onClick={() => setDetailModal(false)}>关闭</Button>,
          <Button key="confirm" type="primary" icon={<CheckOutlined />}
            onClick={confirmBill}
            disabled={selectedBill?.supplier_status === 'confirmed'}>
            供应商确认入账
          </Button>,
        ]}
      >
        {selectedBill && (
          <div>
            <p><Text strong>供应商：</Text>{selectedBill.supplier_name}</p>
            <p><Text strong>来源单据：</Text>{selectedBill.ref_no}</p>
            <p><Text strong>金额：</Text><Text style={{ color: '#1677ff', fontSize: 18 }}>¥{Number(selectedBill.amount).toFixed(2)}</Text></p>
            <p><Text strong>对账状态：</Text>
              {(() => {
                const cfg = recStatusMap[selectedBill.reconciliation_status];
                return <Tag color={cfg?.color}>{cfg?.text}</Tag>;
              })()}
            </p>
            <Table dataSource={items} rowKey="id" size="small" style={{ marginTop: 16 }}
              columns={[
                { title: '物料编码', dataIndex: 'material_code', key: 'material_code' },
                { title: '物料名称', dataIndex: 'material_name', key: 'material_name' },
                { title: '数量', dataIndex: 'quantity', key: 'quantity' },
                { title: '单价', dataIndex: 'unit_price', key: 'unit_price', render: (v: number) => `¥${v?.toFixed(2)}` },
                { title: '小计', dataIndex: 'total_price', key: 'total_price', render: (v: number) => `¥${v?.toFixed(2)}` },
              ]}
              pagination={false}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PayableBills;
