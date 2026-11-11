// 事件台账 + 增量聚合快照：采购金额/已付货款/应付欠款（采购商侧）、采购总额/已收货款（供应商侧）
// 设计目标：数据量增长后列表读取仍为 O(1)，不做全表遍历重算；零服务器请求（全部本地 localStorage）
// - 台账（append-only，唯一明细来源）：supplier_payments_<owner>（付货款）、customerReceipts_<owner>（收款，既有）
// - 快照（列表唯一读取来源）：supplier_pay_summary_<owner> / customer_pay_summary_<owner>
// - 金额一律以「分」整数存储与累加，仅显示时 /100，杜绝浮点误差随数据量积累
// - 写入原子化：台账+快照+银行明细同一函数同步完成，任一步异常整体回滚
// - 防漂移三层：写后自校验 / storage·sync 事件自愈 / 空闲分片巡检（requestIdleCallback 每次只校验一个对象）

export interface SupplierSummaryEntry { purchaseTotal: number; paidTotal: number; paidCount: number; updatedAt: string; }
export interface CustomerSummaryEntry { purchaseTotal: number; receivedTotal: number; receivedCount: number; updatedAt: string; }
export type SummaryMap<T> = Record<string, T>;

export const toCents = (v: any): number => Math.round((Number(v) || 0) * 100);
export const toYuan = (cents: number): number => (Number(cents) || 0) / 100;

const readJson = (key: string, fallback: any): any => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
};
const writeJson = (key: string, val: any) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } };

export const supplierSummaryKey = (owner: string) => `supplier_pay_summary_${owner}`;
export const supplierPaymentsKey = (owner: string) => `supplier_payments_${owner}`;
export const customerSummaryKey = (owner: string) => `customer_pay_summary_${owner}`;
const billsKey = (owner: string) => `purchaser_bills_${owner}`;
const ordersKey = (owner: string) => `pageData_sales_order-manage_${owner}`;
const receiptsKey = (owner: string) => `customerReceipts_${owner}`;
const bankKey = (owner: string) => `pageData_finance_bank-account_${owner}`;

const nowIso = () => new Date().toISOString();
const trimName = (n: any) => String(n || '').trim();
const fmtTime = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

// 订单是否计入采购总额（与客户基础信息既有口径一致：余额支付且非待付款）
export const orderPurchaseCents = (o: any): number => {
  if (!o || o.orderStatus === '待付款') return 0;
  const tags = `${o.orderTags || ''}${o.orderTag || ''}`;
  if (o.payMethod !== '余额支付' && !tags.includes('余额支付')) return 0;
  return toCents(o.productAmount);
};

// ================= 采购商侧：供应商快照 =================
export const loadSupplierSummary = (owner: string): SummaryMap<SupplierSummaryEntry> => readJson(supplierSummaryKey(owner), {}) || {};
const ensureSup = (m: SummaryMap<SupplierSummaryEntry>, name: string): SupplierSummaryEntry => (m[name] || (m[name] = { purchaseTotal: 0, paidTotal: 0, paidCount: 0, updatedAt: '' }));
const payCents = (p: any): number => Number(p?.amountCents ?? toCents(p?.amount)) || 0;

// 单对象重算：指定供应商的「采购金额」（只遍历账单表一次，仅累加目标供应商）
export const refreshSupplierPurchase = (owner: string, names: string[]) => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const summary = loadSupplierSummary(owner);
  targets.forEach(n => { ensureSup(summary, n).purchaseTotal = 0; });
  const bills: any[] = readJson(billsKey(owner), []) || [];
  bills.forEach(b => { const n = trimName(b?.supplier); if (targets.has(n)) ensureSup(summary, n).purchaseTotal += toCents(b?.totalAmount); });
  targets.forEach(n => { ensureSup(summary, n).updatedAt = nowIso(); });
  writeJson(supplierSummaryKey(owner), summary);
};

// 单对象重算：指定供应商的「已付货款」（从付款台账累加）
export const refreshSupplierPaid = (owner: string, names: string[]) => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const summary = loadSupplierSummary(owner);
  targets.forEach(n => { const e = ensureSup(summary, n); e.paidTotal = 0; e.paidCount = 0; });
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  pays.forEach(p => { const n = trimName(p?.supplierName); if (targets.has(n)) { const e = ensureSup(summary, n); e.paidTotal += payCents(p); e.paidCount += 1; } });
  targets.forEach(n => { ensureSup(summary, n).updatedAt = nowIso(); });
  writeJson(supplierSummaryKey(owner), summary);
};

