/**
 * 老板看板（财务管理-老板看板）：汇总老板日常最关心的经营指标
 * 口径与会计账薄数据源完全一致：
 * - 银行账户余额总和：pageData_finance_bank-account_<owner> 的 balance 合计；
 * - 客户欠款总和/供应商应付总和：customer_pay_summary / supplier_pay_summary 快照（采购−已收 / 采购−已付）；
 * - 原材料/半成品/成品库存总和：产品列表 actualStock × costPrice（含数量合计）；
 * - 上月工资发放总额：hr_salary_<owner> 上月 netPay 合计；
 * - 本月销售收入（供应商）/本月采购金额（采购商）：双端账单本月 totalAmount 合计；
 * - 本月银行收支：银行账户明细本月 in/out 合计。
 * 数据为本地存储快照，随同步事件/定时轮询自动刷新。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import {
  ReloadOutlined, BankOutlined, WalletOutlined, ShoppingCartOutlined,
  InboxOutlined, GoldOutlined, ExperimentOutlined, TeamOutlined, FundOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { getDataOwner } from '../utils/brandAuth';
import { readProductListSync } from '../utils/dataStore';
import { loadSupplierSummary, ensureSupplierSummaryBuilt, loadCustomerSummary, ensureCustomerSummaryBuilt, toYuan } from '../utils/paySummary';

const { Title, Text } = Typography;

interface StockAgg { amount: number; qty: number; count: number; }
interface Metrics {
  bankBalance: number; bankCount: number;
  arTotal: number; arCount: number;
  apTotal: number; apCount: number;
  raw: StockAgg; semi: StockAgg; finished: StockAgg;
  lastMonthSalary: number; lastMonthSalaryCount: number; lastMonthLabel: string;
  monthSales: number; monthSalesCount: number;
  monthIn: number; monthInCount: number; monthOut: number; monthOutCount: number;
  curMonthLabel: string;
}

const emptyStock = (): StockAgg => ({ amount: 0, qty: 0, count: 0 });

const calcMetrics = (owner: string): Metrics => {
  const m: Metrics = {
    bankBalance: 0, bankCount: 0,
    arTotal: 0, arCount: 0,
    apTotal: 0, apCount: 0,
    raw: emptyStock(), semi: emptyStock(), finished: emptyStock(),
    lastMonthSalary: 0, lastMonthSalaryCount: 0, lastMonthLabel: '',
    monthSales: 0, monthSalesCount: 0,
    monthIn: 0, monthInCount: 0, monthOut: 0, monthOutCount: 0,
    curMonthLabel: '',
  };
  const now = new Date();
  m.curMonthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  m.lastMonthLabel = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}`;
  // 银行账户余额总和 + 本月收支流水
  try {
    const bas: any[] = JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${owner}`) || '[]');
    (Array.isArray(bas) ? bas : []).forEach(b => {
      m.bankBalance += Number(b?.balance) || 0;
      m.bankCount += 1;
      ((b?.transactions || []) as any[]).forEach(t => {
        const mm = String(t?.date || t?.time || '').slice(0, 7);
        if (mm !== m.curMonthLabel) return;
        const amt = Number(t?.amount) || 0;
        if (t?.type === 'in' || t?.type === '收入') { m.monthIn += amt; m.monthInCount += 1; }
        else if (t?.type === 'out' || t?.type === '支出') { m.monthOut += amt; m.monthOutCount += 1; }
      });
    });
  } catch { /* ignore */ }
  // 客户欠款总和（应收−已收）
  try {
    ensureCustomerSummaryBuilt(owner, {});
    const map = loadCustomerSummary(owner);
    Object.values(map).forEach((e: any) => {
      const v = toYuan((e?.purchaseTotal || 0) - (e?.receivedTotal || 0));
      m.arTotal += v;
      if (v > 0.005) m.arCount += 1;
    });
  } catch { /* ignore */ }
  // 供应商应付总和（采购−已付）
  try {
    ensureSupplierSummaryBuilt(owner);
    const map = loadSupplierSummary(owner);
    Object.values(map).forEach((e: any) => {
      const v = toYuan((e?.purchaseTotal || 0) - (e?.paidTotal || 0));
      m.apTotal += v;
      if (v > 0.005) m.apCount += 1;
    });
  } catch { /* ignore */ }
  // 三类库存金额/数量
  try {
    const prods: any[] = readProductListSync(owner) || [];
    prods.forEach(p => {
      const qty = Number(p?.actualStock ?? p?.currentStock) || 0;
      const amt = qty * (Number(p?.costPrice) || 0);
      const bucket = p?.productType === '原材料' ? m.raw : p?.productType === '半成品' ? m.semi : p?.productType === '成品' ? m.finished : null;
      if (!bucket) return;
      bucket.qty += qty; bucket.amount += amt; bucket.count += 1;
    });
  } catch { /* ignore */ }
  // 上月工资发放总额
  try {
    const ss: any[] = JSON.parse(localStorage.getItem(`hr_salary_${owner}`) || '[]');
    (Array.isArray(ss) ? ss : []).forEach(r => {
      if (r?.month !== m.lastMonthLabel) return;
      m.lastMonthSalary += Number(r?.netPay) || 0;
      m.lastMonthSalaryCount += 1;
    });
  } catch { /* ignore */ }
  // 本月销售收入（供应商账单明细）+ 本月采购金额（采购商账单）
  try {
    const bills: any[] = JSON.parse(localStorage.getItem(`pageData_customer_bill-detail_${owner}`) || '[]');
    (Array.isArray(bills) ? bills : []).forEach(b => {
      if (String(b?.date || '').slice(0, 7) !== m.curMonthLabel) return;
      m.monthSales += Number(b?.totalAmount) || 0;
      m.monthSalesCount += 1;
    });
  } catch { /* ignore */ }
  try {
    const pb: any[] = JSON.parse(localStorage.getItem(`purchaser_bills_${owner}`) || '[]');
    (Array.isArray(pb) ? pb : []).forEach(b => {
      if (String(b?.date || '').slice(0, 7) !== m.curMonthLabel) return;
      m.monthSales += Number(b?.totalAmount) || 0;
      m.monthSalesCount += 1;
    });
  } catch { /* ignore */ }
  return m;
};

