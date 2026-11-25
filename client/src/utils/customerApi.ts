/**
 * 客户数据权威真表 API 客户端（/api/customer/*）
 *
 * 架构口径：服务端四张真表（customer_profiles / customer_archives / customer_credit_adj / customer_pay_summary）
 * 是唯一权威源；本地 localStorage 同名键（customers_<owner> / customer_archive_<owner> /
 * credit_adjustments_<owner> / customer_pay_summary_<owner>）退化为「只读镜像缓存」——
 * 既有页面/工具的全部同步读逻辑与跨页消费保持不变，仅传输通道从全局键同步换成本模块
 * （四键已退出 serverSync 全局同步）。IndexedDB 作二级缓存。
 *
 * 传输模型（集中式，页面写点无需改造）：
 * - 写：Storage.prototype.setItem 全局钩子 → scheduleCustomerUpload(key,value) → 防抖后 POST /push
 *   （携带 owner/rows/removedKeys），服务端按归属与跨租户授权落库，返回 actor 最新快照 → 回灌镜像。
 * - 读：hydrateCustomer() 拉 /snapshot 写镜像（原生 setItem，不触发钩子，杜绝回环）；
 *   在 app 启动 / 定时 / 可见性恢复触发，替代旧全局同步的拉取。
 * - 离线：写本地镜像照常生效；/push 失败进入重试队列，联网后下次触发补传；
 *   /snapshot 失败保留本地镜像不作权威覆写。
 * - 汇总特化：customer_pay_summary_ 镜像是 主体名→条目 的对象映射（非数组），
 *   推送时拆行（key=主体名），水合时按条目 updatedAt 取新者合并，
 *   保护本地刚重算的新鲜值不被服务端陈旧快照覆盖（派生源头仍是本地优先账单/收款链）。
 */
import { API_BASE } from './apiBase';
import { saveDataset } from './dataStore';
import { getOriginalSetItem } from './storageQuota';

const CUST_PREFIX = 'customers_';
const ARCH_PREFIX = 'customer_archive_';
const CREDIT_PREFIX = 'credit_adjustments_';
const SUMMARY_PREFIX = 'customer_pay_summary_';

/** 原生写入（不触发 setItem 钩子，避免镜像回灌再次触发上传形成回环） */
const nativeSet = getOriginalSetItem();

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  try {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* ignore */ }
  return headers;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** 当前登录数据归属主账号（与页面 getDataOwner 同口径：子账号归父账号） */
export function customerOwner(): string {
  try {
    const uname = localStorage.getItem('username') || '';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || uname) : uname;
  } catch { return ''; }
}

export const isCustomerKey = (key: string): boolean =>
  key.startsWith(CUST_PREFIX) || key.startsWith(ARCH_PREFIX) || key.startsWith(CREDIT_PREFIX) || key.startsWith(SUMMARY_PREFIX);

// ============ 镜像写入（原生，不触发钩子） ============
// lastValue：每个键最近一次「水合/推送」落地的 JSON，用于跳过无变化的重复写入与推送，
// 杜绝「加载收敛写镜像 → 推送 → 快照回灌 → 派发刷新 → 再加载收敛」的回环
const lastValue = new Map<string, string>();

/** 写数组镜像：仅当内容与本地现值不同才写入并返回 true */
function writeMirror(key: string, list: any[]): boolean {
  const json = JSON.stringify(Array.isArray(list) ? list : []);
  let cur: string | null = null;
  try { cur = localStorage.getItem(key); } catch { cur = null; }
  lastValue.set(key, json);
  if (cur === json) { try { saveDataset(key, json); } catch { /* ignore */ } return false; }
  try { nativeSet(key, json); } catch { /* ignore */ }
  try { saveDataset(key, json); } catch { /* ignore */ }
  return true;
}

