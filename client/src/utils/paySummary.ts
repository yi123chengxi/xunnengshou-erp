// 事件台账 + 增量聚合快照：采购金额/已付货款/应付欠款（采购商侧）、采购总额/已收货款（供应商侧）
// 设计目标：数据量增长后列表读取仍为 O(1)，不做全表遍历重算；零服务器请求（全部本地 localStorage）
// - 台账（append-only，唯一明细来源）：supplier_payments_<owner>（付货款）、customerReceipts_<owner>（收款，既有）
// - 快照（列表唯一读取来源）：supplier_pay_summary_<owner> / customer_pay_summary_<owner>
// - 金额一律以「分」整数存储与累加，仅显示时 /100，杜绝浮点误差随数据量积累
// - 写入原子化：台账+快照+银行明细同一函数同步完成，任一步异常整体回滚
// - 防漂移三层：写后自校验 / storage·sync 事件自愈 / 空闲分片巡检（requestIdleCallback 每次只校验一个对象）

import { buildCredIndex } from './nameSync';
import type { CredIndex } from './nameSync';
import { readFreshDataset } from './dataStore';

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

/**
 * 源表新鲜读（LS 与 IndexedDB 主存取较新者）：账单明细/采购账单等大表的主存是 IndexedDB，
 * localStorage 只是尽力缓存（预算淘汰/配额清理后会缺失或陈旧）。旧实现同步直读 LS，
 * 缓存缺失时算出 0 快照覆写正确值——采购总额「一会 0 一会正确」跳动的根因。
 * present=false 表示该键本地完全不存在（新设备未拉取/缓存被淘汰），调用方不得据此覆写快照。
 */
const readFreshRows = async (key: string): Promise<{ rows: any[]; present: boolean }> => {
  try {
    const fresh = await readFreshDataset(key);
    if (fresh !== null && fresh !== undefined) {
      const v = JSON.parse(fresh);
      return { rows: Array.isArray(v) ? v : [], present: true };
    }
  } catch { /* 主存读取失败回退 LS */ }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { rows: [], present: false };
    const v = JSON.parse(raw);
    return { rows: Array.isArray(v) ? v : [], present: true };
  } catch { return { rows: [], present: true }; }
};

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

// 目标主体名 → 身份键 → 基准目标名（同一身份命多个候选名时，取等于当前展示名的那个，
// 避免旧名条目与新名条目各自累加一份造成汇总翻倍）
// 匹配一律走主体身份键（账号 > 公司编号 > 改名链折叠后的名称），对方改名后历史行仍归同一主体；
// 无凭证行退名称匹配，与旧实现行为一致。
const buildTargetIndex = (names: Set<string>) => {
  const idx = buildCredIndex();
  const targetFor = new Map<string, string>();
  names.forEach(n => {
    const k = idx.identityOfName(n);
    if (!k) return;
    const prev = targetFor.get(k);
    if (!prev) { targetFor.set(k, n); return; }
    if (prev !== idx.currentNameOf(prev) && n === idx.currentNameOf(n)) targetFor.set(k, n);
  });
  return { idx, targetFor };
};

// 行 → 目标归属：先按凭证身份键；未命中再退纯名称身份键，
// 覆盖「同名多个独立账号」的行凭证被按名称补到另一账号的场景（凭证分叉但名称即主体），
// 不会重复计入：每行仍只命中一个目标。主/子账号同一主体由 buildCredIndex 归一保证。
const matchTarget = (
  idx: CredIndex, targetFor: Map<string, string>,
  p: { username?: any; no?: any; name?: any },
): string | undefined => {
  const k = idx.identity(p);
  const t = k ? targetFor.get(k) : undefined;
  if (t) return t;
  const nm = trimName(p?.name);
  if (!nm) return undefined;
  const k2 = idx.identity({ name: nm });
  return k2 && k2 !== k ? targetFor.get(k2) : undefined;
};