// 一次性迁移构建（仅快照键缺失时执行一次）：从账单+台账全量聚合
export const ensureSupplierSummaryBuilt = (owner: string) => {
  if (localStorage.getItem(supplierSummaryKey(owner)) !== null) return;
  const summary: SummaryMap<SupplierSummaryEntry> = {};
  const bills: any[] = readJson(billsKey(owner), []) || [];
  bills.forEach(b => { ensureSup(summary, trimName(b?.supplier)).purchaseTotal += toCents(b?.totalAmount); });
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  pays.forEach(p => { const e = ensureSup(summary, trimName(p?.supplierName)); e.paidTotal += payCents(p); e.paidCount += 1; });
  Object.values(summary).forEach(e => { e.updatedAt = nowIso(); });
  writeJson(supplierSummaryKey(owner), summary);
};

// 修复：指定供应商两口径全重算（手动重算/巡检自愈共用）
export const repairSupplierSummary = (owner: string, names: string[]) => {
  refreshSupplierPurchase(owner, names);
  refreshSupplierPaid(owner, names);
};

// 校验快照与台账/账单是否一致（已付货款 + 采购金额双口径），不一致自动修复，返回修复名单（巡检/加载校验用）
export const verifySupplierSummary = (owner: string, names: string[]): string[] => {
  const summary = loadSupplierSummary(owner);
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  const bills: any[] = readJson(billsKey(owner), []) || [];
  const fixed: string[] = [];
  names.forEach(raw => {
    const n = trimName(raw);
    if (!n) return;
    const e = summary[n];
    // 条目整体缺失：两口径全重算修复
    if (!e) { repairSupplierSummary(owner, [n]); fixed.push(n); return; }
    let total = 0; let count = 0;
    pays.forEach(p => { if (trimName(p?.supplierName) === n) { total += payCents(p); count += 1; } });
    let purchase = 0;
    bills.forEach(b => { if (trimName(b?.supplier) === n) purchase += toCents(b?.totalAmount); });
    if (e.paidTotal !== total || e.paidCount !== count) { refreshSupplierPaid(owner, [n]); fixed.push(n); }
    if (e.purchaseTotal !== purchase) { refreshSupplierPurchase(owner, [n]); fixed.push(n); }
  });
  return fixed;
};