/** 写对象映射镜像（汇总键专用）：仅当内容与本地现值不同才写入并返回 true */
function writeMirrorMap(key: string, map: Record<string, any>): boolean {
  const json = JSON.stringify(map && typeof map === 'object' ? map : {});
  let cur: string | null = null;
  try { cur = localStorage.getItem(key); } catch { cur = null; }
  lastValue.set(key, json);
  if (cur === json) { try { saveDataset(key, json); } catch { /* ignore */ } return false; }
  try { nativeSet(key, json); } catch { /* ignore */ }
  try { saveDataset(key, json); } catch { /* ignore */ }
  return true;
}

const readLocalMap = (key: string): Record<string, any> => {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};

// ============ 已水合键集（用于精确计算 removedKeys，避免误删/空表擦除） ============
type Section = 'customers' | 'archives' | 'credit' | 'summary';
const lastKeys: Record<Section, Set<string>> = {
  customers: new Set(), archives: new Set(), credit: new Set(), summary: new Set(),
};
let hydratedOnce = false;

const custKeyOf = (r: any): string => String(r?.id || r?.key || '');
const archKeyOf = (r: any): string => String(r?.id || '');
const creditKeyOf = (r: any): string => String(r?.id || r?.key || '');

/** 汇总行 → 对象映射；与本地现值按条目 updatedAt 取新者（保护防抖窗口内本地刚重算的新鲜值） */
function summaryRowsToMap(rows: any[], localMap: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  rows.forEach((r) => {
    const name = String(r?.key || '');
    if (!name || !r || typeof r !== 'object') return;
    const local = localMap[name];
    const incTs = String(r.updatedAt || '');
    const locTs = String(local?.updatedAt || '');
    // 本地条目更新（ISO 串字典序即时间序）→ 保留本地，等待下次推送收敛服务端
    if (local && locTs && incTs && locTs > incTs) { out[name] = local; return; }
    const { key: _k, ...entry } = r;
    out[name] = entry;
  });
  return out;
}

function snapshotToMirrors(data: any): boolean {
  const owner = customerOwner();
  const customers = Array.isArray(data?.customers) ? data.customers : [];
  const archives = Array.isArray(data?.archives) ? data.archives : [];
  const credit = Array.isArray(data?.creditAdjustments) ? data.creditAdjustments : [];
  const summaryRows = Array.isArray(data?.paySummary) ? data.paySummary : [];
  let changed = false;
  if (owner) {
    if (writeMirror(CUST_PREFIX + owner, customers)) changed = true;
    if (writeMirror(ARCH_PREFIX + owner, archives)) changed = true;
    if (writeMirror(CREDIT_PREFIX + owner, credit)) changed = true;
    const merged = summaryRowsToMap(summaryRows, readLocalMap(SUMMARY_PREFIX + owner));
    if (writeMirrorMap(SUMMARY_PREFIX + owner, merged)) changed = true;
  }
  lastKeys.customers = new Set(customers.map(custKeyOf).filter(Boolean));
  lastKeys.archives = new Set(archives.map(archKeyOf).filter(Boolean));
  lastKeys.credit = new Set(credit.map(creditKeyOf).filter(Boolean));
  lastKeys.summary = new Set(summaryRows.map((r: any) => String(r?.key || '')).filter(Boolean));
  hydratedOnce = true;
  return changed;
}

function dispatchChanged(): void {
  try { window.dispatchEvent(new Event('customer-hydrated')); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event('sync-data-updated')); } catch { /* ignore */ }
}

// ============ 读：拉取权威快照并回灌镜像 ============
let hydrating: Promise<boolean> | null = null;
export async function hydrateCustomer(force = false): Promise<boolean> {
  if (!force && hydrating) return hydrating;
  const p = (async () => {
    try {
      // 先补传离线期间失败的写入，再拉快照——避免服务端旧快照覆盖本地新写入
      await retryFailedPushes();
      const res = await fetchWithTimeout(`${API_BASE}/customer/snapshot`, { headers: authHeaders() }, 12000);
      if (!res.ok) return false;
      const body = await res.json();
      if (body?.code !== 200 || !body?.data) return false;
      const changed = snapshotToMirrors(body.data);
      if (changed) dispatchChanged();
      return true;
    } catch { return false; }
    finally { hydrating = null; }
  })();
  hydrating = p;
  return p;
}

