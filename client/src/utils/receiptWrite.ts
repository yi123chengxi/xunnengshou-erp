// 订单分段付款共享写入模块（供应商侧收款 / 采购商侧付款双账套联动）
// 设计要点：
// - 分段台账 payRecords 按 record.key 双向 union 合并（采购商推送订单真值源在 purchaser_pushed_orders）
// - 每笔分期的账套联动（银行明细 + 会计分录/日常记账 + 客户已收/供应商已付台账）按「登记方+对方合并补记」双通道写入，
//   幂等防护键 installment_posted_<owner>（tag = <side>-<recordKey>），重复轮询/重登不重复写
// - 会计分录依赖 writeAutoEntries 的 sourceKey 幂等（同键先删旧再写新）
// - 硬约束：本模块任何路径都不写账单明细/对账键（分段金额不入账单）
import { isAccountingMode, writeAutoEntries, pushBankTransaction } from './accountingBridge';
import { resolveCompanyCred } from './nameSync';
import {
  incrementCustomerReceived, recordSupplierPayment, refreshSupplierPaid, supplierPaymentsKey, toCents,
} from './paySummary';

export interface PayRecord {
  key: string;
  time: string;
  amount: number;
  account: string;          // 银行账户名称（登记方选择）
  screenshot?: string;
  note?: string;
  operator: string;
  side: 'supplier' | 'purchaser'; // 登记方身份
  status?: 'pending_confirm' | 'confirmed'; // 尾款登记待收款确认；确认后计入累计已收
  confirmedAt?: string;
  confirmedBy?: string;
}

// ============ 订单分段判定与金额口径 ============

/** 分段付款订单判定（兼容仅写了 payMethod 的推送单） */
export const isInstallmentOrder = (o: any): boolean =>
  !!o && (o.payPlan === 'installment' || o.payMethod === '分段付款');

/** 定金比例（缺省 30%） */
export const depositRatioOf = (o: any): number => {
  const r = Number(o?.depositRatio);
  return r > 0 && r <= 100 ? r : 30;
};

/** 定金金额（元，保留 2 位）= 订单总额 × 比例 */
export const depositAmountOf = (o: any, total: number): number =>
  Math.round((Number(total) || 0) * depositRatioOf(o)) / 100;

/** 计入累计已收的记录（待确认的尾款登记不计入） */
export const isCountedRecord = (r: any): boolean => !!r && r.status !== 'pending_confirm';

/** 分期台账合计（元，保留 2 位；仅统计已确认记录） */
export const sumPayRecords = (list: any[]): number =>
  Math.round((list || []).filter(isCountedRecord).reduce((s: number, r: any) => s + (Number(r?.amount) || 0), 0) * 100) / 100;

/**
 * 分段付款订单应收足后的目标状态：
 * - 已收 ≥ 总额 → 已付款；
 * - 已收 ≥ 定金 → 部分付款（可安排生产，不可审核/发货）；
 * - 未达定金 → null（保持待付款）。
 */
export const installmentStatusOf = (o: any, total: number, paid: number): string | null => {
  const t = Math.round((Number(total) || 0) * 100) / 100;
  const p = Math.round((Number(paid) || 0) * 100) / 100;
  if (t <= 0 || p <= 0) return null;
  if (p + 0.001 >= t) return '已付款';
  if (p + 0.001 >= depositAmountOf(o, t)) return '部分付款';
  return null;
};

/** 按 record.key union 合并（同键以先出现者为准），按时间升序 */
export const mergePayRecords = (existing: any[], incoming: any[]): any[] => {
  const map = new Map<string, any>();
  [...(existing || []), ...(incoming || [])].forEach(r => { if (r && r.key && !map.has(r.key)) map.set(r.key, r); });
  return Array.from(map.values()).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
};

/** 付款进度文本：¥300/¥1000 (30%) */
export const payProgressText = (paid: number, total: number): string => {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return `¥${(Number(paid) || 0).toFixed(2)}/¥${(Number(total) || 0).toFixed(2)} (${pct}%)`;
};

// ============ 幂等防护集合 ============

