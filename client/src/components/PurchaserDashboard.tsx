/**
 * 采购商首页（经营看板模式）：指标取自采购商侧真实数据
 * 数据源：供应商列表 purchaser_suppliers_<owner> / 采购账单 purchaser_bills_<owner> / 交易订单 market_trade_orders / 商品列表 dataStore
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Card, Row, Col, Table, Tag, Button, Tooltip, Typography, Space, Empty } from 'antd';
import {
  ReloadOutlined, TeamOutlined, DollarOutlined, ShoppingCartOutlined, FileTextOutlined,
  DatabaseOutlined, RiseOutlined, WarningOutlined, ShopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import EChartsLite from './EChartsLite';
import { useNavigate } from 'react-router-dom';
import { getDataOwner } from '../utils/brandAuth';
import { readProductListSync } from '../utils/dataStore';
import NewstyleBoardCard from './NewstyleBoardCard';
import FeedbackAnnouncementRow from './FeedbackAnnouncementRow';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

const loadJson = (k: string, d: any = []): any[] => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return Array.isArray(v) ? v : d; } catch { return d; }
};
const money = (n: number) => `¥${(Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const RECON_DONE = ['一致', '已对账', '对账完成', '按供方入账'];

const PurchaserDashboard: React.FC = () => {
  const owner = getDataOwner();
  const username = localStorage.getItem('username') || '';
  const navigate = useNavigate();
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(dayjs().format('YYYY-MM-DD HH:mm:ss'));
  const reload = useCallback(() => { setNonce(n => n + 1); setLastUpdate(dayjs().format('YYYY-MM-DD HH:mm:ss')); }, []);
  const handleRefresh = () => { setRefreshing(true); setTimeout(() => { reload(); setRefreshing(false); }, 300); };

  const stats = useMemo(() => {
    void nonce;
    const suppliers = loadJson(`purchaser_suppliers_${owner}`);
    const bills = loadJson(`purchaser_bills_${owner}`);
    const trades = loadJson('market_trade_orders').filter((o: any) => o.purchaserUsername === username || o.purchaserUsername === owner);
    const products = readProductListSync(owner);
    const nowM = dayjs().format('YYYY-MM');

    const approved = suppliers.filter((s: any) => s.cooperationStatus === 'approved');
    const pendingSup = suppliers.filter((s: any) => s.cooperationStatus === 'pending');
    const billTotal = bills.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
    const monthBills = bills.filter((b: any) => dayjs(b.date || b.createdAt || '').format('YYYY-MM') === nowM);
    const monthAmount = monthBills.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
    const unrecon = bills.filter((b: any) => !RECON_DONE.includes(String(b.reconcileResult || '')));
    const waitPush = trades.filter((o: any) => o.status === '待推送');
    const pushed = trades.filter((o: any) => o.status === '已推送');
    const tradeTotal = trades.reduce((s: number, o: any) => s + (Number(o.totalAmount) || 0), 0);

    const months: string[] = [];
    for (let i = 5; i >= 0; i--) months.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
    const trend = months.map(m => Math.round(bills
      .filter((b: any) => dayjs(b.date || b.createdAt || '').format('YYYY-MM') === m)
      .reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0) * 100) / 100);
    const statusDist = [
      { name: '待推送', value: waitPush.length },
      { name: '已推送', value: pushed.length },
      { name: '其他状态', value: Math.max(0, trades.length - waitPush.length - pushed.length) },
    ];
    const recentBills = [...bills].sort((a: any, b: any) =>
      String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || ''))).slice(0, 6);

    return {
      approvedCount: approved.length, pendingSupCount: pendingSup.length,
      billTotal, monthAmount, monthBillCount: monthBills.length, unreconCount: unrecon.length,
      waitPushCount: waitPush.length, pushedCount: pushed.length, tradeTotal,
      productCount: products.length, months, trend, statusDist, recentBills,
    };
  }, [owner, username, nonce]);

  const kpis = [
    { title: '合作供应商', value: `${stats.approvedCount} 家`, icon: <TeamOutlined />, color: '#2d7a5f', tip: `另有 ${stats.pendingSupCount} 家待确认` },
    { title: '本月采购额', value: money(stats.monthAmount), icon: <RiseOutlined />, color: '#0958d9', tip: `本月账单 ${stats.monthBillCount} 单` },
    { title: '累计采购额', value: money(stats.billTotal), icon: <DollarOutlined />, color: '#5b7fa5', tip: '全部采购账单金额合计' },
    { title: '待推送订单', value: `${stats.waitPushCount} 单`, icon: <ShoppingCartOutlined />, color: '#d48806', tip: '已推送 ' + stats.pushedCount + ' 单' },
    { title: '未对账账单', value: `${stats.unreconCount} 单`, icon: <WarningOutlined />, color: '#cf1322', tip: '对账结果未完成的账单' },
    { title: '商品档案', value: `${stats.productCount} 款`, icon: <DatabaseOutlined />, color: '#722ed1', tip: '本租户商品列表数量' },
  ];

  const quickEntries = [
    { label: '订单管理', path: '/purchaser/orders', icon: <ShoppingCartOutlined />, sub: `${stats.waitPushCount + stats.pushedCount} 单` },
    { label: '供应商列表', path: '/purchaser/suppliers/list', icon: <TeamOutlined />, sub: `合作 ${stats.approvedCount} 家` },
    { label: '采购账单', path: '/purchaser/suppliers/bill', icon: <FileTextOutlined />, sub: `未对账 ${stats.unreconCount} 单` },
    { label: '合作申请', path: '/purchaser/suppliers/cooperation', icon: <ShopOutlined />, sub: `待确认 ${stats.pendingSupCount} 家` },
    { label: '成品市场', path: '/purchaser/market/finished', icon: <RiseOutlined />, sub: '选品下单' },
    { label: '新款进度', path: '/purchaser/ecommerce/progress', icon: <DatabaseOutlined />, sub: '研发跟踪' },
  ];

  const billCols: any[] = [
    { title: '单据编号', dataIndex: 'outboundNo', width: 130, render: (v: string, r: any) => <Text style={{ fontSize: 12 }}>{v || r.key}</Text> },
    { title: '供应商', dataIndex: 'supplier', width: 140, ellipsis: true, render: (v: string) => v || '-' },
    { title: '采购金额', dataIndex: 'totalAmount', width: 110, align: 'right', render: (v: any) => <Text style={{ color: '#f5222d', fontSize: 12 }}>{money(Number(v) || 0)}</Text> },
    { title: '对账结果', dataIndex: 'reconcileResult', width: 90, align: 'center', render: (v: string) => (v ? <Tag color={RECON_DONE.includes(v) ? 'green' : 'orange'}>{v === '已对账' ? '对账完成' : v}</Tag> : <Tag>未对账</Tag>) },
    { title: '日期', dataIndex: 'date', width: 110, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text> },
  ];

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff',
        padding: '18px 24px', borderRadius: 12, marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShopOutlined style={{ fontSize: 20, color: '#fff' }} />
          </div>
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 17 }}>采购商经营看板</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>供应商·采购·账单·订单 实时数据总览</Text>
          </div>
        </div>
        <Space>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>数据更新：{lastUpdate}</Text>
          <Tooltip title="刷新数据">
            <Button ghost size="small" icon={<ReloadOutlined spin={refreshing} />} onClick={handleRefresh}>刷新</Button>
          </Tooltip>
        </Space>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {kpis.map((k, i) => (
          <Col xs={12} sm={8} md={4} key={i}>
            <Tooltip title={k.tip}>
              <Card size="small" bodyStyle={{ padding: '14px 16px' }} style={{ borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: `${k.color}1a`, color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {k.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{k.title}</Text>
                    <div style={{ fontWeight: 700, fontSize: 16, color: k.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.value}</div>
                  </div>
                </div>
              </Card>
            </Tooltip>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>近6月采购额趋势（账单口径）</span>} style={{ borderRadius: 10 }}>
            <EChartsLite style={{ height: 250 }} option={{
              tooltip: { trigger: 'axis' },
              grid: { left: 50, right: 20, top: 30, bottom: 30 },
              xAxis: { type: 'category', data: stats.months },
              yAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)) } },
              series: [{
                type: 'line', data: stats.trend, smooth: true,
                areaStyle: { color: 'rgba(30,74,126,0.15)' }, lineStyle: { color: PRIMARY, width: 2 },
                itemStyle: { color: PRIMARY },
              }],
            }} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>订单推送状态</span>} style={{ borderRadius: 10 }}>
            <EChartsLite style={{ height: 250 }} option={{
              tooltip: { trigger: 'item' },
              legend: { bottom: 0 },
              series: [{
                type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
                data: stats.statusDist, label: { formatter: '{b} {c}' },
                itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
              }],
            }} />
          </Card>
        </Col>
      </Row>

      {/* 新款进度看板 */}
      <NewstyleBoardCard owner={owner} nonce={nonce} onMore={() => navigate('/purchaser/ecommerce/progress')} />

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>最近采购账单</span>} extra={<Button type="link" size="small" onClick={() => navigate('/purchaser/suppliers/bill')}>全部</Button>} style={{ borderRadius: 10 }}>
            <Table rowKey={(r: any) => r.key} size="small" bordered pagination={false}
              dataSource={stats.recentBills} columns={billCols}
              locale={{ emptyText: <Empty description="暂无采购账单" /> }} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>快捷入口</span>} style={{ borderRadius: 10 }}>
            <Row gutter={[8, 8]}>
              {quickEntries.map(q => (
                <Col span={12} key={q.path}>
                  <div onClick={() => navigate(q.path)} style={{ border: '1px solid #e8ecf1', borderRadius: 9, padding: '10px 10px', cursor: 'pointer', background: '#fafcfd' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ color: PRIMARY, fontSize: 15 }}>{q.icon}</span>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>{q.label}</Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>{q.sub}</Text>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 意见反馈 + 公告模板（底部区） */}
      <FeedbackAnnouncementRow />
    </div>
  );
};

export default PurchaserDashboard;
