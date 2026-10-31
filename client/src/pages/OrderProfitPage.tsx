import React, { useState, useMemo, useEffect } from 'react';
import {
  Table, Card, Row, Col, Statistic, Tag, Space, Input, Select, DatePicker, Button, Empty, Spin,
} from 'antd';
import {
  DollarOutlined, ArrowUpOutlined, ArrowDownOutlined, WarningOutlined, ReloadOutlined, ExportOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface OrderProfitRecord {
  key: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  salesAmount: number;
  costAmount: number;
  profit: number;
  margin: number;
  orderDate: string;
  person: string;
  status: string;
  itemCount: number;
}

const ORDER_KEY = (owner: string) => `pageData_sales_order-manage_${owner}`;
const PRODUCT_KEY = (owner: string) => `pageData_basic-data_product-list_${owner}`;

const loadOrders = (owner: string): any[] => {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY(owner)) || '[]'); } catch { return []; }
};

const loadProducts = (owner: string): any[] => {
  try { return JSON.parse(localStorage.getItem(PRODUCT_KEY(owner)) || '[]'); } catch { return []; }
};

const OrderProfitPage: React.FC = () => {
  const owner = 'dev'; // TODO: get from context
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [marginFilter, setMarginFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setOrders(loadOrders(owner));
    setProducts(loadProducts(owner));
    setTimeout(() => setLoading(false), 100);
  }, [owner]);

  const refresh = () => {
    setLoading(true);
    setOrders(loadOrders(owner));
    setProducts(loadProducts(owner));
    setTimeout(() => setLoading(false), 100);
  };

  // Build product cost map
  const costMap = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      const code = p.productCode || p.code || '';
      const cost = Number(p.cost || p.costPrice || 0);
      if (code && cost > 0) map.set(code, cost);
    });
    return map;
  }, [products]);

  // Calculate profit data
  const profitData = useMemo((): OrderProfitRecord[] => {
    return orders
      .filter(o => o && o.id && o.orderStatus !== '已取消' && o.auditStatus !== '已取消')
      .map(o => {
        let items: any[] = [];
        try {
          items = o.orderItems ? (typeof o.orderItems === 'string' ? JSON.parse(o.orderItems) : o.orderItems) : [];
        } catch { items = []; }

        let salesAmount = 0;
        let costAmount = 0;

        items.forEach((it: any) => {
          const qty = Number(it.quantity) || 0;
          const price = Number(it.price || it.unitPrice) || 0;
          const productCode = it.productCode || it.code || '';
          const cost = costMap.get(productCode) || 0;

          salesAmount += qty * price;
          costAmount += qty * cost;
        });

        const profit = salesAmount - costAmount;
        const margin = salesAmount > 0 ? (profit / salesAmount) * 100 : 0;

        return {
          key: o.id || o.key,
          orderId: o.id,
          orderNo: o.orderNo || o.id,
          customerName: o.customerName || '',
          salesAmount,
          costAmount,
          profit,
          margin,
          orderDate: o.createTime || o.payTime || '',
          person: o.person || '',
          status: o.orderStatus || '',
          itemCount: items.length,
        };
      })
      .filter(r => r.salesAmount > 0 || r.costAmount > 0);
  }, [orders, costMap]);

  // Apply filters
  const filteredData = useMemo(() => {
    let data = profitData;

    if (searchText) {
      const q = searchText.toLowerCase();
      data = data.filter(r =>
        r.orderNo.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q)
      );
    }

    if (dateRange && dateRange[0] && dateRange[1]) {
      const start = dateRange[0].startOf('day');
      const end = dateRange[1].endOf('day');
      data = data.filter(r => {
        const d = dayjs(r.orderDate);
        return d.isValid() && !d.isBefore(start) && !d.isAfter(end);
      });
    }

    if (marginFilter) {
      if (marginFilter === 'high') data = data.filter(r => r.margin >= 30);
      else if (marginFilter === 'normal') data = data.filter(r => r.margin >= 10 && r.margin < 30);
      else if (marginFilter === 'low') data = data.filter(r => r.margin >= 0 && r.margin < 10);
      else if (marginFilter === 'loss') data = data.filter(r => r.margin < 0);
    }

    return data;
  }, [profitData, searchText, dateRange, marginFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = filteredData.length;
    const totalSales = filteredData.reduce((s, r) => s + r.salesAmount, 0);
    const totalProfit = filteredData.reduce((s, r) => s + r.profit, 0);
    const avgMargin = total > 0 ? filteredData.reduce((s, r) => s + r.margin, 0) / total : 0;
    const highProfit = filteredData.filter(r => r.margin >= 30).length;
    const lossOrder = filteredData.filter(r => r.margin < 0).length;
    const warningCount = filteredData.filter(r => r.margin < 10 && r.margin >= 0).length;

    return { total, totalSales, totalProfit, avgMargin, highProfit, lossOrder, warningCount };
  }, [filteredData]);

  const columns = [
    {
      title: '订单编号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 130,
      render: (v: string) => <span style={{ fontFamily: 'monospace', color: '#1890ff' }}>{v}</span>,
    },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 130,
      render: (v: string) => v || '—',
    },
    {
      title: '销售金额',
      dataIndex: 'salesAmount',
      key: 'salesAmount',
      width: 130,
      align: 'right' as const,
      sorter: (a: OrderProfitRecord, b: OrderProfitRecord) => a.salesAmount - b.salesAmount,
      render: (v: number) => <span style={{ color: '#1890ff', fontWeight: 500 }}>¥{v.toFixed(2)}</span>,
    },
    {
      title: '成本金额',
      dataIndex: 'costAmount',
      key: 'costAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => <span style={{ color: '#fa8c16' }}>¥{v.toFixed(2)}</span>,
    },
    {
      title: '毛利额',
      dataIndex: 'profit',
      key: 'profit',
      width: 120,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? '#52c41a' : '#f5222d', fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}¥{v.toFixed(2)}
        </span>
      ),
    },
    {
      title: '毛利率',
      dataIndex: 'margin',
      key: 'margin',
      width: 100,
      align: 'center' as const,
      sorter: (a: OrderProfitRecord, b: OrderProfitRecord) => a.margin - b.margin,
      defaultSortOrder: 'descend' as const,
      render: (v: number) => {
        let color = '#52c41a';
        let icon = <ArrowUpOutlined />;
        if (v < 0) { color = '#f5222d'; icon = <ArrowDownOutlined />; }
        else if (v < 10) { color = '#fa8c16'; icon = <WarningOutlined />; }
        else if (v < 30) { color = '#1890ff'; }
        return <Tag color={color} icon={icon}>{v.toFixed(1)}%</Tag>;
      },
    },
    {
      title: '订单日期',
      dataIndex: 'orderDate',
      key: 'orderDate',
      width: 110,
      sorter: (a: OrderProfitRecord, b: OrderProfitRecord) => dayjs(a.orderDate).unix() - dayjs(b.orderDate).unix(),
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '—',
    },
    {
      title: '负责人',
      dataIndex: 'person',
      key: 'person',
      width: 90,
      render: (v: string) => v || '—',
    },
    {
      title: '订单状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const colorMap: Record<string, string> = {
          '已付款': 'green',
          '待付款': 'orange',
          '待审核': 'blue',
          '已完成': 'cyan',
        };
        return <Tag color={colorMap[v] || 'default'}>{v || '—'}</Tag>;
      },
    },
  ];

  const handleExport = () => {
    const header = '订单编号,客户名称,销售金额,成本金额,毛利额,毛利率,订单日期,负责人,订单状态\n';
    const body = filteredData.map(r =>
      [r.orderNo, r.customerName, r.salesAmount.toFixed(2), r.costAmount.toFixed(2), r.profit.toFixed(2), r.margin.toFixed(2) + '%', r.orderDate, r.person, r.status].join(',')
    ).join('\n');
    const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `订单毛利率_${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
  };

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100%' }}>
      {/* Statistics Cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="订单总数"
              value={stats.total}
              suffix="单"
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均毛利率"
              value={stats.avgMargin}
              precision={1}
              suffix="%"
              prefix={stats.avgMargin >= 20 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              valueStyle={{ color: stats.avgMargin >= 20 ? '#52c41a' : '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="高利润订单"
              value={stats.highProfit}
              suffix="单"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="亏损订单"
              value={stats.lossOrder}
              suffix="单"
              prefix={<WarningOutlined />}
              valueStyle={{ color: stats.lossOrder > 0 ? '#f5222d' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Summary Row */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="销售总额"
              value={stats.totalSales}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="毛利总额"
              value={stats.totalProfit}
              precision={2}
              prefix="¥"
              valueStyle={{ color: stats.totalProfit >= 0 ? '#52c41a' : '#f5222d' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="预警订单"
              value={stats.warningCount}
              suffix="单"
              valueStyle={{ color: stats.warningCount > 0 ? '#fa8c16' : '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card style={{ marginBottom: 24 }}>
        <Space wrap>
          <Input
            placeholder="搜索订单编号/客户名称"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
            placeholder={['开始日期', '结束日期']}
          />
          <Select
            value={marginFilter}
            onChange={setMarginFilter}
            style={{ width: 160 }}
            placeholder="利润率筛选"
            options={[
              { label: '全部', value: '' },
              { label: '高利润(≥30%)', value: 'high' },
              { label: '正常(10%-30%)', value: 'normal' },
              { label: '低利润(<10%)', value: 'low' },
              { label: '亏损(<0%)', value: 'loss' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
        </Space>
      </Card>

      {/* Table */}
      <Card>
        <Spin spinning={loading}>
          <Table
            columns={columns}
            dataSource={filteredData}
            rowKey="key"
            bordered
            size="small"
            pagination={{
              pageSize: 100,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
            }}
            scroll={{ x: 1200 }}
            locale={{ emptyText: <Empty description="暂无订单数据" /> }}
          />
        </Spin>
      </Card>
    </div>
  );
};

export default OrderProfitPage;