const postedKey = (owner: string) => `installment_posted_${owner}`;
const readPosted = (owner: string): Record<string, boolean> => {
  try { const v = JSON.parse(localStorage.getItem(postedKey(owner)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
export const isPosted = (owner: string, tag: string): boolean => !!readPosted(owner)[tag];
const markPosted = (owner: string, tag: string): void => {
  const m = readPosted(owner); m[tag] = true;
  try { localStorage.setItem(postedKey(owner), JSON.stringify(m)); } catch { /* ignore */ }
};

// ============ 本地存储助手 ============

const readJson = (key: string, fallback: any): any => {
  try { const raw = localStorage.getItem(key); if (raw === null) return fallback; const v = JSON.parse(raw); return v == null ? fallback : v; } catch { return fallback; }
};
const writeJson = (key: string, val: any): void => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } };

/** 日常记账凭证号：PZ-YYYYMMDD-XXX 当日递增 */
const dailyVoucherNo = (books: any[], date: string): string => {
  const prefix = `PZ-${date.replace(/-/g, '')}`;
  const seqs = books.map((b: any) => String(b.voucherNo || '')).filter((v: string) => v.startsWith(prefix)).map((v: string) => parseInt(v.slice(-3), 10) || 0);
  return `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`;
};

/** 日常记账登记（幂等键=记录 key，写入前过滤同键旧记录） */
const writeDailyRecord = (owner: string, rec: { key: string; bookType: '收入' | '支出'; category: string; amount: number; counterparty: string; remark: string; person: string; image?: string }): void => {
  const bkKey = `daily_bookkeeping_${owner}`;
  const books: any[] = readJson(bkKey, []);
  if (books.some((b: any) => b.key === rec.key)) return;
  const today = new Date().toISOString().slice(0, 10);
  books.unshift({
    key: rec.key,
    voucherNo: dailyVoucherNo(books, today),
    bookDate: today,
    bookType: rec.bookType,
    category: rec.category,
    amount: rec.amount,
    counterparty: rec.counterparty,
    remark: rec.remark,
    person: rec.person,
    image: rec.image || '',
    autoSourceKey: rec.key,
    createdAt: new Date().toISOString(),
  });
  writeJson(bkKey, books);
};

// ============ 分期登记的双侧账套联动 ============

export interface PostInstallmentOpts {
  owner: string;                 // 当前账套 owner（写入方自己的租户）
  side: 'supplier' | 'purchaser'; // 本次写入的账套侧（供应商=收款账 / 采购商=付款账）
  orderId: string;
  record: PayRecord;
  counterparty: string;          // 供应商侧=客户名称；采购商侧=供应商公司名
  customerId?: string;
}

/**
 * 单笔分期的账套联动（银行明细 + 台账 + 会计分录/日常记账），整段幂等。
 * 供应商侧：银行收入 + customerReceipts 台账 + 已收货款快照；分录 借银行存款/贷预收账款。
 * 采购商侧：recordSupplierPayment 原子写（付款台账+已付快照+银行出账）；分录 借预付账款/贷银行存款。
 * 摘要/备注统一带订单号。
 */
export const postInstallmentEffects = (opts: PostInstallmentOpts): { ok: boolean; msg?: string } => {
  const { owner, side, orderId, record, counterparty, customerId } = opts;
  const amt = Math.round((Number(record?.amount) || 0) * 100) / 100;
  if (!record?.key || amt <= 0) return { ok: false, msg: '分期金额无效' };
  const tag = `${side}-${record.key}`;
  if (isPosted(owner, tag)) return { ok: true };

  // 1) 银行明细 + 业务台账
  if (side === 'supplier') {
    if (record.account) pushBankTransaction(owner, record.account, 'in', amt, `订单收款 — ${orderId}`, record.operator, record.time);
    const rk = `customerReceipts_${owner}`;
    const list: any[] = readJson(rk, []);
    if (!list.some((r: any) => r.key === `cr-${record.key}`)) {
      // 第一阶段凭证铺垫：台账行落客户账号+公司编号（改名稳定，第二阶段 join 换轨以凭证为准）
      const rwCred = resolveCompanyCred(counterparty);
      list.unshift({
        key: `cr-${record.key}`,
        customerName: counterparty,
        customerId: customerId || '',
        customerUsername: rwCred?.username || '',
        customerNo: rwCred?.companyNo || '',
        amount: amt,
        receiptDate: String(record.time || '').slice(0, 10),
        operator: record.operator || '',
        source: 'order-installment',
        orderId,
        screenshot: record.screenshot || '',
        createdAt: new Date().toISOString(),
      });
      writeJson(rk, list);
      incrementCustomerReceived(owner, counterparty, amt);
      // 同文档广播：保活的客户列表页据此重载收款台账（否则已收货款明细弹窗空白，需刷新浏览器）
      try { window.dispatchEvent(new CustomEvent('customer-receipts-updated', { detail: { owner, key: rk } })); } catch { /* ignore */ }
    }
  } else {
    const res = record.account
      ? recordSupplierPayment({ owner, supplierName: counterparty, amountYuan: amt, bankAccount: record.account, screenshot: record.screenshot || '', operator: record.operator || '' })
      : { ok: false as const };
    if (!res.ok) {
      // 付款账户缺失（对方代登记场景）：仅写付款台账 + 单对象重算快照，不写银行明细
      const pk = supplierPaymentsKey(owner);
      const list: any[] = readJson(pk, []);
      if (!list.some((p: any) => p.key === `pay-${record.key}`)) {
        list.push({
          key: `pay-${record.key}`,
          supplierName: counterparty,
          amountCents: toCents(amt),
          amount: amt,
          bankAccount: record.account || '',
          bankName: '',
          bankAccountNo: '',
          screenshot: record.screenshot || '',
          payDate: record.time || '',
          operator: record.operator || '',
          orderId,
          createdAt: new Date().toISOString(),
        });
        writeJson(pk, list);
        refreshSupplierPaid(owner, [counterparty]);
      }
    }
  }

  // 2) 会计分录 / 日常记账（账薄模式互斥双路）
  if (isAccountingMode(owner)) {
    if (side === 'supplier') {
      writeAutoEntries(owner, {
        sourceKey: `recv-${orderId}-${record.key}`,
        debitSubject: '银行存款', creditSubject: '预收账款',
        amount: amt, summary: orderId, bookkeeper: record.operator || '',
      });
    } else {
      writeAutoEntries(owner, {
        sourceKey: `pay-${orderId}-${record.key}`,
        debitSubject: '预付账款', creditSubject: '银行存款',
        amount: amt, summary: orderId, bookkeeper: record.operator || '',
      });
    }
  } else if (side === 'supplier') {
    writeDailyRecord(owner, {
      key: `bk-inst-recv-${record.key}`, bookType: '收入', category: '主营业务收入-销售收入',
      amount: amt, counterparty, remark: `订单收款 ${orderId}`, person: record.operator || '', image: record.screenshot,
    });
  } else {
    writeDailyRecord(owner, {
      key: `bk-inst-pay-${record.key}`, bookType: '支出', category: '销售费用-采购支出',
      amount: amt, counterparty, remark: `订单付款 ${orderId}`, person: record.operator || '', image: record.screenshot,
    });
  }

  markPosted(owner, tag);
  return { ok: true };
};

// ============ 发货结转分录（摘要=订单号，sourceKey 幂等） ============

/** 供应商侧：发货后 借预收账款 / 贷主营业务收入 */
export const postShipRevenueEntry = (owner: string, orderId: string, amount: number, operator?: string): void => {
  if (!isAccountingMode(owner)) return;
  writeAutoEntries(owner, {
    sourceKey: `ship-rev-${orderId}`,
    debitSubject: '预收账款', creditSubject: '主营业务收入',
    amount, summary: orderId, auditor: operator || '',
  });
};

/** 采购商侧：供应商发货后 借库存商品 / 贷预付账款 */
export const postShipCostEntry = (owner: string, orderId: string, amount: number, operator?: string): void => {
  if (!isAccountingMode(owner)) return;
  writeAutoEntries(owner, {
    sourceKey: `ship-cost-${orderId}`,
    debitSubject: '库存商品', creditSubject: '预付账款',
    amount, summary: orderId, auditor: operator || '',
  });
};