const CARD_BODY: React.CSSProperties = { padding: '16px 20px' };

const BossDashboard: React.FC = () => {
  const location = useLocation();
  const isPurchaser = location.pathname.startsWith('/purchaser');
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const refresh = useCallback(() => {
    setTick(t => t + 1);
    setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  }, []);
  useEffect(() => {
    refresh();
    const onUpd = () => refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('sync-data-updated', onUpd);
    window.addEventListener('storage', onUpd);
    window.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('sync-data-updated', onUpd);
      window.removeEventListener('storage', onUpd);
      window.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);
  const metrics = useMemo(() => calcMetrics(getDataOwner()), [tick]);
  const fmt = (v: number) => `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{ padding: 16, background: '#f0f2f5', minHeight: '100%' }}>
      <Card bodyStyle={{ padding: '12px 16px' }} style={{ marginBottom: 12 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space align="center">
            <FundOutlined style={{ fontSize: 20, color: '#1677ff' }} />
            <Title level={4} style={{ margin: 0 }}>老板看板</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>经营核心指标一览（{isPurchaser ? '采购商平台' : '供应商平台'}）{updatedAt ? ` · 更新于 ${updatedAt}` : ''}</Text>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
        </Space>
      </Card>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><BankOutlined style={{ color: '#1677ff' }} />银行账户余额总和</Space>} value={metrics.bankBalance} precision={2} prefix="¥" valueStyle={{ color: '#1677ff' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>共 {metrics.bankCount} 个账户</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><WalletOutlined style={{ color: '#f5222d' }} />客户欠款总和</Space>} value={metrics.arTotal} precision={2} prefix="¥" valueStyle={{ color: '#f5222d' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{metrics.arCount} 家客户存在欠款</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><ShoppingCartOutlined style={{ color: '#fa8c16' }} />供应商应付总和</Space>} value={metrics.apTotal} precision={2} prefix="¥" valueStyle={{ color: '#fa8c16' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{metrics.apCount} 家供应商待付款</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><TeamOutlined style={{ color: '#722ed1' }} />上月工资发放总额</Space>} value={metrics.lastMonthSalary} precision={2} prefix="¥" valueStyle={{ color: '#722ed1' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{metrics.lastMonthLabel} · {metrics.lastMonthSalaryCount} 条发放记录</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><InboxOutlined style={{ color: '#13c2c2' }} />原材料库存总和</Space>} value={metrics.raw.amount} precision={2} prefix="¥" valueStyle={{ color: '#13c2c2' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>数量合计 {metrics.raw.qty.toLocaleString('zh-CN')} · {metrics.raw.count} 种物料</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><ExperimentOutlined style={{ color: '#2f54eb' }} />半成品库存总和</Space>} value={metrics.semi.amount} precision={2} prefix="¥" valueStyle={{ color: '#2f54eb' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>数量合计 {metrics.semi.qty.toLocaleString('zh-CN')} · {metrics.semi.count} 种半成品</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><GoldOutlined style={{ color: '#faad14' }} />库存商品总和</Space>} value={metrics.finished.amount} precision={2} prefix="¥" valueStyle={{ color: '#faad14' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>数量合计 {metrics.finished.qty.toLocaleString('zh-CN')} · {metrics.finished.count} 种成品</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><FundOutlined style={{ color: '#52c41a' }} />{isPurchaser ? '本月采购金额' : '本月销售收入'}</Space>} value={metrics.monthSales} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{metrics.curMonthLabel} · {metrics.monthSalesCount} 笔账单</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><ArrowUpOutlined style={{ color: '#52c41a' }} />本月银行收入</Space>} value={metrics.monthIn} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{metrics.curMonthLabel} · {metrics.monthInCount} 笔收入</Text></Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bodyStyle={CARD_BODY}><Statistic title={<Space><ArrowDownOutlined style={{ color: '#ff4d4f' }} />本月银行支出</Space>} value={metrics.monthOut} precision={2} prefix="¥" valueStyle={{ color: '#ff4d4f' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{metrics.curMonthLabel} · {metrics.monthOutCount} 笔支出</Text></Card>
        </Col>
      </Row>
      <Card bodyStyle={{ padding: '10px 16px' }} style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          指标口径：银行余额/收支取银行账户与流水；客户欠款=采购总额−已收总额；供应商应付=采购总额−已付总额；库存金额=实际库存×成本价；上月工资=工资表上月实发合计；本月销售/采购取本月账单总额。数据随同步自动刷新，也可点击右上「刷新」。
        </Text>
      </Card>
    </div>
  );
};

export default BossDashboard;
