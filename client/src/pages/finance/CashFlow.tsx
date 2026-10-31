import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Select, DatePicker, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const API_BASE = 'http://localhost:3000/api';

const CashFlow: React.FC = () => {
  const [flows, setFlows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [flowType, setFlowType] = useState('');

  useEffect(() => { fetchFlows(); }, [page, flowType]);

  const fetchFlows = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/finance/accounts/cashflow`, {
        params: { flowType: flowType || undefined, page, pageSize: 20 },
      });
      setFlows(res.data.data.list);
      setTotal(res.data.data.total);
    } catch (error) {
      console.error('获取资金流水失败', error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { title: '流水号', dataIndex: 'flow_no', key: 'flow_no', width: 160, render: (v: string) => <Text code>{v}</Text> },
    { title: '日期', dataIndex: 'flow_date', key: 'flow_date', width: 110, render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    { title: '类型', dataIndex: 'flow_type', key: 'flow_type', width: 90, render: (v: string) => (
      v === 'income' ? <Tag color="success" icon={<ArrowUpOutlined />}>收入</Tag> : <Tag color="error" icon={<ArrowDownOutlined />}>支出</Tag>
    )},
    { title: '类别', dataIndex: 'category', key: 'category', width: 120 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const, render: (v: number, record: any) => (
      <Text strong style={{ color: record.flow_type === 'income' ? '#3f8600' : '#cf1322' }}>
        {record.flow_type === 'income' ? '+' : '-'}¥{v?.toFixed(2)}
      </Text>
    )},
    { title: '余额', dataIndex: 'balance_after', key: 'balance_after', width: 120, align: 'right' as const, render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '关联单据', dataIndex: 'ref_no', key: 'ref_no', width: 150, render: (v: string) => v ? <Text code>{v}</Text> : '-' },
    { title: '操作人', dataIndex: 'operator_name', key: 'operator_name', width: 100 },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>资金流水</Title>
        <Space>
          <Select placeholder="收支类型" allowClear style={{ width: 120 }} value={flowType || undefined}
            onChange={(v) => { setFlowType(v || ''); setPage(1); }}
            options={[
              { label: '全部', value: '' },
              { label: '收入', value: 'income' },
              { label: '支出', value: 'expense' },
            ]}
          />
        </Space>
      </div>
      <Card>
        <Table columns={columns} dataSource={flows} rowKey="id" loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: (p) => setPage(p), showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
    </div>
  );
};

export default CashFlow;