// ================= 采购商侧：供应商快照 =================
export const loadSupplierSummary = (owner: string): SummaryMap<SupplierSummaryEntry> => readJson(supplierSummaryKey(owner), {}) || {};
const ensureSup = (m: SummaryMap<SupplierSummaryEntry>, name: string): SupplierSummaryEntry => (m[name] || (m[name] = { purchaseTotal: 0, paidTotal: 0, paidCount: 0, updatedAt: '' }));
const payCents = (p: any): number => Number(p?.amountCents ?? toCents(p?.amount)) || 0;

// 供应商「采购金额」按主体身份键聚合（账号 > 编号 > 折叠名）：对方供应商改名后历史账单仍计入同一主体
// 返回 null = 账单源表本地完全缺失（大表缓存被淘汰/未拉取），调用方禁止用 0 覆写快照
const computeSupPurchaseCents = async (owner: string, targets: Set<string>): Promise<Map<string, number> | null> => {
  const per = new Map<string, number>();
  const { idx, targetFor } = buildTargetIndex(targets);
  const src = await readFreshRows(billsKey(owner));
  if (!src.present) return null;
  src.rows.forEach(b => {
    // 作废行保留但不计入采购总额统计
    if (b?.voided) return;
    const t = matchTarget(idx, targetFor, { username: b?.supplierUsername, no: b?.supplierNo, name: b?.supplier });
    if (!t) return;
    per.set(t, (per.get(t) || 0) + toCents(b?.totalAmount));
  });
  return per;
};

// 供应商「已付货款」按主体身份键聚合（付款台账行仅存名称，按改名链折叠后归一）
const computeSupPaidCents = (owner: string, targets: Set<string>): Map<string, { cents: number; count: number }> => {
  const per = new Map<string, { cents: number; count: number }>();
  const { idx, targetFor } = buildTargetIndex(targets);
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  pays.forEach(p => {
    const t = matchTarget(idx, targetFor, { username: p?.supplierUsername, no: p?.supplierNo, name: p?.supplierName });
    if (!t) return;
    const e = per.get(t) || { cents: 0, count: 0 };
    e.cents += payCents(p); e.count += 1;
    per.set(t, e);
  });
  return per;
};

// 按凭证计算单一供应商主体的采购/已付（分）：同名多家独立主体时名称聚合快照分不开彼此，
// 终止合作/删除等守卫必须按条目凭证（账号 > 公司编号）单独计算，不得读名称聚合值。
// 无凭证/凭证未注册时仅当名称唯一命中注册主体才退名称；同名歧义返回 null（调用方应阻止操作并提示补凭证）。
// 返回 null 亦表示账单源表本地缺失，调用方不得按 0 处理。
export const computeSupplierPartyCents = async (
  owner: string, party: { username?: string; no?: string; name?: string },
): Promise<{ purchase: number; paid: number } | null> => {
  const idx = buildCredIndex();
  let k = idx.identity({ username: party.username, no: party.no });
  if (!k.startsWith('u:')) {
    const kn = idx.identityOfName(trimName(party.name));
    if (!kn.startsWith('u:')) return null;
    k = kn;
  }
  const targetFor = new Map<string, string>([[k, 'party']]);
  const src = await readFreshRows(billsKey(owner));
  if (!src.present) return null;
  let purchase = 0;
  src.rows.forEach(b => {
    if (b?.voided) return;
    if (matchTarget(idx, targetFor, { username: b?.supplierUsername, no: b?.supplierNo, name: b?.supplier })) purchase += toCents(b?.totalAmount);
  });
  let paid = 0;
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  pays.forEach(p => {
    if (matchTarget(idx, targetFor, { username: p?.supplierUsername, no: p?.supplierNo, name: p?.supplierName })) paid += payCents(p);
  });
  return { purchase, paid };
};

