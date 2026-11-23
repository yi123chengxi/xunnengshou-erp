/**
 * 永不缩水键「跨端删除收敛」服务端账本（dataset_delete_ledger）。
 *
 * 背景（真实事故）：银行账户等永不缩水键的删除只由「执行删除的那一端」客户端持有墓碑登记；
 * 其他端（子账号/其他浏览器）拉取时把「服务端已缺失的行」当作「本地独有、尚未上传的新增行」
 * 行级并集保留并回传服务端（PUT 并集复活），表现为「主账号删除后子账号与小程序仍可见」。
 *
 * 本模块把删除事实持久化到服务端账本，使删除对所有端收敛：
 * - PUT 保存永不缩水键时：先按账本剪掉幽灵行，再把「本次真实消失的行」记入账本；
 * - GET /sync/dataset：按账本过滤下发内容并附 removedIds 清单（客户端据此同步本地墓碑），
 *   存储副本含幽灵行时读侧自愈回写，杜绝小程序等直读真表入口长期看到已删行；
 * - 小程序/看板等 readRows 直读入口：按账本过滤行。
 *
 * 账本只增不减（单键上限截断），行 id 为创建时生成的唯一键，同号重建不受影响。
 */
import { store } from '../database/store';

// 与 sync.routes.ts 的 NEVER_SHRINK_PREFIXES 同构（服务端账本仅作用于这批键）
const NEVER_SHRINK_PREFIXES = ['purchaser_bills_', 'pageData_customer_bill-detail_', 'pageData_sales_order-manage_', 'purchaser_suppliers_', 'boundPurchasers_', 'accounts_', 'reimbursement_', 'pageData_finance_bank-account_'];
export const isNeverShrinkDatasetKey = (key: string): boolean => NEVER_SHRINK_PREFIXES.some(p => key.startsWith(p));

const DELETE_LEDGER_KEY = 'dataset_delete_ledger';
/** 单键账本上限（超出丢弃最旧，防止无限增长） */
const LEDGER_MAX_PER_KEY = 500;

type Ledger = Record<string, Record<string, number>>;

let ledgerCache: Ledger | null = null;

export async function loadDeleteLedger(): Promise<Ledger> {
  if (ledgerCache) return ledgerCache;
  try {
    const row = await store.getDataset(DELETE_LEDGER_KEY);
    const parsed = row && row.dataset_json ? JSON.parse(row.dataset_json) : {};
    ledgerCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Ledger) : {};
  } catch {
    ledgerCache = {};
  }
  return ledgerCache;
}

async function saveDeleteLedger(ledger: Ledger): Promise<void> {
  ledgerCache = ledger;
  try {
    await store.forceUpsertDataset(DELETE_LEDGER_KEY, JSON.stringify(ledger), '', Date.now());
  } catch { /* 账本写失败不阻断业务写入，最坏退化为旧语义 */ }
}

/** 记入删除账本（PUT 实际删行后调用） */
export async function recordDeletions(key: string, ids: string[]): Promise<void> {
  if (!key || !ids || ids.length === 0) return;
  const ledger = await loadDeleteLedger();
  const cur = ledger[key] && typeof ledger[key] === 'object' ? ledger[key] : {};
  const at = Date.now();
  ids.forEach(raw => { const id = String(raw || ''); if (id) cur[id] = at; });
  const all = Object.keys(cur);
  if (all.length > LEDGER_MAX_PER_KEY) {
    all.sort((a, b) => (Number(cur[a]) || 0) - (Number(cur[b]) || 0))
      .slice(0, all.length - LEDGER_MAX_PER_KEY)
      .forEach(id => { delete cur[id]; });
  }
  ledger[key] = cur;
  await saveDeleteLedger(ledger);
}

/** 某键当前账本内的已删行 id 集合 */
export async function ledgerIdsOf(key: string): Promise<Set<string>> {
  const ledger = await loadDeleteLedger();
  const map = ledger[key];
  return new Set(map && typeof map === 'object' ? Object.keys(map) : []);
}

const rowPrimaryId = (r: any): string => ((r && (r.key || r.id)) ? String(r.key || r.id) : '');

/** 按账本剪掉 JSON 数组中的幽灵行（非数组/解析失败原样返回） */
export function filterLedgerRowsJson(ids: Set<string>, json: string): string {
  if (!ids || ids.size === 0) return json;
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return json;
    const kept = rows.filter((r: any) => { const p = rowPrimaryId(r); return !p || !ids.has(p); });
    return kept.length === rows.length ? json : JSON.stringify(kept);
  } catch { return json; }
}

/** 按账本过滤行数组（readRows 直读入口用） */
export async function filterLedgerRows(key: string, rows: any[]): Promise<any[]> {
  if (!rows || rows.length === 0) return rows;
  const ids = await ledgerIdsOf(key);
  if (ids.size === 0) return rows;
  return rows.filter((r: any) => { const p = rowPrimaryId(r); return !p || !ids.has(p); });
}

/**
 * PUT 保存永不缩水键前的统一收口：
 * 1) 按账本剪掉陈旧副本并回的幽灵行（任何端都无法复活已删行）；
 * 2) 把「存量中存在、保存后消失」的行记入账本（本次申报删除/账本再清理），供跨端收敛。
 * 非永不缩水键原样返回（整键替换语义下删除天然跨端收敛）。
 */
export async function applyNeverShrinkLedgerToSaved(key: string, existingJson: string | null, savedJson: string): Promise<string> {
  if (!isNeverShrinkDatasetKey(key)) return savedJson;
  const ids = await ledgerIdsOf(key);
  const filtered = filterLedgerRowsJson(ids, savedJson);
  try {
    const after = new Set<string>();
    (JSON.parse(filtered) as any[]).forEach(r => { const p = rowPrimaryId(r); if (p) after.add(p); });
    const before = existingJson ? JSON.parse(existingJson) : [];
    if (Array.isArray(before)) {
      const deleted = before.map(rowPrimaryId).filter((id: string) => id && !after.has(id));
      if (deleted.length) await recordDeletions(key, deleted);
    }
  } catch { /* 账本记录失败不阻断保存 */ }
  return filtered;
}
