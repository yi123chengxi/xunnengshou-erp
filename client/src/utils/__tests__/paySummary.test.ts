// 财务快照口径单测：金额以「分」整数累加、账单行优先/订单回退、改名不拆主体、校验与重算同源
import {
  toCents, toYuan, orderPurchaseCents,
  computePurchaseCents, computeCustomerPurchaseCents, computeCustomerReceivedCents,
  refreshCustomerPurchase, refreshCustomerReceived, loadCustomerSummary,
  repairCustomerSummaryBulk, verifyCustomerPurchase, verifyCustomerSummary,
  incrementCustomerReceived, makeReceiptMatcher, scheduleCustomerRefresh,
  refreshSupplierPurchase, refreshSupplierPaid, loadSupplierSummary, verifySupplierSummary,
  loadSupplierPayments,
} from '../paySummary';

const OWNER = 'supA';
const K_BILLS = `pageData_customer_bill-detail_${OWNER}`;
const K_ORDERS = `pageData_sales_order-manage_${OWNER}`;
const K_RECEIPTS = `customerReceipts_${OWNER}`;
const K_SUMMARY = `customer_pay_summary_${OWNER}`;
const K_SUP_BILLS = `purchaser_bills_${OWNER}`;
const K_SUP_PAY = `supplier_payments_${OWNER}`;
const K_SUP_SUMMARY = `supplier_pay_summary_${OWNER}`;

/** 注册账号表：u1 已改名（旧名→新名）；未注册主体只能按名称归一 */
const seedUsers = () => {
  localStorage.setItem('registeredUsers', JSON.stringify([
    { username: 'u1', companyName: '甲公司新名', companyShortName: '甲公司', companyNo: 'N1' },
  ]));
  localStorage.setItem('company_renames', JSON.stringify([
    { key: 'r1', username: 'u1', oldName: '甲公司旧名', newName: '甲公司新名', ts: 1000 },
  ]));
};

const put = (key: string, val: any) => localStorage.setItem(key, JSON.stringify(val));

beforeEach(() => {
  localStorage.clear();
  seedUsers();
});

describe('金额与订单口径基础函数', () => {
  it('金额以分整数累加，杜绝浮点误差', () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
    expect(toYuan(30)).toBe(0.3);
    expect(toCents('12.34')).toBe(1234);
    expect(toCents(null)).toBe(0);
    expect(toCents('abc')).toBe(0);
  });

  it('仅余额支付且非待付款的订单计入采购总额', () => {
    expect(orderPurchaseCents({ orderStatus: '已完成', payMethod: '余额支付', productAmount: 1234.56 })).toBe(123456);
    expect(orderPurchaseCents({ orderStatus: '待付款', payMethod: '余额支付', productAmount: 100 })).toBe(0);
    expect(orderPurchaseCents({ orderStatus: '已完成', payMethod: '微信支付', productAmount: 100 })).toBe(0);
    expect(orderPurchaseCents({ orderStatus: '已完成', payMethod: '微信支付', orderTags: '余额支付,加急', productAmount: 100 })).toBe(10000);
    expect(orderPurchaseCents(null)).toBe(0);
  });
});