// 单对象重算：指定供应商的「采购金额」（只遍历账单表一次，仅累加目标供应商）
export const refreshSupplierPurchase = async (owner: string, names: string[]): Promise<void> => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const per = await computeSupPurchaseCents(owner, targets);
  if (!per) return; // 源表缺失窗口不得把快照覆写为 0（跳动根因防线）
  const summary = loadSupplierSummary(owner);
  targets.forEach(n => { ensureSup(summary, n).purchaseTotal = 0; });
  per.forEach((cents, n) => { ensureSup(summary, n).purchaseTotal += cents; });
  targets.forEach(n => { ensureSup(summary, n).updatedAt = nowIso(); });
  writeJson(supplierSummaryKey(owner), summary);
};

// 单对象重算：指定供应商的「已付货款」（从付款台账累加）
export const refreshSupplierPaid = (owner: string, names: string[]) => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const summary = loadSupplierSummary(owner);
  targets.forEach(n => { const e = ensureSup(summary, n); e.paidTotal = 0; e.paidCount = 0; });
  computeSupPaidCents(owner, targets).forEach((v, n) => { const e = ensureSup(summary, n); e.paidTotal = v.cents; e.paidCount = v.count; });
  targets.forEach(n => { ensureSup(summary, n).updatedAt = nowIso(); });
  writeJson(supplierSummaryKey(owner), summary);
};

// 一次性迁移构建（仅快照键缺失时执行一次）：从账单+台账全量聚合
export const ensureSupplierSummaryBuilt = async (owner: string): Promise<void> => {
  if (localStorage.getItem(supplierSummaryKey(owner)) !== null) return;
  const billsSrc = await readFreshRows(billsKey(owner));
  if (!billsSrc.present) return; // 源表未落地/被淘汰：不建空快照，等拉取落地后由触发点补建
  const summary: SummaryMap<SupplierSummaryEntry> = {};
  const names = new Set<string>();
  billsSrc.rows.forEach(b => { const n = trimName(b?.supplier); if (n) names.add(n); });
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  pays.forEach(p => { const n = trimName(p?.supplierName); if (n) names.add(n); });
  const purchase = await computeSupPurchaseCents(owner, names);
  if (!purchase) return;
  purchase.forEach((cents, n) => { ensureSup(summary, n).purchaseTotal += cents; });
  computeSupPaidCents(owner, names).forEach((v, n) => { const e = ensureSup(summary, n); e.paidTotal = v.cents; e.paidCount = v.count; });
  Object.values(summary).forEach(e => { e.updatedAt = nowIso(); });
  writeJson(supplierSummaryKey(owner), summary);
};

// 修复：指定供应商两口径全重算（手动重算/巡检自愈共用）
export const repairSupplierSummary = async (owner: string, names: string[]): Promise<void> => {
  await refreshSupplierPurchase(owner, names);
  refreshSupplierPaid(owner, names);
};

