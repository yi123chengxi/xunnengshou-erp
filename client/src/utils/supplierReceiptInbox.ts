/**
 * 采购商付款 → 供应商「新增收款」待登记收件箱
 *
 * 闭环链路：采购商（采购商平台-供应商列表·申请付款）→ 财务管理-收/付申请·出纳支付成功
 *   → 推送 supplier_receipt_inbox_<供应商账号>（跨租户键，行内带付款时间/金额/支付截图）
 *   → 供应商（客户基础信息-客户列表·新增收款弹窗）看到「采购商已支付待登记」列表
 *   → 快速填充（把金额填进收款金额）/ 删除后打 handled 墓碑，该行不再出现，避免下次误操作
 *
 * 为什么用墓碑而不是物理删除：该键由采购商追加、供应商改写，两端都走服务端并集合并，
 * 物理删掉的行会被对方或服务端的并集重新复活；handled=true 的墓碑在合并时优先级最高。
 */
import { safeSetItem, getOriginalSetItem } from './storageQuota';
import { saveDataset } from './dataStore';
import { fetchServerDataset, uploadWithUnionMerge } from './serverSync';
import { resolveCompanyCred } from './nameSync';
import { resolveSupplier } from './invoiceApply';

/** 供应商侧「新增收款」待登记行（一笔采购商已支付款项） */
export interface SupplierReceiptInboxRow {
  key: string;                  // pin-<采购商账号>-<付款申请 key>，稳定且幂等
  paymentKey: string;           // 采购商侧「收/付申请」记录 key
  requestNo: string;            // 付款申请编号
  purchaserUsername: string;    // 采购商账号（数据归属者）
  purchaserCompany: string;     // 采购商公司名称（供应商客户列表行名比对）
  purchaserNo?: string;         // 采购商公司编号（改名后仍可归同一主体）
  supplierUsername: string;     // 供应商账号（收件箱归属）
  supplierName: string;         // 供应商公司名称
  amount: number;               // 付款金额（元）
  paidAt: string;               // 付款时间（出纳支付时刻）
  payAccount?: string;          // 采购商付款账户
  screenshot?: string;          // 支付截图 dataURL（已压缩，可点开放大）
  handled?: boolean;            // 已处理墓碑：快速填充/删除后不再展示
  handledMode?: 'fill' | 'delete';
  handledAt?: string;
  handledBy?: string;
  createdAt: string;
}

/** 供应商侧待登记收件箱存储键 */
export const receiptInboxKey = (owner: string) => `supplier_receipt_inbox_${owner}`;

const parseRows = (raw: string | null): SupplierReceiptInboxRow[] => {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((r: any) => r && r.key) : [];
  } catch { return []; }
};

/** 本地缓存读取（同步，供弹窗首帧立即渲染） */
export const readReceiptInbox = (owner: string): SupplierReceiptInboxRow[] => {
  if (!owner) return [];
  try { return parseRows(localStorage.getItem(receiptInboxKey(owner))); } catch { return []; }
};

const readUser = (username: string): any => {
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return (Array.isArray(users) ? users : []).find((u: any) => u?.username === username) || null;
  } catch { return null; }
};

const userLabel = (username?: string): string => {
  const name = String(username || localStorage.getItem('username') || '');
  const u = readUser(name);
  return u?.displayName || u?.contactPerson || u?.name || name || '—';
};

/**
 * 按 key 合并两份行集：墓碑优先（已处理行永不复现），其次以 base（服务端）为准，
 * base 未携带的行由 extra（本地）补齐。防止本端旧副本把对方刚追加的新行挤掉。
 */
const mergeRows = (base: SupplierReceiptInboxRow[], extra: SupplierReceiptInboxRow[]): SupplierReceiptInboxRow[] => {
  const out: SupplierReceiptInboxRow[] = [...base];
  const byKey = new Map<string, SupplierReceiptInboxRow>();
  out.forEach(r => byKey.set(r.key, r));
  extra.forEach(r => {
    const hit = byKey.get(r.key);
    if (!hit) { out.push(r); byKey.set(r.key, r); return; }
    if (hit.handled !== true && r.handled === true) {
      // 本地已打墓碑、服务端尚未收到：墓碑覆盖
      const idx = out.indexOf(hit);
      out[idx] = r;
      byKey.set(r.key, r);
    }
  });
  return out;
};

/** 落本地：绕过写入钩子，避免把「拉回来的服务端副本」当成新编辑再上传一遍 */
const persistLocal = (key: string, json: string): void => {
  try {
    const raw = getOriginalSetItem();
    raw(key, json);
    raw(`${key}_ts`, String(Date.now()));
    saveDataset(key, json);
  } catch { /* ignore */ }
};

/**
 * 加载供应商待登记收款：本地即时生效 + 服务端补齐（跨浏览器/换电脑可见）。
 * 合并结果回写本地缓存，不反向上传（本次没有产生新编辑）。
 */
export const loadSupplierReceiptInbox = async (owner: string): Promise<SupplierReceiptInboxRow[]> => {
  if (!owner) return [];
  const key = receiptInboxKey(owner);
  const local = readReceiptInbox(owner);
  let rec: { json: string } | null = null;
  try { rec = await fetchServerDataset(key); } catch { rec = null; }
  if (!rec || !rec.json) return local;
  const server = parseRows(rec.json);
  if (!server.length) return local;
  const merged = mergeRows(server, local);
  const json = JSON.stringify(merged);
  if (json !== JSON.stringify(local)) persistLocal(key, json);
  return merged;
};