describe('computePurchaseCents 采购总额', () => {
  it('有账单行时以账单行为准（含负数退货行），不回退订单表', () => {
    put(K_BILLS, [
      { customerName: '甲公司新名', totalAmount: 1000.5 },
      { customerName: '甲公司旧名', totalAmount: -200.25 },
    ]);
    put(K_ORDERS, [{ customerName: '甲公司新名', orderStatus: '已完成', payMethod: '余额支付', productAmount: 9999 }]);
    const per = computePurchaseCents(OWNER, new Set(['甲公司新名']));
    expect(per.get('甲公司新名')).toBe(80025);
  });

  it('无账单行时回退订单表：0 值首单不得吞掉后续订单，多单必须累加（批次1回归）', () => {
    put(K_BILLS, []);
    put(K_ORDERS, [
      { customerName: '乙公司', orderStatus: '待付款', payMethod: '余额支付', productAmount: 500 },
      { customerName: '乙公司', orderStatus: '已发货', payMethod: '余额支付', productAmount: 300 },
      { customerName: '乙公司', orderStatus: '已完成', payMethod: '微信支付', productAmount: 700 },
      { customerName: '乙公司', orderStatus: '已发货', payMethod: '余额支付', productAmount: 25.5 },
    ]);
    expect(computePurchaseCents(OWNER, new Set(['乙公司'])).get('乙公司')).toBe(32550);
  });

  it('目标集合内含两个账单行的客户各自独立汇总，互不串账', () => {
    put(K_BILLS, [
      { customerName: '甲公司新名', totalAmount: 100 },
      { customerName: '乙公司', totalAmount: 200 },
      { customerName: '丙公司', totalAmount: 300 },
    ]);
    const per = computePurchaseCents(OWNER, new Set(['甲公司新名', '乙公司']));
    expect(per.get('甲公司新名')).toBe(10000);
    expect(per.get('乙公司')).toBe(20000);
    expect(per.has('丙公司')).toBe(false);
  });

  it('改名前后名称同时出现在目标集时只保留一个条目，金额不翻倍（批次3回归）', () => {
    put(K_BILLS, [
      { customerName: '甲公司旧名', totalAmount: 60 },
      { customerName: '甲公司新名', totalAmount: 40 },
    ]);
    const per = computePurchaseCents(OWNER, new Set(['甲公司旧名', '甲公司新名']));
    expect(per.size).toBe(1);
    expect(per.get('甲公司新名')).toBe(10000);
    expect(Array.from(per.values())).toEqual([10000]);
  });

  it('单客户取数与快照重算严格同源', () => {
    put(K_BILLS, [{ customerName: '甲公司新名', totalAmount: 800.25 }]);
    refreshCustomerPurchase(OWNER, ['甲公司新名']);
    const snap = loadCustomerSummary(OWNER)['甲公司新名'];
    expect(snap.purchaseTotal).toBe(80025);
    expect(computeCustomerPurchaseCents(OWNER, '甲公司新名')).toBe(snap.purchaseTotal);
  });

  it('重复重算幂等，不会逐次累加', () => {
    put(K_BILLS, [{ customerName: '甲公司新名', totalAmount: 100 }]);
    refreshCustomerPurchase(OWNER, ['甲公司新名']);
    refreshCustomerPurchase(OWNER, ['甲公司新名']);
    expect(loadCustomerSummary(OWNER)['甲公司新名'].purchaseTotal).toBe(10000);
  });

  it('空白名称被忽略，不产生垃圾条目', () => {
    put(K_BILLS, [{ customerName: '', totalAmount: 100 }]);
    refreshCustomerPurchase(OWNER, ['', '   ']);
    expect(Object.keys(loadCustomerSummary(OWNER)).length).toBe(0);
  });
});

describe('已收货款与收款明细判定', () => {
  it('台账按身份键归一：改名前的收款仍计入当前客户名下', () => {
    put(K_RECEIPTS, [
      { customerName: '甲公司旧名', amount: 500 },
      { customerId: 'c9', amount: 250 },
      { customerName: '乙公司', amount: 999 },
    ]);
    const idNameMap = { c9: '甲公司新名' };
    expect(computeCustomerReceivedCents(OWNER, '甲公司新名', idNameMap)).toBe(75000);
    refreshCustomerReceived(OWNER, ['甲公司新名'], idNameMap);
    const e = loadCustomerSummary(OWNER)['甲公司新名'];
    expect(e.receivedTotal).toBe(75000);
    expect(e.receivedCount).toBe(2);
  });

  it('makeReceiptMatcher 命中 ID 直配、名称直配与改名后身份配', () => {
    put(K_RECEIPTS, [
      { customerName: '甲公司旧名', amount: 500 },
      { customerId: 'c9', amount: 250 },
      { customerName: '乙公司', amount: 10 },
    ]);
    const idNameMap = { c9: '甲公司新名' };
    const rows: any[] = JSON.parse(localStorage.getItem(K_RECEIPTS) || '[]');
    expect(rows.filter(makeReceiptMatcher('甲公司新名', 'c9', idNameMap))).toHaveLength(2);
    expect(rows.filter(makeReceiptMatcher('甲公司旧名', 'c9', idNameMap))).toHaveLength(2);
    expect(rows.filter(makeReceiptMatcher('乙公司', undefined, idNameMap))).toHaveLength(1);
    expect(rows.filter(makeReceiptMatcher('路人公司', undefined, idNameMap))).toHaveLength(0);
  });

  it('收款登记增量结果与台账全量重算一致', () => {
    put(K_RECEIPTS, [{ customerName: '甲公司新名', amount: 500 }]);
    refreshCustomerReceived(OWNER, ['甲公司新名'], {});
    const rows: any[] = JSON.parse(localStorage.getItem(K_RECEIPTS) || '[]');
    rows.push({ customerName: '甲公司新名', amount: 120.5 });
    put(K_RECEIPTS, rows);
    incrementCustomerReceived(OWNER, '甲公司新名', 120.5);
    expect(loadCustomerSummary(OWNER)['甲公司新名'].receivedTotal)
      .toBe(computeCustomerReceivedCents(OWNER, '甲公司新名', {}));
  });
});