// 校验快照与台账/账单是否一致（已付货款 + 采购金额双口径），不一致自动修复，返回修复名单（巡检/加载校验用）
// 预期值与 refresh 同源（同用身份键聚合），否则校验永远判不一致而反复重写
export const verifySupplierSummary = async (owner: string, names: string[]): Promise<string[]> => {
  const summary = loadSupplierSummary(owner);
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return [];
  const pays = computeSupPaidCents(owner, targets);
  const purchase = await computeSupPurchaseCents(owner, targets);
  const fixed: string[] = [];
  for (const n of Array.from(targets)) {
    const e = summary[n];
    // 条目整体缺失：两口径全重算修复
    if (!e) { await repairSupplierSummary(owner, [n]); fixed.push(n); continue; }
    const pv = pays.get(n) || { cents: 0, count: 0 };
    if (e.paidTotal !== pv.cents || e.paidCount !== pv.count) { refreshSupplierPaid(owner, [n]); fixed.push(n); }
    // 源表缺失（null）时跳过采购口径比对，避免把快照误判漂移后覆写为 0
    if (purchase && e.purchaseTotal !== (purchase.get(n) || 0)) { await refreshSupplierPurchase(owner, [n]); fixed.push(n); }
  }
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
  void ensureSupplierSummaryBuilt(input.owner);
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
// 过滤同样走身份键，保证改名前的付款能在当前供应商名下查到
export const loadSupplierPayments = (owner: string, supplierName: string): any[] => {
  const pays: any[] = readJson(supplierPaymentsKey(owner), []) || [];
  const idx = buildCredIndex();
  const want = idx.identityOfName(supplierName);
  const nm = trimName(supplierName);
  return pays
    .filter(p => {
      if (nm && trimName(p?.supplierName) === nm) return true;
      return !!want && matchTarget(idx, new Map([[want, want]]), { username: p?.supplierUsername, no: p?.supplierNo, name: p?.supplierName }) !== undefined;
    })
    .slice()
    .sort((a, b) => String(b.createdAt || b.payDate || '').localeCompare(String(a.createdAt || a.payDate || '')));
};

// ================= 供应商侧：客户快照 =================
export const loadCustomerSummary = (owner: string): SummaryMap<CustomerSummaryEntry> => readJson(customerSummaryKey(owner), {}) || {};
const ensureCus = (m: SummaryMap<CustomerSummaryEntry>, name: string): CustomerSummaryEntry => (m[name] || (m[name] = { purchaseTotal: 0, receivedTotal: 0, receivedCount: 0, updatedAt: '' }));

const billDetailKey = (owner: string) => `pageData_customer_bill-detail_${owner}`;
export { billDetailKey as customerBillDetailKey, ordersKey as customerOrdersKey, receiptsKey as customerReceiptsKey };

// 采购总额口径（与客户列表/账单明细页/剩余额度同源）：**只**统计该客户在账单明细中的行「金额」（totalAmount）合计，
// 含手工新增行与负数退货行；匹配走主体身份键，对方改名后历史行仍归同一主体。
// 账单未生成的订单不再回退计入采购总额：其在途金额由「订单占用」单独表达，
// 否则未发货余额支付订单会在剩余额度公式里被“采购总额 + 订单占用”双重扣减。
export const computePurchaseCents = async (owner: string, targets: Set<string>): Promise<Map<string, number> | null> => {
  const per = new Map<string, number>();
  const { idx, targetFor } = buildTargetIndex(targets);
  const src = await readFreshRows(billDetailKey(owner));
  // 账单明细源表本地完全缺失（大表缓存被淘汰/新设备未拉取）：返回 null，
  // 调用方不得把快照覆写为 0——采购总额「一会 0 一会正确」跳动的根因防线
  if (!src.present) return null;
  src.rows.forEach(b => {
    // 作废行保留但不计入客户采购总额统计
    if (b?.voided) return;
    const t = matchTarget(idx, targetFor, { username: b?.customerUsername, no: b?.customerNo, name: b?.customerName });
    if (!t) return;
    per.set(t, (per.get(t) || 0) + toCents(b?.totalAmount));
  });
  return per;
};

// 收款台账按客户累加（分）：先走主体身份键，再兼容 customerId→名映射与名称兜底
const computeReceivedCents = (owner: string, targets: Set<string>, idNameMap: Record<string, string>): Map<string, { cents: number; count: number }> => {
  const per = new Map<string, { cents: number; count: number }>();
  const { idx, targetFor } = buildTargetIndex(targets);
  const recs: any[] = readJson(receiptsKey(owner), []) || [];
  recs.forEach(r => {
    const mappedName = r?.customerId ? trimName(idNameMap[r.customerId]) : '';
    const t = matchTarget(idx, targetFor, { username: r?.customerUsername, no: r?.customerNo, name: mappedName || trimName(r?.customerName) });
    if (!t) return;
    const e = per.get(t) || { cents: 0, count: 0 };
    e.cents += toCents(r?.amount); e.count += 1;
    per.set(t, e);
  });
  return per;
};

// 收款台账行归属判定器（弹窗明细与快照同源）：身份键优先，ID/名称兜底
export const makeReceiptMatcher = (custName: string, custId?: string, idNameMap: Record<string, string> = {}) => {
  const idx = buildCredIndex();
  const nm = trimName(custName);
  const want = idx.identityOfName(nm);
  const id = trimName(custId);
  return (r: any): boolean => {
    if (id && trimName(r?.customerId) === id) return true;
    if (nm && trimName(r?.customerName) === nm) return true;
    if (!want) return false;
    const mappedName = r?.customerId ? trimName(idNameMap[r.customerId]) : '';
    return matchTarget(idx, new Map([[want, want]]), { username: r?.customerUsername, no: r?.customerNo, name: mappedName || trimName(r?.customerName) }) !== undefined;
  };
};

// 单客户取数（供「剩余额度」等跨页复用，杜绝另写一套近似公式造成口径漂移）
export const computeCustomerPurchaseCents = async (owner: string, name: string): Promise<number> => {
  const n = trimName(name);
  if (!n) return 0;
  const per = await computePurchaseCents(owner, new Set([n]));
  return per ? (per.get(n) || 0) : 0;
};
export const computeCustomerReceivedCents = (owner: string, name: string, idNameMap: Record<string, string> = {}): number => {
  const n = trimName(name);
  if (!n) return 0;
  return computeReceivedCents(owner, new Set([n]), idNameMap).get(n)?.cents || 0;
};

// 单对象重算：指定客户的「采购总额」（只遍历账单明细表一次）
export const refreshCustomerPurchase = async (owner: string, names: string[]): Promise<void> => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const per = await computePurchaseCents(owner, targets);
  if (!per) return; // 源表缺失窗口不得把快照覆写为 0（跳动根因防线）
  const summary = loadCustomerSummary(owner);
  targets.forEach(n => { ensureCus(summary, n).purchaseTotal = 0; });
  per.forEach((cents, n) => { ensureCus(summary, n).purchaseTotal += cents; });
  targets.forEach(n => { ensureCus(summary, n).updatedAt = nowIso(); });
  writeJson(customerSummaryKey(owner), summary);
};