// ============ 写：防抖推送 + 失败重试 ============
const pendingPush = new Map<string, { timer: any; value: string }>();
const retryQueue = new Map<string, string>();

function removedAgainst(section: Section, currentKeys: Set<string>): string[] {
  // 仅对本人已水合的键集计算删除，未水合（新设备/离线）时不申报删除，杜绝空表擦除服务端
  if (!hydratedOnce) return [];
  return Array.from(lastKeys[section]).filter(k => !currentKeys.has(k));
}

async function doPush(key: string, value: string, seed = false): Promise<boolean> {
  const owner = customerOwner();
  const payload: any = {};
  let section: Section;
  let target: string;

  if (key.startsWith(SUMMARY_PREFIX)) {
    section = 'summary';
    target = key.slice(SUMMARY_PREFIX.length);
    const map = (() => { try { const v = JSON.parse(value || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } })();
    const rows = Object.entries(map).map(([name, entry]) => ({ key: name, ...(entry as object) }));
    const cur = new Set(rows.map(r => r.key).filter(Boolean));
    const own = target === owner;
    payload.paySummary = { owner: target, rows, removedKeys: own && !seed ? removedAgainst('summary', cur) : [] };
    if (own) lastKeys.summary = cur;
  } else {
    let rows: any[] = [];
    try { rows = JSON.parse(value || '[]'); } catch { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    if (key.startsWith(CUST_PREFIX)) {
      section = 'customers';
      target = key.slice(CUST_PREFIX.length);
      const cur = new Set(rows.map(custKeyOf).filter(Boolean));
      const own = target === owner;
      payload.customers = { owner: target, rows, removedKeys: own && !seed ? removedAgainst('customers', cur) : [] };
      if (own) lastKeys.customers = cur;
    } else if (key.startsWith(ARCH_PREFIX)) {
      section = 'archives';
      target = key.slice(ARCH_PREFIX.length);
      const cur = new Set(rows.map(archKeyOf).filter(Boolean));
      const own = target === owner;
      // 跨租户不申报 diff 删除：批准写点走显式 removeParty 通道（pushRemoteUnarchive）
      payload.archives = { owner: target, rows, removedKeys: own && !seed ? removedAgainst('archives', cur) : [] };
      if (own) lastKeys.archives = cur;
    } else if (key.startsWith(CREDIT_PREFIX)) {
      section = 'credit';
      target = key.slice(CREDIT_PREFIX.length);
      const cur = new Set(rows.map(creditKeyOf).filter(Boolean));
      const own = target === owner;
      payload.creditAdjustments = { owner: target, rows, removedKeys: own && !seed ? removedAgainst('credit', cur) : [] };
      if (own) lastKeys.credit = cur;
    } else {
      return false;
    }
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/customer/push`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }, 20000);
    if (!res.ok) { retryQueue.set(key, value); return false; }
    const body = await res.json();
    const rej = Array.isArray(body?.rejected) ? body.rejected : [];
    if (rej.length) {
      try { console.warn('[customer] 写入被服务端门禁拒绝:', rej); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('customer-push-rejected', { detail: rej })); } catch { /* ignore */ }
    }
    if (body?.code === 200 && body?.data) {
      const changed = snapshotToMirrors(body.data);
      if (changed) dispatchChanged();
    }
    retryQueue.delete(key);
    return true;
  } catch {
    // 离线/超时：镜像保留，进入重试队列联网后补传
    retryQueue.set(key, value);
    return false;
  }
}

async function retryFailedPushes(): Promise<void> {
  if (!retryQueue.size) return;
  const entries = Array.from(retryQueue.entries());
  for (const [key, value] of entries) {
    // 期间已有更新写入排队时以最新值为准
    const pending = pendingPush.get(key);
    await doPush(key, pending ? pending.value : value);
  }
}

/** setItem 全局钩子回调：四个客户数据键变更后防抖推送到服务端权威真表 */
export function scheduleCustomerUpload(key: string, value: string): void {
  if (!isCustomerKey(key)) return;
  // 无变化跳过：加载收敛/重复回灌写回同一内容时不推送，杜绝回环
  if (lastValue.get(key) === value) return;
  const prev = pendingPush.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => { pendingPush.delete(key); void doPush(key, value); }, 800);
  pendingPush.set(key, { timer, value });
}

/** 立即推送并等待完成（关键动作后调用，确保服务端已落库） */
export async function flushCustomerUpload(key: string): Promise<void> {
  const prev = pendingPush.get(key);
  if (prev) { clearTimeout(prev.timer); pendingPush.delete(key); await doPush(key, prev.value); }
}

/** 刷新所有待推送（页面隐藏/关闭前调用，避免防抖未触发的写入丢失） */
export function flushAllCustomerUploads(): void {
  pendingPush.forEach((entry, key) => { clearTimeout(entry.timer); void doPush(key, entry.value); });
  pendingPush.clear();
  retryQueue.forEach((value, key) => { void doPush(key, value); });
}

// ============ 跨租户显式出口（客户端无对方镜像，无法走本地写钩子） ============

/** 批准合作时解除供应商归档册里本主体的条目（服务端按凭证 + approved 握手校验） */
export async function pushRemoteUnarchive(supplierOwner: string, party: { username?: string; no?: string; name?: string }): Promise<void> {
  if (!supplierOwner) return;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/customer/push`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ archives: { owner: supplierOwner, rows: [], removedKeys: [], removeParty: party } }),
    }, 20000);
    if (!res.ok) return;
    const body = await res.json();
    if (body?.code === 200 && body?.data) {
      const changed = snapshotToMirrors(body.data);
      if (changed) dispatchChanged();
    }
  } catch { /* 离线：对方归档保留，下次批准写点再触发 */ }
}