/** 供应商账号解析：付款申请内已带账号时优先用，其次采购商供应商列表，最后按公司名反查注册凭证 */
export const resolveSupplierAccount = (purchaserOwner: string, supplierName: string, hint?: string): string => {
  const h = String(hint || '').trim();
  if (h) return h;
  try {
    const r = resolveSupplier(purchaserOwner, supplierName);
    if (r.username) return r.username;
  } catch { /* ignore */ }
  return resolveCompanyCred(supplierName)?.username || '';
};

/**
 * 采购商支付成功后推送一笔待登记到供应商收件箱。
 * 该键对采购商是「非本账号私有键」，必须走服务端并集后整键回传，禁止本地空基直接覆盖。
 */
export const pushPaidToSupplier = async (p: {
  purchaserOwner: string;
  supplierName: string;
  supplierUsername?: string;
  paymentKey: string;
  requestNo: string;
  amount: number;
  paidAt: string;
  payAccount?: string;
  screenshot?: string;
}): Promise<boolean> => {
  const purchaserOwner = String(p.purchaserOwner || '').trim();
  const supplierName = String(p.supplierName || '').trim();
  if (!purchaserOwner || !supplierName || !p.paymentKey) return false;
  const supplierUsername = resolveSupplierAccount(purchaserOwner, supplierName, p.supplierUsername);
  if (!supplierUsername) return false; // 供应商未注册：无法投递，静默跳过（本方收款/记账不受影响）

  const me = readUser(purchaserOwner);
  const row: SupplierReceiptInboxRow = {
    key: `pin-${purchaserOwner}-${p.paymentKey}`,
    paymentKey: p.paymentKey,
    requestNo: p.requestNo || '',
    purchaserUsername: purchaserOwner,
    purchaserCompany: String(me?.companyName || localStorage.getItem('companyName') || purchaserOwner),
    purchaserNo: String(me?.companyNo || me?.companyShortName || ''),
    supplierUsername,
    supplierName,
    amount: Math.round((Number(p.amount) || 0) * 100) / 100,
    paidAt: p.paidAt || new Date().toLocaleString('zh-CN'),
    payAccount: p.payAccount || '',
    screenshot: p.screenshot || '',
    handled: false,
    createdAt: new Date().toISOString(),
  };

  const key = receiptInboxKey(supplierUsername);
  let server: SupplierReceiptInboxRow[] = [];
  try {
    const rec = await fetchServerDataset(key);
    if (rec && rec.json) server = parseRows(rec.json);
  } catch { /* 离线：仅本地可见，联网后由上传队列补齐 */ }
  let local: SupplierReceiptInboxRow[] = [];
  try { local = parseRows(localStorage.getItem(key)); } catch { local = []; }

  const merged = mergeRows(server, local);
  if (merged.some(r => r.key === row.key)) return true; // 幂等：同一笔付款只投递一次
  merged.unshift(row);
  const json = JSON.stringify(merged);
  try {
    const raw = getOriginalSetItem();
    raw(key, json);
    raw(`${key}_ts`, String(Date.now()));
    saveDataset(key, json);
  } catch { /* ignore */ }
  return await uploadWithUnionMerge(key, json);
};

/**
 * 打「已处理」墓碑：快速填充（fill）/ 删除（delete）。
 * 本地先落盘（离线也立即生效），再与服务端并集后回传，保证另一台电脑/另一个浏览器同步消失。
 */
export const markReceiptInboxHandled = async (
  owner: string, rowKeys: string[], mode: 'fill' | 'delete', operator?: string,
): Promise<boolean> => {
  if (!owner) return false;
  const ids = new Set((rowKeys || []).map(k => String(k || '')).filter(Boolean));
  if (ids.size === 0) return false;
  const key = receiptInboxKey(owner);
  const stamp = {
    handled: true as const,
    handledMode: mode,
    handledAt: new Date().toISOString(),
    handledBy: userLabel(operator),
  };
  const mark = (list: SupplierReceiptInboxRow[]) => list.map(r => (ids.has(r.key) ? { ...r, ...stamp } : r));

  const localBase = readReceiptInbox(owner);
  const localNext = mark(localBase);
  // 本地为空（新浏览器尚未缓存）时不要写空数组，等下一步按服务端并集后再落盘
  if (localBase.length) persistLocal(key, JSON.stringify(localNext));

  let server: SupplierReceiptInboxRow[] = [];
  try {
    const rec = await fetchServerDataset(key);
    if (rec && rec.json) server = parseRows(rec.json);
  } catch { /* 离线：仅本地墓碑，稍后随重试补传 */ }
  const next = mark(mergeRows(server, localNext));
  const json = JSON.stringify(next);
  try {
    safeSetItem(key, json);
    safeSetItem(`${key}_ts`, String(Date.now()));
    saveDataset(key, json);
  } catch { /* ignore */ }
  return await uploadWithUnionMerge(key, json);
};

/** 是否属于某个客户（按采购商账号 / 公司名 / 公司编号三路归一，改名后仍能匹配上） */
export const inboxRowBelongsTo = (
  row: SupplierReceiptInboxRow,
  customer: { name?: string; id?: string; purchaserUsername?: string; purchaserNo?: string },
): boolean => {
  if (!row || row.handled === true) return false;
  const norm = (v?: string) => String(v || '').trim();
  const u = norm(customer.purchaserUsername);
  const n = norm(customer.name);
  const no = norm(customer.purchaserNo);
  const cid = norm(customer.id);
  if (u && norm(row.purchaserUsername) === u) return true;
  if (cid && norm(row.purchaserUsername) === cid) return true;
  if (no && norm(row.purchaserNo) === no) return true;
  if (n && norm(row.purchaserCompany) === n) return true;
  return false;
};
