/**
 * 供应商菜单 / 合作握手权威真表 API 客户端（/api/cooperation/*）
 *
 * 架构口径：服务端三张真表（supplier_directory / bound_purchasers / cooperation_apps）是唯一权威源；
 * 本地 localStorage 同名键（purchaser_suppliers_<owner> / boundPurchasers_<owner> / cooperation_applications）
 * 退化为「只读镜像缓存」——既有页面/工具的全部同步读逻辑与跨页消费保持不变，仅传输通道从全局键同步
 * 换成本模块（三键已退出 serverSync 全局同步）。IndexedDB 作二级缓存。
 *
 * 传输模型（集中式，页面写点无需改造）：
 * - 写：Storage.prototype.setItem 全局钩子 → scheduleCooperationUpload(key,value) → 防抖后 POST /push
 *   （携带 owner/rows/removedKeys），服务端按归属与跨租户授权落库，返回 actor 最新快照 → 回灌镜像。
 * - 读：hydrateCooperation() 拉 /snapshot 写镜像（原生 setItem，不触发钩子，杜绝回环）；
 *   在 app 启动 / 定时 / 可见性恢复 / 合作事件后触发，替代旧全局同步的拉取。
 * - 离线：/snapshot 或 /push 失败时保留本地镜像不作权威覆写，页面照常读镜像；恢复后下次触发收敛。
 */
import { API_BASE } from './apiBase';
import { saveDataset } from './dataStore';
import { getOriginalSetItem } from './storageQuota';

const SUP_PREFIX = 'purchaser_suppliers_';
const BOUND_PREFIX = 'boundPurchasers_';
const APPS_KEY = 'cooperation_applications';

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
export function cooperationOwner(): string {
  try {
    const uname = localStorage.getItem('username') || '';
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    return isSub ? (localStorage.getItem('parentAccount') || uname) : uname;
  } catch { return ''; }
}

export const isCooperationKey = (key: string): boolean =>
  key === APPS_KEY || key.startsWith(SUP_PREFIX) || key.startsWith(BOUND_PREFIX);

// ============ 镜像写入（原生，不触发钩子） ============
// lastValue：每个键最近一次「水合/推送」落地的 JSON，用于跳过无变化的重复写入与推送，
// 杜绝「加载收敛写镜像 → 推送 → 快照回灌 → 派发刷新 → 再加载收敛」的回环
const lastValue = new Map<string, string>();

/** 写镜像：仅当内容与本地现值不同才写入并返回 true（原生 setItem 不触发钩子） */
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

// ============ 已水合键集（用于精确计算 removedKeys，避免误删/空表擦除） ============
const lastKeys: { suppliers: Set<string>; bound: Set<string>; apps: Set<string> } = {
  suppliers: new Set(), bound: new Set(), apps: new Set(),
};
let hydratedOnce = false;

const supKeyOf = (r: any): string => String(r?.id || r?.key || '');
const boundKeyOf = (r: any): string => String(r?.key || r?.id || '');
const appKeyOf = (r: any): string => String(r?.applicationId || r?.id || '');

function snapshotToMirrors(data: any): boolean {
  const owner = cooperationOwner();
  const suppliers = Array.isArray(data?.suppliers) ? data.suppliers : [];
  const bound = Array.isArray(data?.boundPurchasers) ? data.boundPurchasers : [];
  const apps = Array.isArray(data?.applications) ? data.applications : [];
  let changed = false;
  if (owner) {
    if (writeMirror(SUP_PREFIX + owner, suppliers)) changed = true;
    if (writeMirror(BOUND_PREFIX + owner, bound)) changed = true;
  }
  if (writeMirror(APPS_KEY, apps)) changed = true;
  lastKeys.suppliers = new Set(suppliers.map(supKeyOf).filter(Boolean));
  lastKeys.bound = new Set(bound.map(boundKeyOf).filter(Boolean));
  lastKeys.apps = new Set(apps.map(appKeyOf).filter(Boolean));
  hydratedOnce = true;
  return changed;
}

