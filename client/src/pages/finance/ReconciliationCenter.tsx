import React, { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Space, Modal, Descriptions, Tabs, Select,
  DatePicker, Row, Col, Statistic, message, Badge, Alert, Typography
} from 'antd';
import {
  CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined,
  SyncOutlined, SearchOutlined, ReconciliationOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
import { API_BASE } from '../../utils/apiBase';

// 对账结果标签
const matchResultMap: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  full_match: { color: 'success', text: '对账成功', icon: <CheckCircleOutlined /> },
  amount_match_only: { color: 'warning', text: '金额一致，明细不一致', icon: <ExclamationCircleOutlined /> },
  mismatch: { color: 'error', text: '不匹配', icon: <CloseCircleOutlined /> },
  no_counterpart: { color: 'default', text: '无对方账单', icon: <SyncOutlined spin /> },
  unreconciled: { color: 'default', text: '未对账', icon: <SyncOutlined /> },
};

const ReconciliationCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState('receivable');
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [matchFilter, setMatchFilter] = useState<string>('');

  useEffect(() => {
    fetchRecords();
  }, [activeTab, page, matchFilter]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/finance/reconciliation/records`, {
        params: {
          partyType: activeTab === 'receivable' ? 'customer' : 'supplier',
          matchResult: matchFilter || undefined,
          page,
          pageSize: 20,
        },
      });
      setRecords(res.data.data.list);
      setTotal(res.data.data.total);
    } catch (error) {
      message.error('获取对账记录失败');
    } finally {
      setLoading(false);
    }
  };

  const viewDetail = async (record: any) => {
    try {
      const res = await axios.get(`${API_BASE}/finance/reconciliation/records/${record.id}`);
      setSelectedRecord(res.data.data);
      setDetailVisible(true);
    } catch (error) {
      message.error('获取对账详情失败');
    }
  };

  const columns = [
    {
      title: '对账日期',
      dataIndex: 'reconciliation_date',
      key: 'reconciliation_date',
      width: 120,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '对方',
      dataIndex: 'party_name',
      key: 'party_name',
      width: 150,
    },
    {
      title: '我方账单编号',
      key: 'our_bill_no',
      width: 160,
      render: (_: any, record: any) => (
        <Text code>{record.our_bill_id}</Text>
      ),
    },
    {
      title: '对方账单编号',
      dataIndex: 'their_bill_no',
      key: 'their_bill_no',
      width: 160,
      render: (v: string) => v ? <Text code>{v}</Text> : '-',
    },
    {
      title: '我方金额',
      dataIndex: 'our_amount',
      key: 'our_amount',
      width: 120,
      align: 'right' as const,
      render: (v: number) => `¥${v?.toFixed(2)}`,
    },
    {
      title: '对方金额',
      dataIndex: 'their_amount',
      key: 'their_amount',
      width: 120,
      align: 'right' as const,
      render: (v: number) => v ? `¥${v?.toFixed(2)}` : '-',
    },
    {
      title: '对账结果',
      dataIndex: 'match_result',
      key: 'match_result',
      width: 200,
      render: (v: string) => {
        const cfg = matchResultMap[v] || matchResultMap.unreconciled;
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.text}
          </Tag>
        );
      },
    },
    {
      title: '金额一致',
      dataIndex: 'amount_match',
      key: 'amount_match',
      width: 90,
      render: (v: boolean) => v ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
    },
    {
      title: '明细一致',
      dataIndex: 'detail_match',
      key: 'detail_match',
      width: 90,
      render: (v: boolean) => v ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: any) => (
        <Button type="link" size="small" onClick={() => viewDetail(record)}>
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <ReconciliationOutlined /> 对账中心
        </Title>
        <Space>
          <Select
            placeholder="筛选对账结果"
            allowClear
            style={{ width: 200 }}
            value={matchFilter || undefined}
            onChange={(v) => { setMatchFilter(v || ''); setPage(1); }}
            options={[
              { label: '全部', value: '' },
              { label: '对账成功', value: 'full_match' },
              { label: '金额一致，明细不一致', value: 'amount_match_only' },
              { label: '不匹配', value: 'mismatch' },
            ]}
          />
          <Button icon={<SyncOutlined />} onClick={fetchRecords}>刷新</Button>
        </Space>
      </div>

      {/* 对账原理说明 */}
      <Alert
        message="对账规则说明"
        description={
          <div>
            <Text>1. 以<Text strong>单据编号</Text>为唯一匹配键进行对账</Text><br />
            <Text>2. 优先比对同一张单据的<Text strong>金额是否一致</Text></Text><br />
            <Text>3. 金额一致但明细不一致 → <Tag color="warning">金额一致，明细不一致</Tag></Text><br />
            <Text>4. 金额不一致 → <Tag color="error">不匹配</Tag></Text>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Card
        tabList={[
          { key: 'receivable', tab: '应收对账 (客户)' },
          { key: 'payable', tab: '应付对账 (供应商)' },
        ]}
        activeTabKey={activeTab}
        onTabChange={(key) => { setActiveTab(key); setPage(1); }}
      >
        <Table
          columns={columns}
          dataSource={records}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: (p) => setPage(p),
            showTotal: (t) => `共 ${t} 条记录`,
          }}
        />
      </Card>

      {/* 对账详情弹窗 */}
      <Modal
        title="对账详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={800}
      >
        {selectedRecord && (
          <div>
            <Descriptions column={2} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="对账类型">
                {selectedRecord.reconciliation_type === 'receivable' ? '应收账款' : '应付账款'}
              </Descriptions.Item>
              <Descriptions.Item label="对方名称">{selectedRecord.party_name}</Descriptions.Item>
              <Descriptions.Item label="我方金额">¥{Number(selectedRecord.our_amount).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="对方金额">
                {selectedRecord.their_amount ? `¥${Number(selectedRecord.their_amount).toFixed(2)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="金额一致">
                {selectedRecord.amount_match ? (
                  <Tag color="success">一致</Tag>
                ) : (
                  <Tag color="error">不一致</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="明细一致">
                {selectedRecord.detail_match ? (
                  <Tag color="success">一致</Tag>
                ) : (
                  <Tag color="error">不一致</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="对账结果" span={2}>
                {(() => {
                  const cfg = matchResultMap[selectedRecord.match_result];
                  return <Tag color={cfg?.color}>{cfg?.text}</Tag>;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {selectedRecord.remark}
              </Descriptions.Item>
            </Descriptions>

            {/* 明细差异 */}
            {selectedRecord.match_detail && (
              <div>
                <Title level={5}>明细比对</Title>
                <Table
                  dataSource={typeof selectedRecord.match_detail === 'string' 
                    ? JSON.parse(selectedRecord.match_detail) 
                    : selectedRecord.match_detail}
                  rowKey="itemCode"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '货号/编码', dataIndex: 'itemCode', key: 'itemCode', width: 120 },
                    { title: '我方数量', dataIndex: 'ourQuantity', key: 'ourQuantity', width: 100, align: 'right' as const },
                    { title: '对方数量', dataIndex: 'theirQuantity', key: 'theirQuantity', width: 100, align: 'right' as const },
                    { title: '我方单价', dataIndex: 'ourPrice', key: 'ourPrice', width: 100, align: 'right' as const, render: (v: number) => `¥${v.toFixed(2)}` },
                    { title: '对方单价', dataIndex: 'theirPrice', key: 'theirPrice', width: 100, align: 'right' as const, render: (v: number) => v ? `¥${v.toFixed(2)}` : '-' },
                    { title: '我方小计', dataIndex: 'ourTotal', key: 'ourTotal', width: 100, align: 'right' as const, render: (v: number) => `¥${v.toFixed(2)}` },
                    { title: '对方小计', dataIndex: 'theirTotal', key: 'theirTotal', width: 100, align: 'right' as const, render: (v: number) => v ? `¥${v.toFixed(2)}` : '-' },
                    {
                      title: '匹配',
                      dataIndex: 'match',
                      key: 'match',
                      width: 70,
                      render: (v: boolean) => v
                        ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
                    },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ReconciliationCenter;