// 付货款原子写入：台账追加 + 快照增量 + 银行账户出账明细，任一步异常整体回滚
export interface SupplierPaymentInput {
  owner: string; supplierName: string; amountYuan: number; bankAccount: string;
  screenshot?: string; operator?: string;
}
export const recordSupplierPayment = (input: SupplierPaymentInput): { ok: boolean; msg?: string; key?: string } => {
  const cents = toCents(input.amountYuan);
  if (cents <= 0) return { ok: false, msg: '付款金额必须大于 0' };
  if (!trimName(input.supplierName)) return { ok: false, msg: '供应商缺失' };
  if (!trimName(input.bankAccount)) return { ok: false, msg: '请选择付款银行账户' };
  // 快照键缺失时先做一次性迁移构建，避免增量写入创建 purchaseTotal=0 的空条目
  ensureSupplierSummaryBuilt(input.owner);
  const payKey = supplierPaymentsKey(input.owner);
  const sumKey = supplierSummaryKey(input.owner);
  const bk = bankKey(input.owner);
  const backups: Array<[string, string | null]> = [
    [payKey, localStorage.getItem(payKey)],
    [sumKey, localStorage.getItem(sumKey)],
    [bk, localStorage.getItem(bk)],
  ];
  const rollback = () => backups.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
  try {
    const pays: any[] = readJson(payKey, []) || [];
    const banks: any[] = readJson(bk, []) || [];
    const acc = banks.find((b: any) => trimName(b?.name || b?.shortName) === trimName(input.bankAccount));
    const now = new Date();
    const rec = {
      key: `pay-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      supplierName: trimName(input.supplierName),
      amountCents: cents,
      amount: toYuan(cents),
      bankAccount: trimName(input.bankAccount),
      // 开户银行/银行账号随台账留存（明细弹窗展示用，账号显示时脱敏）
      bankName: acc?.bankName || '',
      bankAccountNo: acc?.bankAccountNo || '',
      screenshot: input.screenshot || '',
      payDate: fmtTime(now),
      operator: input.operator || '',
      createdAt: now.toISOString(),
    };
    pays.push(rec);
    writeJson(payKey, pays);
    const summary = loadSupplierSummary(input.owner);
    const e = ensureSup(summary, rec.supplierName);
    e.paidTotal += cents; e.paidCount += 1; e.updatedAt = nowIso();
    writeJson(sumKey, summary);
    // 银行账户出账明细（余额递减 + balanceAfter，与账户明细弹窗口径一致）
    if (acc) {
      const prev = Number(acc.balance) || 0;
      const nb = Math.round((prev - toYuan(cents)) * 100) / 100;
      acc.balance = nb;
      acc.transactions = [...(acc.transactions || []), {
        key: `txn-${now.getTime()}`, time: rec.payDate, type: 'out', amount: toYuan(cents),
        balanceAfter: nb, counterparty: rec.supplierName, orderNo: '', orderId: '',
        person: rec.operator || '', remark: `付货款 — ${rec.supplierName}`,
      }];
      writeJson(bk, banks);
    }
    return { ok: true, key: rec.key };
  } catch (err) {
    rollback();
    return { ok: false, msg: String((err as any)?.message || err) };
  }
};

// 付款明细（已付货款-明细弹窗数据源）：最近发生的付款排在最上面
export const loadSupplierPayments = (owner: string, supplierName: string): any[] => {
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  return pays
    .filter(p => trimName(p?.supplierName) === trimName(supplierName))
    .slice()
    .sort((a, b) => String(b.createdAt || b.payDate || '').localeCompare(String(a.createdAt || a.payDate || '')));
};

// ================= 供应商侧：客户快照 =================
export const loadCustomerSummary = (owner: string): SummaryMap<CustomerSummaryEntry> => readJson(customerSummaryKey(owner), {}) || {};
const ensureCus = (m: SummaryMap<CustomerSummaryEntry>, name: string): CustomerSummaryEntry => (m[name] || (m[name] = { purchaseTotal: 0, receivedTotal: 0, receivedCount: 0, updatedAt: '' }));
// 台账记录归属客户名：有 customerId 按 ID→名映射（与既有 manualOf 口径一致），无 ID 按名称
const receiptOwnerName = (r: any, idNameMap: Record<string, string>) => trimName(r?.customerId ? idNameMap[r.customerId] : r?.customerName);

const billDetailKey = (owner: string) => `pageData_customer_bill-detail_${owner}`;

// 采购总额口径（与客户列表/账单明细页一致）：优先按该客户账单明细行「商品总额」合计（含手工新增与负数退货行）；
// 仅当该客户无任何账单行时回退按余额支付订单（排除待付款）统计
const computePurchaseCents = (owner: string, targets: Set<string>): Map<string, number> => {
  const per = new Map<string, number>();
  const bills: any[] = readJson(billDetailKey(owner), []) || [];
  bills.forEach(b => { const n = trimName(b?.customerName); if (n && targets.has(n)) per.set(n, (per.get(n) || 0) + toCents(b?.totalAmount)); });
  const orders: any[] = readJson(ordersKey(owner), []) || [];
  orders.forEach(o => { const n = trimName(o?.customerName); if (n && targets.has(n) && !per.has(n)) per.set(n, orderPurchaseCents(o)); });
  return per;
};

// 单对象重算：指定客户的「采购总额」（遍历账单明细表一次；无账单行客户回退订单表）
export const refreshCustomerPurchase = (owner: string, names: string[]) => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const summary = loadCustomerSummary(owner);
  targets.forEach(n => { ensureCus(summary, n).purchaseTotal = 0; });
  computePurchaseCents(owner, targets).forEach((cents, n) => { ensureCus(summary, n).purchaseTotal += cents; });
  targets.forEach(n => { ensureCus(summary, n).updatedAt = nowIso(); });
  writeJson(customerSummaryKey(owner), summary);
};

// 单对象重算：指定客户的「已收货款」（从收款台账累加）
export const refreshCustomerReceived = (owner: string, names: string[], idNameMap: Record<string, string>) => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const summary = loadCustomerSummary(owner);
  targets.forEach(n => { const e = ensureCus(summary, n); e.receivedTotal = 0; e.receivedCount = 0; });
  const recs: any[] = readJson(receiptsKey(owner), []) || [];
  recs.forEach(r => {
    const n = receiptOwnerName(r, idNameMap);
    if (n && targets.has(n)) { const e = ensureCus(summary, n); e.receivedTotal += toCents(r?.amount); e.receivedCount += 1; }
  });
  targets.forEach(n => { ensureCus(summary, n).updatedAt = nowIso(); });
  writeJson(customerSummaryKey(owner), summary);
};

// 一次性迁移构建（客户快照）：idNameMap = 客户ID→名称（直接客户+合作采购商）
export const ensureCustomerSummaryBuilt = (owner: string, idNameMap: Record<string, string>) => {
  if (localStorage.getItem(customerSummaryKey(owner)) !== null) return;
  const summary: SummaryMap<CustomerSummaryEntry> = {};
  const names = new Set<string>();
  const bills: any[] = readJson(billDetailKey(owner), []) || [];
  bills.forEach(b => { const n = trimName(b?.customerName); if (n) names.add(n); });
  const orders: any[] = readJson(ordersKey(owner), []) || [];
  orders.forEach(o => { const n = trimName(o?.customerName); if (n) names.add(n); });
  computePurchaseCents(owner, names).forEach((cents, n) => { ensureCus(summary, n).purchaseTotal += cents; });
  const recs: any[] = readJson(receiptsKey(owner), []) || [];
  recs.forEach(r => {
    const n = receiptOwnerName(r, idNameMap);
    if (n) { const e = ensureCus(summary, n); e.receivedTotal += toCents(r?.amount); e.receivedCount += 1; }
  });
  Object.values(summary).forEach(e => { e.updatedAt = nowIso(); });
  writeJson(customerSummaryKey(owner), summary);
};

// 收款登记增量（O(1)）：台账追加后调用
export const incrementCustomerReceived = (owner: string, name: string, amountYuan: number) => {
  const n = trimName(name);
  if (!n) return;
  const summary = loadCustomerSummary(owner);
  const e = ensureCus(summary, n);
  e.receivedTotal += toCents(amountYuan); e.receivedCount += 1; e.updatedAt = nowIso();
  writeJson(customerSummaryKey(owner), summary);
};

// 校验客户已收货款快照与台账，不一致自动修复，返回修复名单（巡检用）
export const verifyCustomerSummary = (owner: string, names: string[], idNameMap: Record<string, string>): string[] => {
  const summary = loadCustomerSummary(owner);
  const recs: any[] = readJson(receiptsKey(owner), []) || [];
  const fixed: string[] = [];
  names.forEach(raw => {
    const n = trimName(raw);
    if (!n) return;
    const e = summary[n];
    let total = 0; let count = 0;
    recs.forEach(r => { if (receiptOwnerName(r, idNameMap) === n) { total += toCents(r?.amount); count += 1; } });
    if (!e || e.receivedTotal !== total || e.receivedCount !== count) { refreshCustomerReceived(owner, [n], idNameMap); fixed.push(n); }
  });
  return fixed;
};

// 校验客户采购总额快照与账单明细/订单表，不一致自动修复，返回修复名单（巡检用）
export const verifyCustomerPurchase = (owner: string, names: string[]): string[] => {
  const summary = loadCustomerSummary(owner);
  const fixed: string[] = [];
  const targets = new Set(names.map(trimName).filter(Boolean));
  const expected = computePurchaseCents(owner, targets);
  names.forEach(raw => {
    const n = trimName(raw);
    if (!n) return;
    const e = summary[n];
    const total = expected.get(n) || 0;
    if (!e || e.purchaseTotal !== total) { refreshCustomerPurchase(owner, [n]); fixed.push(n); }
  });
  return fixed;
};

// 空闲分片巡检：每次浏览器空闲只校验一个对象，循环轮转覆盖全部；UI 零感知、服务器零请求
export const startIdlePatrol = (opts: { getNames: () => string[]; verify: (name: string) => void; interval?: number }): (() => void) => {
  let idx = 0;
  let stopped = false;
  let timer: any = 0;
  const step = () => {
    if (stopped) return;
    try {
      const names = opts.getNames();
      if (names.length) { opts.verify(names[idx % names.length]); idx += 1; }
    } catch { /* ignore */ }
    schedule();
  };
  const schedule = () => {
    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') timer = ric(step, { timeout: opts.interval || 20000 });
    else timer = setTimeout(step, opts.interval || 20000);
  };
  schedule();
  return () => {
    stopped = true;
    const cic = (window as any).cancelIdleCallback;
    if (typeof cic === 'function' && timer) cic(timer); else clearTimeout(timer);
  };
};
