/**
 * 供应商首页（经营看板模式）：全部指标取自系统真实数据
 * 数据源：订单 pageData_sales_order-manage_<owner> / 客户 customers+绑定采购商 / 商品列表 dataStore / 生产订单 / 账单明细
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Card, Row, Col, Table, Tag, Button, Tooltip, Typography, Space, message, Empty, Modal } from 'antd';
import {
  ReloadOutlined, DownloadOutlined, PrinterOutlined, ShoppingCartOutlined, DatabaseOutlined,
  TeamOutlined, DollarOutlined, InboxOutlined, ToolOutlined, FileTextOutlined, SettingOutlined,
  RiseOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { getDataOwner } from '../utils/brandAuth';
import { readProductListSync } from '../utils/dataStore';
import { loadAllCustomersFromStorage } from './CustomerInfo';
import { loadPoTemplates, poToWfOrder, poPlanQty, poNodesOf, poCurrentNodeOverdue } from '../utils/poWorkflow';
import FeedbackAnnouncementRow from '../components/FeedbackAnnouncementRow';

const { Text, Title } = Typography;
const PRIMARY = '#1e4a7e';

const loadJson = (k: string, d: any = []): any[] => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return Array.isArray(v) ? v : d; } catch { return d; }
};
const money = (n: number) => `¥${(Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ORDER_STATUS_COLOR: Record<string, string> = { 待付款: 'orange', 已付款: 'blue', 已发货: 'cyan', 已完成: 'green', 已取消: 'default' };

const Dashboard: React.FC = () => {
  const owner = getDataOwner();
  const navigate = useNavigate();
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(dayjs().format('YYYY-MM-DD HH:mm:ss'));

  const reload = useCallback(() => { setNonce(n => n + 1); setLastUpdate(dayjs().format('YYYY-MM-DD HH:mm:ss')); }, []);
  const handleRefresh = () => { setRefreshing(true); setTimeout(() => { reload(); setRefreshing(false); message.success('数据已刷新'); }, 300); };

  // ============ 真实数据聚合 ============
  const stats = useMemo(() => {
    void nonce;
    const orders = loadJson(`pageData_sales_order-manage_${owner}`);
    const customers = loadAllCustomersFromStorage();
    const products = readProductListSync(owner);
    const production = loadJson(`pageData_production_production-order_${owner}`);
    const bills = loadJson(`pageData_customer_bill-detail_${owner}`);
    const nowM = dayjs().format('YYYY-MM');

    // 销售额口径：订单管理中已付款订单（排除已取消/待付款；无付款时间的旧数据按状态推断），按付款月份归属
    const paidOrders = orders.filter((o: any) => o && o.orderStatus !== '已取消' && o.orderStatus !== '待付款'
      && (o.payTime || ['已付款', '已发货', '已完成'].includes(o.orderStatus)));
    const monthSales = paidOrders
      .filter((o: any) => dayjs(o.payTime || o.createTime || o.date || '').format('YYYY-MM') === nowM)
      .reduce((s: number, o: any) => s + (Number(o.productAmount) || 0), 0);
    const pendingPay = orders.filter((o: any) => o.orderStatus === '待付款');
    const pendingShip = orders.filter((o: any) => o.orderStatus === '已付款');
    const debt = customers.reduce((s: number, c: any) => s + Math.max(0, (Number(c.totalPurchase) || 0) - (Number(c.receivedPayment) || 0)), 0);
    const finished = products.filter((p: any) => p.productType === '成品' && !(p.productCode || '').startsWith('SEMI-'));
    const stockout = finished.filter((p: any) => (Number(p.actualStock) || 0) <= 0);
    const stockQty = finished.reduce((s: number, p: any) => s + (Number(p.actualStock) || 0), 0);
    const boundPurchasers = customers.filter((c: any) => c.type === 'purchaser');
    const prodActive = production.filter((p: any) => p.status !== '已完成' && p.status !== '已取消');
    const monthBills = bills.filter((b: any) => dayjs(b.date || b.createdAt || '').format('YYYY-MM') === nowM);

    // 近6月销售额趋势（已付款订单口径，按付款月份归属）
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) months.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
    const trend = months.map(m => Math.round(paidOrders
      .filter((o: any) => dayjs(o.payTime || o.createTime || o.date || '').format('YYYY-MM') === m)
      .reduce((s: number, o: any) => s + (Number(o.productAmount) || 0), 0) * 100) / 100);
    // 订单状态分布
    const statusList = ['待付款', '已付款', '已发货', '已完成', '已取消'];
    const statusDist = statusList.map(st => ({ name: st, value: orders.filter((o: any) => o.orderStatus === st).length }));

    const recentOrders = [...orders].sort((a: any, b: any) =>
      String(b.createTime || b.date || '').localeCompare(String(a.createTime || a.date || ''))).slice(0, 8);

    // 今日经营统计（按自然日归属）
    const today = dayjs().format('YYYY-MM-DD');
    const isToday = (s: any) => !!s && dayjs(s).isValid() && dayjs(s).format('YYYY-MM-DD') === today;
    const todayNewOrders = orders.filter((o: any) => isToday(o.createTime));
    const todaySoldOrders = paidOrders.filter((o: any) => isToday(o.payTime || o.createTime));
    const todaySoldAmount = todaySoldOrders.reduce((s: number, o: any) => s + (Number(o.productAmount) || 0), 0);
    const todayShippedOrders = orders.filter((o: any) => isToday(o.shipTime));
    const receipts = loadJson(`customerReceipts_${owner}`);
    const todayReceipts = receipts.filter((r: any) => isToday(r.receiptDate || r.createdAt));
    const todayReceiptAmount = todayReceipts.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
    const todayProdDone = production.filter((p: any) => (p.status === 'completed' || p.status === '已完成')
      && isToday(p.updateTime || (p.wf && p.wf.updatedAt)));

    return {
      monthSales, pendingPay, pendingShip, debt, stockout, stockQty,
      customerCount: customers.length, boundCount: boundPurchasers.length,
      productCount: products.length, finishedCount: finished.length,
      prodTotal: production.length, prodActive, monthBillCount: monthBills.length,
      orderTotal: orders.length, trend, months, statusDist, recentOrders,
      today: today,
      todayNewOrders, todaySoldOrders, todaySoldAmount, todayShippedOrders,
      todayReceipts, todayReceiptAmount, todayProdDone,
      prodList: production,
      prodWarning: production.filter((p: any) => p.status === 'warning').length,
    };
  }, [owner, nonce]);

  // 生产订单看板：模板与卡片映射（与生产订单页卡片视图同口径）
  const poData = useMemo(() => loadPoTemplates(owner), [owner, nonce]);
  // 生产订单统计看板：进行中/超时/卡点/本月完工 + 节点超时分布（点击弹出订单列表）
  const [poListModal, setPoListModal] = useState<{ title: string; rows: any[] } | null>(null);
  // 今日经营统计明细弹窗（kind 决定列结构）
  const [todayModal, setTodayModal] = useState<{ title: string; kind: 'order' | 'receipt' | 'prod'; rows: any[] } | null>(null);
  const poBoard = useMemo(() => {
    const clean = (stats.prodList || []).filter((r: any) => !/^JG-/i.test(String(r.id || '')));
    const rows = clean.map((rec: any) => {
      const order = poToWfOrder(rec, poData);
      const nodes = poNodesOf(order, poData.templates);
      const over = poCurrentNodeOverdue(order, nodes);
      return {
        rec, order, over,
        id: rec.id || rec.orderId || '--',
        customer: rec.customerName || '--',
        person: rec.person || '--',
        salesOrderId: rec.salesOrderId || '',
        planQty: poPlanQty(rec),
        doneQty: Number(rec.doneQty ?? rec.completedQuantity) || 0,
        currentNode: order.status === 'COMPLETED' ? '已完工' : (nodes[order.currentStep]?.name || '-'),
        abnormal: order.status === 'ABNORMAL' || rec.status === 'warning',
        createdAt: String(rec.createTime || '').slice(0, 10),
      };
    });
    const active = rows.filter((r: any) => r.order.status !== 'COMPLETED');
    const overdue = active.filter((r: any) => r.over);
    const abnormal = active.filter((r: any) => r.abnormal);
    const nowM = dayjs().format('YYYY-MM');
    const monthDone = rows.filter((r: any) => r.order.status === 'COMPLETED'
      && dayjs(r.order.updatedAt || r.rec.updateTime || '').format('YYYY-MM') === nowM);
    const nodeOverdue: { name: string; count: number }[] = [];
    overdue.forEach((r: any) => {
      const hit = nodeOverdue.find(n => n.name === r.over.name);
      if (hit) hit.count += 1; else nodeOverdue.push({ name: r.over.name, count: 1 });
    });
    const tplNodes: any[] = (poData.templates.find((t: any) => t.id === poData.defaultTemplateId)?.nodes || []);
    nodeOverdue.sort((a, b) => {
      const ia = tplNodes.findIndex(n => n.name === a.name);
      const ib = tplNodes.findIndex(n => n.name === b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return { rows, active, overdue, abnormal, monthDone, nodeOverdue };
  }, [stats, poData]);

  // 打印客户端下载入口（探测后下载）
  const handleDownloadPrintClient = async () => {
    const url = `${process.env.PUBLIC_URL || ''}/downloads/xunnengshou-print-client-setup.exe`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) { message.warning('安装包尚未部署：请在 print-client 目录执行 npm run dist 并复制到 client/public/downloads/'); return; }
      const a = document.createElement('a');
      a.href = url; a.download = 'xunnengshou-print-client-setup.exe';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      message.success('安装包下载已开始');
    } catch { message.warning('下载失败，请稍后重试'); }
  };

  const kpis = [
    { title: '本月销售额', value: money(stats.monthSales), icon: <RiseOutlined />, color: '#2d7a5f', tip: '本月已付款/已发货/已完成订单货品总额' },
    { title: '应收欠款', value: money(stats.debt), icon: <DollarOutlined />, color: '#c0392b', tip: '客户采购总额-已收货款（正差合计）' },
    { title: '待付款订单', value: `${stats.pendingPay.length} 单`, icon: <ShoppingCartOutlined />, color: '#d48806', tip: '订单状态=待付款' },
    { title: '待发货订单', value: `${stats.pendingShip.length} 单`, icon: <InboxOutlined />, color: '#0958d9', tip: '订单状态=已付款待发货' },
    { title: '缺货成品', value: `${stats.stockout.length} 款`, icon: <WarningOutlined />, color: '#cf1322', tip: '成品库存≤0 的款式数' },
    { title: '合作客户', value: `${stats.customerCount} 家`, icon: <TeamOutlined />, color: '#5b7fa5', tip: `含已绑定采购商 ${stats.boundCount} 家` },
  ];

  const quickEntries = [
    { label: '订单管理', path: '/sales/order-manage', icon: <ShoppingCartOutlined />, sub: `${stats.orderTotal} 单` },
    { label: '商品列表', path: '/basic-data/product-list', icon: <DatabaseOutlined />, sub: `${stats.productCount} 款` },
    { label: '客户基础信息', path: '/customer/customer-info', icon: <TeamOutlined />, sub: `${stats.customerCount} 家` },
    { label: '采购价设置', path: '/customer/price-strategy', icon: <SettingOutlined />, sub: '一客一价策略' },
    { label: '生产订单', path: '/production/production-order', icon: <ToolOutlined />, sub: `在制 ${stats.prodActive.length} 单` },
    { label: '账单明细', path: '/customer/bill-detail', icon: <FileTextOutlined />, sub: `本月 ${stats.monthBillCount} 单` },
  ];

  const recentCols: any[] = [
    { title: '订单编号', dataIndex: 'id', width: 150, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: '客户', dataIndex: 'customerName', width: 160, ellipsis: true },
    { title: '货品总额', dataIndex: 'productAmount', width: 110, align: 'right', render: (v: any) => <Text style={{ color: '#f5222d', fontSize: 12 }}>{money(Number(v) || 0)}</Text> },
    { title: '状态', dataIndex: 'orderStatus', width: 90, align: 'center', render: (v: string) => <Tag color={ORDER_STATUS_COLOR[v] || 'default'}>{v || '-'}</Tag> },
    { title: '创建时间', dataIndex: 'createTime', width: 150, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text> },
  ];

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      {/* 看板头部 */}
      <div style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`, color: '#fff',
        padding: '18px 24px', borderRadius: 12, marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RiseOutlined style={{ fontSize: 20, color: '#fff' }} />
          </div>
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 17 }}>供应商经营看板</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>订单·客户·库存·生产 实时数据总览</Text>
          </div>
        </div>
        <Space>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>数据更新：{lastUpdate}</Text>
          <Tooltip title="刷新数据">
            <Button ghost size="small" icon={<ReloadOutlined spin={refreshing} />} onClick={handleRefresh}>刷新</Button>
          </Tooltip>
        </Space>
      </div>

      {/* 打印客户端下载入口 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: '#fff', border: '1px solid #e3e8ee', borderRadius: 12, padding: '10px 20px', marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e8f4fc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: PRIMARY, fontSize: 18, flexShrink: 0 }}>
          <PrinterOutlined />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#1a2b45' }}>讯能手打印客户端</div>
          <Text type="secondary" style={{ fontSize: 12 }}>在需要打印的电脑安装本地打印组件，网页即可获取本机打印机并支持静默/共享打印。</Text>
        </div>
        <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={handleDownloadPrintClient}>下载安装包</Button>
      </div>

      {/* KPI 卡片 */}
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

      {/* 今日经营统计 */}
      <Card size="small" style={{ borderRadius: 10, marginBottom: 16 }}
        title={<span style={{ fontWeight: 600 }}>今日经营统计</span>}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>统计日期 {stats.today} · 点击磁贴查看明细</Text>}>
        <Row gutter={[12, 12]}>
          {[
            { label: '今日新增订单', value: stats.todayNewOrders.length, unit: '单', sub: `含待付款`, color: PRIMARY, kind: 'order' as const, rows: stats.todayNewOrders, title: '今日新增订单', isMoney: false },
            { label: '今日销售订单', value: stats.todaySoldOrders.length, unit: '单', sub: money(stats.todaySoldAmount), color: '#2d7a5f', kind: 'order' as const, rows: stats.todaySoldOrders, title: '今日销售订单（已付款）', isMoney: false },
            { label: '今日发货订单', value: stats.todayShippedOrders.length, unit: '单', sub: '按发货时间', color: '#0958d9', kind: 'order' as const, rows: stats.todayShippedOrders, title: '今日发货订单', isMoney: false },
            { label: '今日收款', value: stats.todayReceiptAmount, unit: '元', sub: `${stats.todayReceipts.length} 笔`, color: '#722ed1', kind: 'receipt' as const, rows: stats.todayReceipts, title: '今日收款明细', isMoney: true },
            { label: '今日生产完工', value: stats.todayProdDone.length, unit: '单', sub: '生产订单完工', color: '#fa8c16', kind: 'prod' as const, rows: stats.todayProdDone, title: '今日生产完工订单', isMoney: false },
          ].map(t => (
            <Col xs={12} sm={8} md={4} key={t.label}>
              <Tooltip title={`点击查看${t.title}明细`}>
                <div onClick={() => setTodayModal({ title: `${t.title}（${t.isMoney ? money(t.value) : `${t.value} ${t.unit}`}）`, kind: t.kind, rows: t.rows })}
                  style={{ cursor: 'pointer', background: '#fafcfd', border: '1px solid #eef2f6', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t.label}</Text>
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.isMoney ? money(t.value) : t.value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>{t.unit}</span>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{t.sub}</Text>
                </div>
              </Tooltip>
            </Col>
          ))}
        </Row>
      </Card>
      {/* 今日经营统计明细弹窗 */}
      <Modal open={!!todayModal} title={todayModal?.title || ''} onCancel={() => setTodayModal(null)} width={860}
        footer={<Button onClick={() => setTodayModal(null)}>关闭</Button>}>
        {todayModal?.kind === 'receipt' ? (
          <Table size="small" bordered rowKey={(r: any) => r.key || r.receiptNo || Math.random()} pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={todayModal.rows}
            columns={[
              { title: '收款单号', dataIndex: 'receiptNo', width: 150, render: (v: string, r: any) => v || r.key || '—' },
              { title: '客户', dataIndex: 'customerName', width: 160, ellipsis: true },
              { title: '金额(元)', dataIndex: 'amount', width: 110, align: 'right' as const, render: (v: number) => money(Number(v) || 0) },
              { title: '收款日期', dataIndex: 'receiptDate', width: 110 },
              { title: '操作人', dataIndex: 'operator', width: 100 },
              { title: '关联订单', dataIndex: 'orderId', ellipsis: true, render: (v: string) => v || '—' },
            ]}
            locale={{ emptyText: <Empty description="今日暂无收款" /> }}
          />
        ) : todayModal?.kind === 'prod' ? (
          <Table size="small" bordered rowKey={(r: any) => r.key || r.id} pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={todayModal.rows}
            columns={[
              { title: '生产单号', dataIndex: 'id', width: 140, render: (v: string) => <Text strong style={{ color: '#1677ff' }}>{v}</Text> },
              { title: '客户', dataIndex: 'customerName', width: 120, ellipsis: true, render: (v: string) => v || '—' },
              { title: '负责人', dataIndex: 'person', width: 90, render: (v: string) => v || '—' },
              { title: '计划数量', width: 90, align: 'right' as const, render: (_: any, r: any) => poPlanQty(r) },
              { title: '完工数量', width: 90, align: 'right' as const, render: (_: any, r: any) => Number(r.doneQty ?? r.completedQuantity) || 0 },
              { title: '完工时间', width: 160, render: (_: any, r: any) => String(r.updateTime || (r.wf && r.wf.updatedAt) || '').slice(0, 19) },
            ]}
            locale={{ emptyText: <Empty description="今日暂无完工订单" /> }}
          />
        ) : (
          <Table size="small" bordered rowKey={(r: any) => r.key || r.id} pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={todayModal?.rows || []}
            columns={[
              { title: '订单号', dataIndex: 'id', width: 130, render: (v: string) => <Text strong style={{ color: '#1677ff' }}>{v}</Text> },
              { title: '客户', dataIndex: 'customerName', width: 130, ellipsis: true, render: (v: string) => v || '—' },
              { title: '订单状态', dataIndex: 'orderStatus', width: 90, render: (v: string) => <Tag>{v}</Tag> },
              { title: '货品总额', dataIndex: 'productAmount', width: 110, align: 'right' as const, render: (v: number) => money(Number(v) || 0) },
              { title: '付款时间', dataIndex: 'payTime', width: 150, render: (v: string) => String(v || '').slice(0, 19) || '—' },
              { title: '发货时间', dataIndex: 'shipTime', width: 150, render: (v: string) => String(v || '').slice(0, 19) || '—' },
              { title: '创建时间', dataIndex: 'createTime', width: 150, render: (v: string) => String(v || '').slice(0, 19) },
            ]}
            locale={{ emptyText: <Empty description="今日暂无订单" /> }}
          />
        )}
      </Modal>

      {/* 图表行 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>近6月销售额趋势</span>} style={{ borderRadius: 10 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              统计口径：按订单管理中<Text strong style={{ fontSize: 12, color: '#2d7a5f' }}>已付款订单</Text>统计（排除已取消与待付款订单），按付款月份归属、金额为订单货品总额；非按发货订单统计。
            </Text>
            <ReactECharts style={{ height: 260 }} option={{
              tooltip: { trigger: 'axis' },
              grid: { left: 50, right: 20, top: 30, bottom: 30 },
              xAxis: { type: 'category', data: stats.months },
              yAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)) } },
              series: [{
                type: 'bar', data: stats.trend, barWidth: 26,
                itemStyle: { color: PRIMARY, borderRadius: [4, 4, 0, 0] },
                label: { show: true, position: 'top', fontSize: 10, formatter: (p: any) => (p.value ? (p.value >= 10000 ? `${(p.value / 10000).toFixed(1)}万` : p.value) : '') },
              }],
            }} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>订单状态分布</span>} style={{ borderRadius: 10 }}>
            <ReactECharts style={{ height: 260 }} option={{
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

      {/* 生产订单看板（统计式：点击磁贴/节点标签弹出订单列表） */}
      <Card size="small" style={{ borderRadius: 10, marginBottom: 16 }}
        title={<span style={{ fontWeight: 600 }}>生产订单看板</span>}
        extra={
          <Space size={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>全部 {stats.prodTotal} · 超时 {poBoard.overdue.length} · 卡点 {poBoard.abnormal.length}</Text>
            <Button type="link" size="small" onClick={() => navigate('/production/production-order')}>查看全部</Button>
          </Space>
        }>
        <Row gutter={[12, 12]}>
          {[
            { label: '进行中订单', value: poBoard.active.length, color: PRIMARY, rows: poBoard.active },
            { label: '超时订单', value: poBoard.overdue.length, color: '#cf1322', rows: poBoard.overdue },
            { label: '卡点/异常订单', value: poBoard.abnormal.length, color: '#fa8c16', rows: poBoard.abnormal },
            { label: '本月完工', value: poBoard.monthDone.length, color: '#52c41a', rows: poBoard.monthDone },
          ].map(t => (
            <Col xs={12} sm={6} key={t.label}>
              <Tooltip title={`点击查看${t.label}列表`}>
                <div onClick={() => setPoListModal({ title: `${t.label}（${t.value} 单）`, rows: t.rows })}
                  style={{ cursor: 'pointer', background: '#fafcfd', border: '1px solid #eef2f6', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t.label}</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: t.color }}>{t.value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>单</span></div>
                </div>
              </Tooltip>
            </Col>
          ))}
        </Row>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>节点超时分布：</Text>
          {poBoard.nodeOverdue.length === 0 ? <Text type="secondary" style={{ fontSize: 12 }}>当前无节点超时</Text> : poBoard.nodeOverdue.map(n => (
            <Tag key={n.name} color="red" style={{ cursor: 'pointer', marginRight: 4 }}
              onClick={() => setPoListModal({ title: `「${n.name}」节点超时订单（${n.count} 单）`, rows: poBoard.overdue.filter((r: any) => r.over?.name === n.name) })}>
              {n.name}超时 {n.count} 单
            </Tag>
          ))}
        </div>
      </Card>
      {/* 生产订单统计列表弹窗 */}
      <Modal open={!!poListModal} title={poListModal?.title || ''} onCancel={() => setPoListModal(null)} width={900}
        footer={<Button type="primary" onClick={() => { setPoListModal(null); navigate('/production/production-order'); }}>前往生产订单</Button>}>
        <Table size="small" bordered rowKey={(r: any) => r.rec.key || r.rec.id} pagination={{ pageSize: 8, hideOnSinglePage: true }}
          dataSource={poListModal?.rows || []}
          columns={[
            { title: '订单号', dataIndex: 'id', width: 130, render: (v: string) => <Text strong style={{ color: '#1677ff' }}>{v}</Text> },
            { title: '客户', dataIndex: 'customer', width: 110, ellipsis: true },
            { title: '负责人', dataIndex: 'person', width: 80 },
            { title: '关联销售单', dataIndex: 'salesOrderId', width: 110, render: (v: string) => v || '—' },
            { title: '计划数量', dataIndex: 'planQty', width: 80, align: 'right' as const },
            { title: '完工数量', dataIndex: 'doneQty', width: 80, align: 'right' as const },
            { title: '当前节点', dataIndex: 'currentNode', width: 90 },
            {
              title: '超时/状态', key: 'over', width: 190, render: (_: any, r: any) => (r.over
                ? <Tag color="red">超时 {r.over.overDays} 天（预计{r.over.estimatedDays}/实际{r.over.actualDays.toFixed(1)}）</Tag>
                : (r.abnormal ? <Tag color="orange">卡点/异常</Tag> : (r.order.status === 'COMPLETED' ? <Tag color="green">已完工</Tag> : <Tag color="blue">进行中</Tag>)))
            },
            { title: '创建时间', dataIndex: 'createdAt', width: 100 },
          ]}
          locale={{ emptyText: <Empty description="暂无订单" /> }}
        />
      </Modal>

      {/* 明细行：最近订单 + 缺货预警 + 快捷入口 */}
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>最近订单</span>} extra={<Button type="link" size="small" onClick={() => navigate('/sales/order-manage')}>全部</Button>} style={{ borderRadius: 10 }}>
            <Table rowKey={(r: any) => r.id || r.key} size="small" bordered pagination={false}
              dataSource={stats.recentOrders} columns={recentCols}
              locale={{ emptyText: <Empty description="暂无订单" /> }} />
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card size="small" title={<span style={{ fontWeight: 600 }}>缺货预警（成品）</span>} style={{ borderRadius: 10 }}>
            {stats.stockout.length === 0 ? <Empty description="无缺货成品" /> : (
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {stats.stockout.slice(0, 10).map((p: any) => (
                  <div key={p.key || p.productCode} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 4px', borderBottom: '1px dashed #eee' }}>
                    <Text style={{ fontSize: 12 }} ellipsis>{p.productCode} {p.shortName || p.name || ''}</Text>
                    <Tag color="red" style={{ marginRight: 0 }}>库存 {Number(p.actualStock) || 0}</Tag>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={6}>
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

export default Dashboard;