/** 邀约链接确认时更新供应商客户档案的合作类型（服务端仅合并 type/cooperationDate 两字段） */
export async function confirmRemoteCustomerLink(supplierOwner: string, customerId: string, patch: { type?: string; cooperationDate?: string }): Promise<void> {
  if (!supplierOwner || !customerId) return;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/customer/push`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ customers: { owner: supplierOwner, rows: [{ id: customerId, ...patch }], removedKeys: [] } }),
    }, 20000);
    if (!res.ok) return;
    const body = await res.json();
    if (body?.code === 200 && body?.data) {
      const changed = snapshotToMirrors(body.data);
      if (changed) dispatchChanged();
    }
  } catch { /* 离线：本地镜像已写（同浏览器场景），联网后由对端水合收敛 */ }
}

// ============ 跨租户读（采购商侧读供应商档案/额度） ============
const sharedCache = new Map<string, { ts: number; data: { customers: any[]; creditAdjustments: any[] } }>();

/** 本地镜像兜底：服务端不可达时读本机缓存（同浏览器场景对方镜像可能存在） */
function mirrorShared(targetOwner: string): { customers: any[]; creditAdjustments: any[] } {
  let customers: any[] = [];
  let creditAdjustments: any[] = [];
  try { customers = JSON.parse(localStorage.getItem(CUST_PREFIX + targetOwner) || '[]'); } catch { /* ignore */ }
  try { creditAdjustments = JSON.parse(localStorage.getItem(CREDIT_PREFIX + targetOwner) || '[]'); } catch { /* ignore */ }
  return { customers: Array.isArray(customers) ? customers : [], creditAdjustments: Array.isArray(creditAdjustments) ? creditAdjustments : [] };
}

/** 同步读（渲染路径）：优先内存共享缓存，缺失回退本地镜像；新鲜度由 fetchCustomerShared 预热保证 */
export function peekCustomerShared(targetOwner: string): { customers: any[]; creditAdjustments: any[] } {
  if (!targetOwner) return { customers: [], creditAdjustments: [] };
  const hit = sharedCache.get(targetOwner);
  if (hit) return hit.data;
  return mirrorShared(targetOwner);
}

/** 读某账号的客户档案 + 额度调整（30s 内存缓存；服务端不可达时回退本地镜像） */
export async function fetchCustomerShared(targetOwner: string): Promise<{ customers: any[]; creditAdjustments: any[] }> {
  if (!targetOwner) return { customers: [], creditAdjustments: [] };
  const hit = sharedCache.get(targetOwner);
  if (hit && Date.now() - hit.ts < 30000) return hit.data;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/customer/shared?owner=${encodeURIComponent(targetOwner)}`, { headers: authHeaders() }, 12000);
    if (!res.ok) return mirrorShared(targetOwner);
    const body = await res.json();
    if (body?.code !== 200 || !body?.data) return mirrorShared(targetOwner);
    const data = {
      customers: Array.isArray(body.data.customers) ? body.data.customers : [],
      creditAdjustments: Array.isArray(body.data.creditAdjustments) ? body.data.creditAdjustments : [],
    };
    sharedCache.set(targetOwner, { ts: Date.now(), data });
    return data;
  } catch { return mirrorShared(targetOwner); }
}