// 单对象重算：指定客户的「已收货款」（从收款台账累加）
export const refreshCustomerReceived = (owner: string, names: string[], idNameMap: Record<string, string>) => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return;
  const summary = loadCustomerSummary(owner);
  targets.forEach(n => { const e = ensureCus(summary, n); e.receivedTotal = 0; e.receivedCount = 0; });
  computeReceivedCents(owner, targets, idNameMap).forEach((v, n) => { const e = ensureCus(summary, n); e.receivedTotal = v.cents; e.receivedCount = v.count; });
  targets.forEach(n => { ensureCus(summary, n).updatedAt = nowIso(); });
  writeJson(customerSummaryKey(owner), summary);
};

// 批量修复（挂载全量自愈用）：源表只各扫一遍、快照只写一次。
// 旧实现 verifyCustomerPurchase/verifyCustomerSummary 对每个不一致客户单独 refresh，
// 实际成本是「1 + 不一致客户数」次全表扫描 + 同等次数整键写盘，客户多时页面挂载明显卡顿。
export const repairCustomerSummaryBulk = async (owner: string, names: string[], idNameMap: Record<string, string>): Promise<string[]> => {
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return [];
  const summary = loadCustomerSummary(owner);
  const purchase = await computePurchaseCents(owner, targets);
  const received = computeReceivedCents(owner, targets, idNameMap);
  const fixed: string[] = [];
  let dirty = false;
  targets.forEach(n => {
    const e = summary[n];
    // 源表缺失（null）：采购口径保留快照现值，绝不用 0 覆写；已收口径仍按台账校正
    const p = purchase ? (purchase.get(n) || 0) : (e ? e.purchaseTotal : 0);
    const r = received.get(n) || { cents: 0, count: 0 };
    if (!e || e.purchaseTotal !== p || e.receivedTotal !== r.cents || e.receivedCount !== r.count) {
      const t = ensureCus(summary, n);
      t.purchaseTotal = p; t.receivedTotal = r.cents; t.receivedCount = r.count; t.updatedAt = nowIso();
      fixed.push(n); dirty = true;
    }
  });
  if (dirty) writeJson(customerSummaryKey(owner), summary);
  return fixed;
};

