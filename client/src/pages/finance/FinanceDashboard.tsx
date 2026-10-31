import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DollarOutlined } from '@ant-design/icons';
import axios from 'axios';

import { API_BASE } from '../../utils/apiBase';

interface FinanceSummary {
  receivable: {
    stats: { total: number; matched: number; amount_only: number; mismatched: number; unreconciled: number };
    totalAmount: number;
  };
  payable: {
    stats: { total: number; matched: number; amount_only: number; mismatched: number; unreconciled: number };
    totalAmount: number;
  };
}

const FinanceDashboard: React.FC = () => {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/finance/reconciliation/summary`);
      setSummary(res.data.data);
    } catch (error) {
      console.error('获取财务概览失败', error);
    } finally {
      setLoading(false);
    }
  };

  const recStats = summary?.receivable?.stats;
  const payStats = summary?.payable?.stats;

  return (
    <div className="finance-dashboard">
      <h2 style={{ marginBottom: 24 }}>财务管理概览</h2>

      {/* 资金总览 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="应收账款余额"
              value={summary?.receivable?.totalAmount || 0}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#cf1322' }}
              suffix="元"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="应付账款余额"
              value={summary?.payable?.totalAmount || 0}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#1677ff' }}
              suffix="元"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="净资金"
              value={(summary?.receivable?.totalAmount || 0) - (summary?.payable?.totalAmount || 0)}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: (summary?.receivable?.totalAmount || 0) >= (summary?.payable?.totalAmount || 0) ? '#3f8600' : '#cf1322' }}
              suffix="元"
            />
          </Card>
        </Col>
      </Row>

      {/* 应收对账统计 */}
      <Card title="应收账款对账统计" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={4}>
            <Statistic title="总账单数" value={recStats?.total || 0} />
          </Col>
          <Col span={5}>
            <Statistic title="已对账" value={recStats?.matched || 0} valueStyle={{ color: '#3f8600' }} />
          </Col>
          <Col span={5}>
            <Statistic title="金额一致明细不一致" value={recStats?.amount_only || 0} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col span={5}>
            <Statistic title="不匹配" value={recStats?.mismatched || 0} valueStyle={{ color: '#cf1322' }} />
          </Col>
          <Col span={5}>
            <Statistic title="未对账" value={recStats?.unreconciled || 0} valueStyle={{ color: '#999' }} />
          </Col>
        </Row>
      </Card>

      {/* 应付对账统计 */}
      <Card title="应付账款对账统计">
        <Row gutter={16}>
          <Col span={4}>
            <Statistic title="总账单数" value={payStats?.total || 0} />
          </Col>
          <Col span={5}>
            <Statistic title="已对账" value={payStats?.matched || 0} valueStyle={{ color: '#3f8600' }} />
          </Col>
          <Col span={5}>
            <Statistic title="金额一致明细不一致" value={payStats?.amount_only || 0} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col span={5}>
            <Statistic title="不匹配" value={payStats?.mismatched || 0} valueStyle={{ color: '#cf1322' }} />
          </Col>
          <Col span={5}>
            <Statistic title="未对账" value={payStats?.unreconciled || 0} valueStyle={{ color: '#999' }} />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default FinanceDashboard;