// ============ 读：拉取权威快照并回灌镜像 ============
let hydrating: Promise<boolean> | null = null;
export async function hydrateCooperation(force = false): Promise<boolean> {
  if (!force && hydrating) return hydrating;
  const p = (async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/cooperation/snapshot`, { headers: authHeaders() }, 12000);
      if (!res.ok) return false;
      const body = await res.json();
      if (body?.code !== 200 || !body?.data) return false;
      const changed = snapshotToMirrors(body.data);
      // 仅在镜像真的变化时派发刷新：sync-data-updated 复用既有页面重载监听，cooperation-hydrated 供新逻辑
      if (changed) {
        try { window.dispatchEvent(new Event('cooperation-hydrated')); } catch { /* ignore */ }
        try { window.dispatchEvent(new Event('sync-data-updated')); } catch { /* ignore */ }
        try { window.dispatchEvent(new Event('cooperation-applications-changed')); } catch { /* ignore */ }
      }
      return true;
    } catch { return false; }
    finally { hydrating = null; }
  })();
  hydrating = p;
  return p;
}

// ============ 写：防抖推送 ============
type Section = 'suppliers' | 'bound' | 'apps';
const pendingPush = new Map<string, { timer: any; value: string }>();

function removedAgainst(section: Section, currentKeys: Set<string>): string[] {
  // 仅对本人已水合的键集计算删除，未水合（新设备/离线）时不申报删除，杜绝空表擦除服务端
  if (!hydratedOnce) return [];
  const prev = section === 'suppliers' ? lastKeys.suppliers : section === 'bound' ? lastKeys.bound : lastKeys.apps;
  return Array.from(prev).filter(k => !currentKeys.has(k));
}

async function doPush(key: string, value: string): Promise<void> {
  let rows: any[] = [];
  try { rows = JSON.parse(value || '[]'); } catch { rows = []; }
  if (!Array.isArray(rows)) rows = [];
  const owner = cooperationOwner();
  const payload: any = {};

  if (key.startsWith(SUP_PREFIX)) {
    const target = key.slice(SUP_PREFIX.length);
    const cur = new Set(rows.map(supKeyOf).filter(Boolean));
    const own = target === owner;
    payload.supplierDirectory = { owner: target, rows, removedKeys: own ? removedAgainst('suppliers', cur) : [] };
    if (own) lastKeys.suppliers = cur;
  } else if (key.startsWith(BOUND_PREFIX)) {
    const target = key.slice(BOUND_PREFIX.length);
    const cur = new Set(rows.map(boundKeyOf).filter(Boolean));
    const own = target === owner;
    payload.boundPurchasers = { owner: target, rows, removedKeys: own ? removedAgainst('bound', cur) : [] };
    if (own) lastKeys.bound = cur;
  } else if (key === APPS_KEY) {
    const cur = new Set(rows.map(appKeyOf).filter(Boolean));
    payload.applications = { rows, removedKeys: removedAgainst('apps', cur) };
    lastKeys.apps = cur;
  } else {
    return;
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/cooperation/push`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }, 20000);
    if (!res.ok) return;
    const body = await res.json();
    // 服务端返回 actor 最新权威快照：回灌本人镜像（跨租户代写的对方键不在快照内，本地保留原样）；
    // 服务端合并了其他设备的行时镜像会变化，派发刷新让本页与既有监听同步收敛
    if (body?.code === 200 && body?.data) {
      const changed = snapshotToMirrors(body.data);
      if (changed) {
        try { window.dispatchEvent(new Event('cooperation-hydrated')); } catch { /* ignore */ }
        try { window.dispatchEvent(new Event('sync-data-updated')); } catch { /* ignore */ }
        try { window.dispatchEvent(new Event('cooperation-applications-changed')); } catch { /* ignore */ }
      }
    }
  } catch { /* 离线/超时：镜像保留，下次触发重试 */ }
}

/** setItem 全局钩子回调：三个合作键变更后防抖推送到服务端权威真表 */
export function scheduleCooperationUpload(key: string, value: string): void {
  if (!isCooperationKey(key)) return;
  // 无变化跳过：加载收敛/重复回灌写回同一内容时不推送，杜绝回环
  if (lastValue.get(key) === value) return;
  const prev = pendingPush.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => { pendingPush.delete(key); void doPush(key, value); }, 800);
  pendingPush.set(key, { timer, value });
}

/** 立即推送并等待完成（关键握手动作后调用，确保服务端已落库） */
export async function flushCooperationUpload(key: string): Promise<void> {
  const prev = pendingPush.get(key);
  if (prev) { clearTimeout(prev.timer); pendingPush.delete(key); await doPush(key, prev.value); }
}

/** 刷新所有待推送（页面隐藏/关闭前调用，避免防抖未触发的写入丢失） */
export function flushAllCooperationUploads(): void {
  pendingPush.forEach((entry, key) => { clearTimeout(entry.timer); void doPush(key, entry.value); });
  pendingPush.clear();
}

// ============ 启动/轮询安装 ============
let pollInstalled = false;
export function installCooperationSync(): void {
  if (pollInstalled) return;
  pollInstalled = true;
  // 启动即拉一次；随后每 45s、可见性恢复、聚焦各拉一次（替代旧全局同步对这些键的拉取）
  void hydrateCooperation();
  setInterval(() => { void hydrateCooperation(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAllCooperationUploads(); else void hydrateCooperation(); });
  window.addEventListener('focus', () => { void hydrateCooperation(); });
  // 页面隐藏/关闭前刷出待推送，避免 800ms 防抖未触发的写入丢失
  window.addEventListener('pagehide', () => flushAllCooperationUploads());
  window.addEventListener('beforeunload', () => flushAllCooperationUploads());
}