// 刷新调度器：把「一次批量操作连写多个键/多个事件」合并为一次重算，避免逐事件全表扫描。
// 同文档写入不发原生 storage 事件，故 pull 落地、发货广播都必须显式走这里。
let schedTimer: any = 0;
let schedOwner = '';
let schedNames = new Set<string>();
export const scheduleCustomerRefresh = (owner: string, names: string[], onDone: () => void, delayMs = 150): void => {
  if (schedOwner && schedOwner !== owner) { schedNames = new Set(); }
  schedOwner = owner;
  names.map(trimName).filter(Boolean).forEach(n => schedNames.add(n));
  if (schedTimer) clearTimeout(schedTimer);
  schedTimer = setTimeout(() => {
    schedTimer = 0;
    const o = schedOwner; const list = Array.from(schedNames);
    schedNames = new Set(); schedOwner = '';
    void (async () => {
      if (o && list.length) { try { await refreshCustomerPurchase(o, list); } catch { /* ignore */ } }
      try { onDone(); } catch { /* ignore */ }
    })();
  }, delayMs);
};

// 一次性迁移构建（客户快照）：idNameMap = 客户ID→名称（直接客户+合作采购商）
export const ensureCustomerSummaryBuilt = async (owner: string, idNameMap: Record<string, string>): Promise<void> => {
  if (localStorage.getItem(customerSummaryKey(owner)) !== null) return;
  const billsSrc = await readFreshRows(billDetailKey(owner));
  if (!billsSrc.present) return; // 源表未落地/被淘汰：不建空快照，等拉取落地后由触发点补建
  const summary: SummaryMap<CustomerSummaryEntry> = {};
  const names = new Set<string>();
  billsSrc.rows.forEach(b => { const n = trimName(b?.customerName); if (n) names.add(n); });
  const orders: any[] = readJson(ordersKey(owner), []) || [];
  orders.forEach(o => { const n = trimName(o?.customerName); if (n) names.add(n); });
  const recs: any[] = readJson(receiptsKey(owner), []) || [];
  recs.forEach(r => {
    const n = trimName(r?.customerId ? idNameMap[r.customerId] : r?.customerName);
    if (n) names.add(n);
  });
  const purchase = await computePurchaseCents(owner, names);
  if (!purchase) return;
  purchase.forEach((cents, n) => { ensureCus(summary, n).purchaseTotal += cents; });
  computeReceivedCents(owner, names, idNameMap).forEach((v, n) => { const e = ensureCus(summary, n); e.receivedTotal = v.cents; e.receivedCount = v.count; });
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
  const targets = new Set(names.map(trimName).filter(Boolean));
  if (!targets.size) return [];
  const expected = computeReceivedCents(owner, targets, idNameMap);
  const fixed: string[] = [];
  targets.forEach(n => {
    const e = summary[n];
    const v = expected.get(n) || { cents: 0, count: 0 };
    if (!e || e.receivedTotal !== v.cents || e.receivedCount !== v.count) { refreshCustomerReceived(owner, [n], idNameMap); fixed.push(n); }
  });
  return fixed;
};

// 校验客户采购总额快照与账单明细，不一致自动修复，返回修复名单（巡检用）
export const verifyCustomerPurchase = async (owner: string, names: string[]): Promise<string[]> => {
  const summary = loadCustomerSummary(owner);
  const fixed: string[] = [];
  const targets = new Set(names.map(trimName).filter(Boolean));
  const expected = await computePurchaseCents(owner, targets);
  if (!expected) return []; // 源表缺失窗口不做漂移判定，避免误修复为 0
  for (const raw of names) {
    const n = trimName(raw);
    if (!n) continue;
    const e = summary[n];
    const total = expected.get(n) || 0;
    if (!e || e.purchaseTotal !== total) { await refreshCustomerPurchase(owner, [n]); fixed.push(n); }
  }
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