describe('快照校验与批量修复（巡检自愈）', () => {
  it('快照与源表一致时校验返回空名单，不得反复重写', () => {
    put(K_BILLS, [{ customerName: '甲公司新名', totalAmount: 100 }]);
    put(K_RECEIPTS, [{ customerName: '甲公司新名', amount: 30 }]);
    refreshCustomerPurchase(OWNER, ['甲公司新名']);
    refreshCustomerReceived(OWNER, ['甲公司新名'], {});
    const names = ['甲公司新名'];
    expect(verifyCustomerPurchase(OWNER, names)).toEqual([]);
    expect(verifyCustomerSummary(OWNER, names, {})).toEqual([]);
  });

  it('快照漂移后被修复回源表口径', () => {
    put(K_BILLS, [{ customerName: '甲公司新名', totalAmount: 100 }]);
    put(K_RECEIPTS, []);
    put(K_SUMMARY, { '甲公司新名': { purchaseTotal: 1, receivedTotal: 999, receivedCount: 3, updatedAt: '' } });
    const names = ['甲公司新名'];
    expect(verifyCustomerPurchase(OWNER, names)).toEqual(names);
    expect(verifyCustomerSummary(OWNER, names, {})).toEqual(names);
    const e = loadCustomerSummary(OWNER)['甲公司新名'];
    expect(e.purchaseTotal).toBe(10000);
    expect(e.receivedTotal).toBe(0);
    expect(e.receivedCount).toBe(0);
  });

  it('批量修复返回名单且第二次为幂等空操作', () => {
    put(K_BILLS, [
      { customerName: '甲公司新名', totalAmount: 100 },
      { customerName: '乙公司', totalAmount: 200 },
    ]);
    put(K_RECEIPTS, [{ customerName: '乙公司', amount: 50 }]);
    put(K_SUMMARY, {});
    const names = ['甲公司新名', '乙公司'];
    const fixed = repairCustomerSummaryBulk(OWNER, names, {});
    // 不依赖中文排序顺序，只断言「两个客户均被列入修复名单」
    expect(fixed).toHaveLength(2);
    expect(fixed).toContain('甲公司新名');
    expect(fixed).toContain('乙公司');
    const s = loadCustomerSummary(OWNER);
    expect(s['甲公司新名'].purchaseTotal).toBe(10000);
    expect(s['乙公司'].purchaseTotal).toBe(20000);
    expect(s['乙公司'].receivedTotal).toBe(5000);
    expect(repairCustomerSummaryBulk(OWNER, names, {})).toEqual([]);
  });

  it('空目标名单不触发任何写入', () => {
    expect(repairCustomerSummaryBulk(OWNER, [], {})).toEqual([]);
    expect(localStorage.getItem(K_SUMMARY)).toBeNull();
  });
});

describe('刷新调度器合并（防逐事件全表扫描）', () => {
  it('连发多次调度只重算一次并合并客户名单', async () => {
    put(K_BILLS, [
      { customerName: '甲公司新名', totalAmount: 100 },
      { customerName: '乙公司', totalAmount: 200 },
    ]);
    put(K_SUMMARY, {});
    let doneCount = 0;
    const onDone = () => { doneCount += 1; };
    scheduleCustomerRefresh(OWNER, ['甲公司新名'], onDone, 50);
    scheduleCustomerRefresh(OWNER, ['乙公司'], onDone, 50);
    // 等待窗口留足余量：CI runner 上多个 suite 并行时定时器回调可能被阻塞
    await new Promise(r => setTimeout(r, 1500));
    expect(doneCount).toBe(1);
    const s = loadCustomerSummary(OWNER);
    expect(s['甲公司新名'].purchaseTotal).toBe(10000);
    expect(s['乙公司'].purchaseTotal).toBe(20000);
  });
});

describe('供应商侧快照同源', () => {
  it('采购金额与已付货款分别聚合，校验一致后不再重写', () => {
    put(K_SUP_BILLS, [
      { supplier: '乙供应商', totalAmount: 1200.34, supplierNo: 'S1' },
      { supplier: '乙供应商', totalAmount: 0.66, supplierNo: 'S1' },
      { supplier: '丙供应商', totalAmount: 700 },
    ]);
    put(K_SUP_PAY, [
      { supplierName: '乙供应商', amount: 500 },
      { supplierName: '乙供应商', amountCents: 25000 },
    ]);
    const names = ['乙供应商'];
    refreshSupplierPurchase(OWNER, names);
    refreshSupplierPaid(OWNER, names);
    const e = loadSupplierSummary(OWNER)['乙供应商'];
    expect(e.purchaseTotal).toBe(120100);
    expect(e.paidTotal).toBe(75000);
    expect(e.paidCount).toBe(2);
    expect(verifySupplierSummary(OWNER, names)).toEqual([]);
  });

  it('付款明细按身份键归一，改名前的付款仍可查到', () => {
    put(K_SUP_PAY, [
      { supplierName: '乙供应商', amount: 500, createdAt: '2026-01-01T00:00:00.000Z' },
      { supplierName: '乙供应商', amount: 300, createdAt: '2026-02-01T00:00:00.000Z' },
      { supplierName: '丙供应商', amount: 100, createdAt: '2026-03-01T00:00:00.000Z' },
    ]);
    const list = loadSupplierPayments(OWNER, '乙供应商');
    expect(list).toHaveLength(2);
    expect(String(list[0].supplierName)).toBe('乙供应商');
  });
});