// ============ 首载补种 + 启动/轮询安装 ============
// 本地优先架构下本机副本可能比 dataset_store 迁移源更新：首次升级加载时把本地四键现值
// 以 upsert-only（不申报删除）推送补种，防迁移丢行。哨兵为本机键，故意避开同步前缀。
const seededKey = (owner: string) => `cust_api_seeded_${owner}`;

async function ensureSeeded(): Promise<void> {
  const owner = customerOwner();
  if (!owner) return;
  try { if (localStorage.getItem(seededKey(owner))) return; } catch { return; }
  const keys = [CUST_PREFIX + owner, ARCH_PREFIX + owner, CREDIT_PREFIX + owner, SUMMARY_PREFIX + owner];
  // 先快照四键现值再推送：推送响应会回灌镜像，边推边读会把刚回灌的空镜像也当本地现值补种
  const entries: Array<[string, string]> = [];
  for (const key of keys) {
    let value: string | null = null;
    try { value = localStorage.getItem(key); } catch { /* ignore */ }
    if (value !== null) entries.push([key, value]);
  }
  let allOk = true;
  for (const [key, value] of entries) {
    const ok = await doPush(key, value, true);
    if (!ok) allOk = false;
  }
  // 全部成功才落哨兵；离线时下次加载/可见性恢复再补种
  if (allOk) { try { nativeSet(seededKey(owner), String(Date.now())); } catch { /* ignore */ } }
}

let pollInstalled = false;
export function installCustomerSync(): void {
  if (pollInstalled) return;
  pollInstalled = true;
  // 启动：先补种（内部推送响应已回灌快照），再拉一次权威快照
  void (async () => { await ensureSeeded(); await hydrateCustomer(); })();
  setInterval(() => { void (async () => { await ensureSeeded(); await hydrateCustomer(); })(); }, 45000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAllCustomerUploads();
    else void (async () => { await ensureSeeded(); await hydrateCustomer(); })();
  });
  window.addEventListener('focus', () => { void hydrateCustomer(); });
  // 页面隐藏/关闭前刷出待推送，避免 800ms 防抖未触发的写入丢失
  window.addEventListener('pagehide', () => flushAllCustomerUploads());
  window.addEventListener('beforeunload', () => flushAllCustomerUploads());
}