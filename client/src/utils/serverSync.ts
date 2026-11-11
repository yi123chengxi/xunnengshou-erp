/**
 * 跨浏览器数据同步（客户端）：
 * - 服务端（SQLite）是唯一可信数据源，localStorage / IndexedDB 仅作为本地缓存；
 * - 写入钩子：localStorage 业务数据变更后防抖上传到服务端；
 * - 启动拉取：登录后先从服务端拉取全量数据覆盖本地缓存；
 *   本地有但服务端没有的数据自动上传（首次迁移）；
 * - 服务端不可用时全部静默降级为纯本地模式，不影响现有功能。
 */
import { saveDataset, loadDataset } from './dataStore';
import { getOriginalSetItem, safeSetItem, emergencyFreeSpace } from './storageQuota';
import { API_BASE } from './apiBase';
import { repairPurchaserSupplierNames } from './cooperationTerminate';
import { reconcileCooperationPairs } from './cooperationReconcile';
import { migrateLegacyReconRecords } from './reconStore';
import { repairCounterpartyNames } from './nameSync';
import { healReconTerminalLinks } from './reconHeal';

// 需要同步的业务数据 key 前缀/精确名
// 注意：customer_pay_summary_/supplier_pay_summary_ 为本地派生快照（由订单/账单/台账重算），禁止跨端同步——
// 否则任一端在源数据未拉全时算出 0 快照上传，会经 pull 宽限期覆盖其他端的正确快照，表现为采购总额跳动/归 0
const SYNC_PREFIXES = ['pageData_', 'custom_', 'warehouses_', 'purchaser_suppliers_', 'boundPurchasers_', 'accounts_', 'shop_info_', 'shop_profit_', 'month_end_check_', 'withdrawal_record_', 'dev_', 'hr_', 'newstyle_', 'brandauth_', 'molds_', 'credit_adjustments_', 'published_credit_', 'payment_requests_', 'payment_request_managers_', 'notification_settings_', 'print_template_', 'price_strategy_', 'user_notice_', 'invoice_record_', 'invoice_apply_requests_', 'purchaser_bills_', 'recon_db_', 'roles_', 'preset_role_overrides_', 'role_permsettings_', 'customers_', 'supplier_payments_', 'customerReceipts_', 'inventory_check_', 'stock_change_log_', 'sales_outbound_'];
const SYNC_EXACT = ['registeredUsers', 'subscription_orders', 'storage_orders', 'market_publish_orders', 'market_ratings', 'market_trade_orders', 'market_visitor_cart_shares', 'market_mold_listings', 'purchaser_pushed_orders', 'cooperation_applications', 'cooperation_invites', 'recon_records', 'recon_feedback', 'company_renames'];
// 图片块体积大，不参与跨浏览器同步（各浏览器独立）
const EXCLUDE_PREFIXES = ['prodImg_', 'thumb_', 'payShot_', 'mold_img_'];
// 仅上传不拉取的键前缀（这类键有独立的恢复机制，避免 pullAllDatasets 的宽限期竞态覆盖本地新数据）
const UPLOAD_ONLY_PREFIXES = ['credit_adjustments_'];
// 只增不删的全局列表键（无删除 UI）：允许愈合回传修复服务端缩水，且不会复活已删除记录
const APPEND_ONLY_GLOBAL_KEYS = ['market_trade_orders', 'purchaser_pushed_orders'];
// 带下架语义的全局列表键：并集合并会在查看端复活已删除记录并回传服务器，
// 拉取时改为“服务端不旧于本地则整体替换；本地有更新写入则保留本地但同步服务端墓碑”
const REPLACE_PULL_GLOBAL_KEYS = ['market_publish_orders'];
// 一次性 salvage 回灌的账单类私有键前缀：这些键曾被跨端镜像整键覆盖擦除，
// 升级后首轮拉取把「本地有、服务端缺失」的行并集回灌服务端（仅一次，避免长期破坏删除语义）
const SALVAGE_UNION_PREFIXES = ['purchaser_bills_', 'pageData_customer_bill-detail_'];

export function isSyncKey(key: string): boolean {
  if (!key || key.endsWith('_ts')) return false;
  if (EXCLUDE_PREFIXES.some(p => key.startsWith(p))) return false;
  return SYNC_EXACT.includes(key) || SYNC_PREFIXES.some(p => key.startsWith(p));
}

/** 判断是否为仅上传不拉取的键（有独立恢复机制，pullAllDatasets 应跳过） */
export function isUploadOnlyKey(key: string): boolean {
  return UPLOAD_ONLY_PREFIXES.some(p => key.startsWith(p));
}

/** 当前登录账号的数据归属者（子账号归父账号），与页面 getDataOwner 保持一致 */
function currentOwner(): string {
  try {
    if (localStorage.getItem('isSubAccount') === 'true') {
      return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    }
    return localStorage.getItem('username') || '';
  } catch { return ''; }
}

/** key 的 owner 后缀（pageData_module_child_owner / xxx_owner 的最后一段）；全局 key 返回 null */
function keyOwner(key: string): string | null {
  if (key === 'registeredUsers') return null;
  // 合作申请为双方跨租户协作数据：全局共享同步（并集合并），保证供应商/采购商跨浏览器互见申请与审批结果
  if (key === 'cooperation_applications') return null;
  // 对账记录/对账反馈/公司改名记录为双方跨租户协作数据：全局共享同步，保证发起方与接收方跨浏览器互见
  if (key === 'recon_records' || key === 'recon_feedback' || key === 'company_renames') return null;
  // 分平台对账独立库（recon_db_supplier_<账号> / recon_db_purchaser_<账号>）：跨租户协作数据，全局同步
  if (key.startsWith('recon_db_')) return null;
  // 商机市场相关键为全局共享数据（跨账号可见），返回 null 使所有账号都能同步
  if (key.startsWith('market_')) return null;
  // 打印模板为系统级预设/共享数据：跨账号同步，部署后新浏览器自动拉取
  if (key.startsWith('print_template_')) return null;
  const idx = key.lastIndexOf('_');
  if (idx < 0) return key;
  return key.slice(idx + 1);
}

/** 判断是否为全局共享键（跨账号同步，如 registeredUsers、market_*） */
function isGlobalKey(key: string): boolean {
  return keyOwner(key) === null;
}

/** 仅同步当前账号自己的数据集 + 全局键（registeredUsers / market_*），避免拉取他人账号数据造成本地配额溢出/串号 */
function isKeyForCurrentAccount(key: string): boolean {
  if (key.startsWith('dev_')) return true; // 开发者后台数据（子账号/客户分组/客户权限）为全局数据，跨浏览器同步
  const owner = keyOwner(key);
  if (owner === null) return true; // 全局 key
  const cur = currentOwner();
  return owner === cur || owner === '' || owner === 'default';
}

// ============ 服务器可用性探测（15s 缓存，超时 1.5s） ============
let serverState: { ok: boolean; at: number } = { ok: false, at: 0 };
async function serverAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - serverState.at < 15000) return serverState.ok;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000); // 360浏览器等较慢环境给 5s 超时
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    serverState = { ok: res.ok, at: now };
  } catch {
    serverState = { ok: false, at: now };
  }
  return serverState.ok;
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 5000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ============ 上传（防抖合并，800ms） ============
const pending = new Map<string, { timer: any; value: string; ts: number }>();

// 客户端已知的服务端版本（meta 时间戳）：上传时携带 baseTs 供服务端乐观并发判断
const knownTs = new Map<string, number>();

// 显式删除申报：删除操作在写存储前调用 declareShrink 登记被删行 id，
// 本次上传随 body 携带 removedIds，服务端据此才允许从「永不缩水键」中移除这些行；
// 未申报的缩水（镜像/重建丢行等意外）在服务端被并集保留，物理杜绝误擦除。
const pendingRemovedIds = new Map<string, string[]>();
export function declareShrink(key: string, removedIds: string[]): void {
  if (!removedIds || removedIds.length === 0) return;
  const prev = pendingRemovedIds.get(key) || [];
  pendingRemovedIds.set(key, Array.from(new Set([...prev, ...removedIds])));
}

async function doUpload(key: string, json: string, ts?: number, baseTs?: number): Promise<void> {
  if (!(await serverAvailable())) return;
  const removedIds = pendingRemovedIds.get(key);
  if (removedIds) pendingRemovedIds.delete(key);
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/dataset`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // 上传数据本身的写入时间戳（而非上传时刻）+ 已知服务端版本 baseTs + 显式删除申报 removedIds
      body: JSON.stringify({ key, json, updatedAt: ts || Date.now(), baseTs: baseTs ?? knownTs.get(key) ?? 0, ...(removedIds && removedIds.length ? { removedIds } : {}) }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.newTs === 'number') knownTs.set(key, data.newTs);
    }
  } catch {
    serverState = { ok: false, at: Date.now() };
  }
}

/** 写入钩子回调：业务 key 变更后调度上传，并刷新本地 _ts 时间戳 */
export function scheduleDatasetUpload(key: string, value: string): void {
  if (!isSyncKey(key)) return;
  // 记录本地写入时间戳，供启动拉取时新旧比对（原生写入，不触发钩子递归）
  const ts = Date.now();
  const baseTs = knownTs.get(key) ?? 0;
  try { getOriginalSetItem()(`${key}_ts`, String(ts)); } catch { /* ignore */ }
  const exist = pending.get(key);
  if (exist) {
    exist.value = value;
    exist.ts = ts;
    clearTimeout(exist.timer);
    exist.timer = setTimeout(() => { pending.delete(key); void doUpload(key, exist.value, exist.ts, baseTs); }, 800);
  } else {
    const entry = { value, ts, timer: null as any };
    entry.timer = setTimeout(() => { pending.delete(key); void doUpload(key, entry.value, entry.ts, baseTs); }, 800);
    pending.set(key, entry);
  }
}

/** 立即上传（注册等关键操作后调用） */
export function flushDatasetUpload(key: string, value: string): void {
  if (!isSyncKey(key)) return;
  const e = pending.get(key);
  if (e) { clearTimeout(e.timer); pending.delete(key); }
  void doUpload(key, value);
}

/** 立即上传并等待完成（关键数据保存后确保服务端已落库） */
export async function flushDatasetUploadAsync(key: string, value: string): Promise<boolean> {
  if (!isSyncKey(key)) return false;
  const e = pending.get(key);
  if (e) { clearTimeout(e.timer); pending.delete(key); }
  if (!(await serverAvailable())) return false;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/dataset`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, json: value, updatedAt: Date.now(), baseTs: knownTs.get(key) ?? 0 }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.newTs === 'number') knownTs.set(key, data.newTs);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 从服务端恢复指定 key 的数据到 localStorage（当本地数据丢失时调用） */
export async function ensureDatasetFromServer(key: string): Promise<boolean> {
  if (!isSyncKey(key)) { console.log('[ensureDataset] not sync key:', key); return false; }
  // 先检查 localStorage 是否真的有数据
  try {
    const existing = localStorage.getItem(key);
    console.log('[ensureDataset] key=', key, 'existing=', existing ? existing.substring(0, 100) : existing);
    if (existing && existing !== '[]' && existing !== '""' && existing !== 'null') return false; // 本地有数据，无需恢复
  } catch { /* ignore */ }
  const available = await serverAvailable();
  console.log('[ensureDataset] serverAvailable=', available);
  if (!available) return false;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/dataset?key=${encodeURIComponent(key)}`, {}, 8000);
    console.log('[ensureDataset] fetch status=', res.status);
    if (!res.ok) return false;
    const data = await res.json();
    console.log('[ensureDataset] server data=', data && data.json ? data.json.substring(0, 100) : data);
    if (data && typeof data.json === 'string' && data.json !== '[]' && data.json !== '""') {
      // 使用 safeSetItem（配额溢出时自动紧急清理重试），而非裸 setItem 避免 QuotaExceededError
      safeSetItem(key, data.json);
      safeSetItem(`${key}_ts`, String(data.updatedAt || Date.now()));
      saveDataset(key, data.json);
      console.log('[ensureDataset] restored successfully');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[ensureDataset] error:', e);
    return false;
  }
}

/** 从服务端拉取指定 key 的数据并与本地合并（取并集，按 key/id 去重），返回合并后的 JSON 字符串
 * 用于关键数据的挂载时同步：无论本地是否有数据，都确保服务端数据不丢失 */
export async function mergeDatasetFromServer(key: string): Promise<string | null> {
  if (!isSyncKey(key)) return null;
  if (!(await serverAvailable())) return null;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/dataset?key=${encodeURIComponent(key)}`, {}, 8000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.json !== 'string') return null;
    let serverData: any[] = [];
    try { serverData = JSON.parse(data.json); } catch { serverData = []; }
    if (!Array.isArray(serverData)) return null;
    // 读取本地数据
    let localData: any[] = [];
    try { localData = JSON.parse(localStorage.getItem(key) || '[]'); } catch { localData = []; }
    if (!Array.isArray(localData)) localData = [];
    // 并集合并：服务端优先 + 保留本地服务端没有的记录
    const idOf = (r: any) => (r && (r.key || r.id || r.applicationId)) ? String(r.key || r.id || r.applicationId) : null;
    const sIds = new Set(serverData.map(idOf));
    const onlyLocal = localData.filter((r: any) => idOf(r) !== null && !sIds.has(idOf(r)));
    const merged = [...serverData, ...onlyLocal];
    const mergedJson = JSON.stringify(merged);
    // 写回 localStorage：先紧急清理配额再用 safeSetItem，确保小体积关键数据能写入
    emergencyFreeSpace(key);
    const wrote = safeSetItem(key, mergedJson);
    safeSetItem(`${key}_ts`, String(data.updatedAt || Date.now()));
    saveDataset(key, mergedJson);
    console.log('[mergeDataset] key=', key, 'server=', serverData.length, 'local=', localData.length, 'merged=', merged.length, 'wrote=', wrote);
    // 即使 localStorage 写入失败也返回合并数据，保证当次会话显示正确
    return mergedJson;
  } catch (e) {
    console.error('[mergeDataset] error:', e);
    return null;
  }
}

// ============ 拉取 ============
export async function fetchServerDataset(key: string): Promise<{ json: string; updatedAt: number } | null> {
  if (!(await serverAvailable())) return null;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/dataset?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.json === 'string' ? { json: data.json, updatedAt: Number(data.updatedAt) || 0 } : null;
  } catch {
    return null;
  }
}

/**
 * 跨租户键安全追加（防擦除不变量）：
 * 先取服务端现有内容，与本地、待追加行按 id 做并集（服务端行优先保留、仅补缺失行），
 * 再整键落本地并上传。杜绝「本端浏览器不持有对方私有键→基为空数组→整键覆盖上传擦除对方全部历史数据」。
 * 任何需要写入「非本账号私有键」的场景都必须走本函数，禁止直接 read-local→push→saveDataset。
 */
export async function appendRowsToRemoteKey(key: string, rows: any[], idOf: (r: any) => string | null): Promise<boolean> {
  try {
    let server: any[] = [];
    const rec = await fetchServerDataset(key);
    if (rec && rec.json) { try { const a = JSON.parse(rec.json); if (Array.isArray(a)) server = a; } catch { /* ignore */ } }
    let local: any[] = [];
    try { const a = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(a)) local = a; } catch { /* ignore */ }
    const merged: any[] = [...server];
    const seen = new Set<string>();
    server.forEach((r: any) => { const id = idOf(r); if (id) seen.add(id); });
    local.forEach((r: any) => { const id = idOf(r); if (!id || seen.has(id)) return; seen.add(id); merged.push(r); });
    let added = 0;
    (rows || []).forEach((r: any) => { const id = idOf(r); if (!id || seen.has(id)) return; seen.add(id); merged.push(r); added++; });
    const json = JSON.stringify(merged);
    const raw = getOriginalSetItem();
    raw(key, json);
    raw(`${key}_ts`, String(Date.now()));
    saveDataset(key, json);
    return added > 0;
  } catch { return false; }
}

async function localTimestamp(key: string): Promise<number> {
  let ts = 0;
  try {
    ts = Number(localStorage.getItem(`${key}_ts`) || 0) || 0;
    if (!ts && localStorage.getItem(key)) ts = 1;
  } catch { /* ignore */ }
  try {
    const idb = await loadDataset(key);
    if (idb && idb.updatedAt > ts) ts = idb.updatedAt;
  } catch { /* ignore */ }
  return ts;
}

/** 合并服务器账号到本地（并集，本地优先），返回合并后的列表 */
function mergeRegisteredUsers(serverJson: string): any[] | null {
  try {
    const serverUsers = JSON.parse(serverJson);
    if (!Array.isArray(serverUsers)) return null;
    const local: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    let changed = false;
    let permsChanged = false;
    serverUsers.forEach((su: any) => {
      if (!su || !su.username) return;
      const lu = local.find((u: any) => u.username === su.username);
      if (!lu) { local.push(su); changed = true; return; }
      // 手机号字段级同步：管理端编辑补绑/改绑后上传的服务端值须传播到所有设备，
      // 否则子账号登录端本地旧副本 phone 恒空→新设备验证报「未绑定有效手机号」；
      // 服务端空号不回清本地已有号码（防修复前的旧服务端副本反向清除）
      const sp = String(su.phone || '').trim();
      const lp = String(lu.phone || '').trim();
      if (sp && sp !== lp) { lu.phone = sp; changed = true; }
      // 管理端权威字段传播：主账号编辑的角色/独立权限/个人三态覆写/姓名/状态须同步到子账号设备，
      // 否则子账号本地副本停留在「新增账号时」的权限快照，刷新/重登都不更新；
      // _permTs 版本守卫：仅服务端编辑版本更新才采纳，防主账号未上传的本地新编辑被服务端旧值回滚
      // （子账号会话不上传 registeredUsers，主账号为唯一编辑方）
      if ((Number(su._permTs) || 0) > (Number(lu._permTs) || 0)) {
        (['roles', 'customPermissions', 'permOverrides', 'displayName', 'status', '_permTs'] as const).forEach(f => {
          if ((su as any)[f] !== undefined) { (lu as any)[f] = (su as any)[f]; changed = true; permsChanged = true; }
        });
      }
    });
    if (changed) {
      const raw = getOriginalSetItem();
      const json = JSON.stringify(local);
      raw('registeredUsers', json);
      raw('registeredUsers_ts', String(Date.now()));
      saveDataset('registeredUsers', json);
      flushDatasetUpload('registeredUsers', json);
    }
    // 权限字段落地后同标签页派发 perm-changed：已挂载布局的菜单/门控立即按新权限重算
    if (permsChanged) {
      try { window.dispatchEvent(new Event('perm-changed')); } catch { /* ignore */ }
    }
    return local;
  } catch {
    return null;
  }
}

/**
 * 启动时拉取（服务端为唯一数据源）：
 * 1. 从服务端获取所有数据集元信息
 * 2. 服务端有的 → 如果比本地新则覆盖本地
 * 3. 本地有但服务端没有的 → 自动上传（首次迁移 localStorage 数据到数据库）
 * 4. 拉取完成后派发 sync-data-updated 事件通知已挂载页面刷新
 */
/* 查询按键统一契约：先同步按本地存储重载（reload 由调用方提供），再异步拉取服务端最新后二次重载，
 * 保证「点击查询」立即看到本机与他端新增/修改的数据，无需手动刷新浏览器 */
export const reloadAfterPull = (reload: () => void): void => {
  try { reload(); } catch { /* ignore */ }
  void pullAllDatasets()
    .then(() => { try { reload(); } catch { /* ignore */ } })
    .catch(() => { /* ignore */ });
};

export async function pullAllDatasets(): Promise<number> {
  // 对账记录旧全局键 → 分平台独立库的存量迁移（幂等，墓碑优先）
  try { migrateLegacyReconRecords(); } catch { /* ignore */ }
  // 合作存量数据修复：采购商侧供应商名称统一为已认证公司全称（轻量，随同步轮询执行）
  try { repairPurchaserSupplierNames(); } catch { /* ignore */ }
  // 合作方公司名称/信息同步：改名链改写 + 账号名快照修正 + 关联账号信息刷新（随同步轮询执行）
  try { repairCounterpartyNames(); } catch { /* ignore */ }
  // 对账完成联动自愈：终态账单断言回写供应商明细行 + pending 记录任一侧终态即打墓碑（对抗并集合并复活）
  try { healReconTerminalLinks(); } catch { /* ignore */ }
  if (!(await serverAvailable())) return 0;
  let meta: Record<string, number> = {};
  try {
    const res = await fetchWithTimeout(`${API_BASE}/sync/meta`, {}, 5000);
    if (!res.ok) return 0;
    meta = (await res.json()) || {};
  } catch {
    return 0;
  }
  // 记录服务端各数据集版本，供后续上传作 baseTs（乐观并发）
  for (const k of Object.keys(meta)) knownTs.set(k, Number(meta[k]) || 0);
  let applied = 0;

  // 第一步：从服务端拉取较新数据覆盖本地（仅限当前账号自己的数据集，避免拉取他人账号数据）
  // 安全策略：仅当服务端数据比本地新超过 5 秒时才覆盖，避免时钟偏差导致本地新数据被服务端旧数据覆盖
  // 全局共享键（market_* 等）跳过宽限期，始终拉取并与本地合并（并集），确保跨账号数据实时可见
  const GRACE_PERIOD_MS = 5000;
  for (const key of Object.keys(meta)) {
    if (!isSyncKey(key) || !isKeyForCurrentAccount(key)) continue;
    // 仅上传不拉取的键（如 credit_adjustments_）：跳过拉取，避免宽限期竞态覆盖本地新数据
    // 这类键有独立的 ensureDatasetFromServer 恢复机制
    if (isUploadOnlyKey(key)) continue;
    try {
      const serverTs = Number(meta[key]) || 0;
      const localTs = await localTimestamp(key);
      const global = isGlobalKey(key);
      // 全局键跳过宽限期检查，始终拉取；私有键仍需宽限期保护
      // 额外保护：如果私有键的 localStorage 中不存在数据（可能被 iframe/预览环境清空），
      // 无论时间戳如何都必须从服务端拉取，否则刷新后数据丢失
      if (!global && serverTs <= localTs + GRACE_PERIOD_MS) {
        let hasLocalData = false;
        try { hasLocalData = localStorage.getItem(key) !== null; } catch { /* ignore */ }
        if (hasLocalData) continue;
      }
      const rec = await fetchServerDataset(key);
      if (!rec || !rec.json) continue;
      if (key === 'registeredUsers') {
        mergeRegisteredUsers(rec.json);
        applied++;
        continue;
      }
      const raw = getOriginalSetItem();
      if (global) {
        // 下架语义键：并集会让查看端复活已删除记录并经 saveDataset 回传服务器，
        // 服务端版本不旧于本地时直接用服务端整体替换；本地有未上传的新写入时保留本地，
        // 但同步服务端的下架墓碑，避免本地随后上传把已下架卡片复活
        if (REPLACE_PULL_GLOBAL_KEYS.includes(key)) {
          if (serverTs >= localTs) {
            let sameContent = false;
            try { sameContent = localStorage.getItem(key) === rec.json; } catch { /* ignore */ }
            if (!sameContent) { raw(key, rec.json); applied++; }
            raw(`${key}_ts`, String(rec.updatedAt));
          } else {
            let localData: any[] = [];
            try { localData = JSON.parse(localStorage.getItem(key) || '[]'); } catch { localData = []; }
            let serverData: any[] = [];
            try { serverData = JSON.parse(rec.json); } catch { serverData = []; }
            if (Array.isArray(localData) && Array.isArray(serverData)) {
              const idOfR = (r: any) => (r && (r.key || r.id)) ? String(r.key || r.id) : null;
              const tomb = new Map<string, any>();
              serverData.forEach((r: any) => { const id = idOfR(r); if (id && r && r.delisted === true) tomb.set(id, r); });
              let changed = false;
              const mergedLocal = localData.map((r: any) => {
                const id = idOfR(r);
                const t = id ? tomb.get(id) : null;
                if (t && r.delisted !== true) { changed = true; return { ...r, delisted: true, delistedAt: t.delistedAt }; }
                return r;
              });
              const lIds = new Set(localData.map(idOfR));
              serverData.forEach((r: any) => { const id = idOfR(r); if (r && r.delisted === true && id && !lIds.has(id)) { mergedLocal.push(r); changed = true; } });
              if (changed) { raw(key, JSON.stringify(mergedLocal)); applied++; }
            }
          }
          continue;
        }
        // 全局键：与本地数据做并集合并（按 key/id 去重），服务端数据优先
        let localData: any[] = [];
        try { localData = JSON.parse(localStorage.getItem(key) || '[]'); } catch { localData = []; }
        let serverData: any[] = [];
        try { serverData = JSON.parse(rec.json); } catch { serverData = []; }
        if (Array.isArray(localData) && Array.isArray(serverData)) {
          const idOf = (r: any) => (r && (r.key || r.id || r.applicationId)) ? String(r.key || r.id || r.applicationId) : null;
          // 本地墓碑优先：本地已下架/完成但服务端仍是存活版本的记录，不得被服务端旧版复活
          const localById = new Map<string, any>();
          localData.forEach((r: any) => { const id = idOf(r); if (id && r && r.delisted === true) localById.set(id, r); });
          const serverFixed = serverData.map((r: any) => {
            const id = idOf(r);
            const lt = id ? localById.get(id) : null;
            if (lt && r && r.delisted !== true) return { ...r, delisted: true, delistedAt: lt.delistedAt };
            return r;
          });
          const sIds = new Set(serverFixed.map(idOf));
          const onlyLocal = localData.filter((r: any) => !sIds.has(idOf(r)));
          const merged = JSON.stringify([...serverFixed, ...onlyLocal]);
          let sameContent = false;
          try { sameContent = localStorage.getItem(key) === merged; } catch { /* ignore */ }
          if (!sameContent) {
            raw(key, merged);
            raw(`${key}_ts`, String(rec.updatedAt));
            saveDataset(key, merged);
            applied++;
          } else {
            raw(`${key}_ts`, String(rec.updatedAt));
          }
          // 愈合上传：本地持有服务端缺失的记录时，将并集回传服务端（无论本地是否刚被更新），
          // 使任何仍保留历史数据的浏览器能自动修复被意外缩水的服务端数据集；仅限只增不删键
          if (onlyLocal.length > 0 && APPEND_ONLY_GLOBAL_KEYS.includes(key)) {
            void doUpload(key, merged, Date.now()).catch(() => { /* ignore */ });
          }
        } else if (serverTs > localTs) {
          // 非数组全局键（如 recon_feedback 对象映射）：无法并集合并，服务端较新时整体覆盖
          raw(key, rec.json);
          raw(`${key}_ts`, String(rec.updatedAt));
          saveDataset(key, rec.json);
          applied++;
        }
        continue;
      }
      // 私有键：内容相同则仅对齐时间戳，避免无意义的覆盖/事件派发（防止反复重载重置页面筛选）
      let sameContent = false;
      try { sameContent = localStorage.getItem(key) === rec.json; } catch { /* ignore */ }
      if (sameContent) {
        raw(`${key}_ts`, String(rec.updatedAt));
        continue;
      }
      // 一次性 salvage 回灌：账单类私有键曾被跨端镜像整键覆盖擦除；升级后首轮拉取把
      // 「本地有、服务端缺失」的行并集回灌服务端（仅一次，避免长期破坏删除语义），尽可能找回历史账单
      if (SALVAGE_UNION_PREFIXES.some(pfx => key.indexOf(pfx) === 0)) {
        const salvageFlag = `salvage_billunion_v1_${key}`;
        if (!localStorage.getItem(salvageFlag)) {
          try {
            localStorage.setItem(salvageFlag, String(Date.now()));
            let localData: any[] = [];
            try { localData = JSON.parse(localStorage.getItem(key) || '[]'); } catch { localData = []; }
            let serverData: any[] = [];
            try { serverData = JSON.parse(rec.json || '[]'); } catch { serverData = []; }
            if (Array.isArray(localData) && Array.isArray(serverData)) {
              const idOfS = (r: any) => (r && (r.key || r.id)) ? String(r.key || r.id) : null;
              const sIds = new Set(serverData.map(idOfS));
              const onlyLocal = localData.filter((r: any) => { const id = idOfS(r); return !!id && !sIds.has(id); });
              if (onlyLocal.length > 0) {
                const mergedSalvage = JSON.stringify([...serverData, ...onlyLocal]);
                raw(key, mergedSalvage);
                raw(`${key}_ts`, String(rec.updatedAt));
                void doUpload(key, mergedSalvage, Date.now()).catch(() => { /* ignore */ });
                applied++;
                continue;
              }
            }
          } catch { /* ignore */ }
        }
      }
      raw(key, rec.json);
      raw(`${key}_ts`, String(rec.updatedAt));
      saveDataset(key, rec.json);
      applied++;
    } catch { /* ignore */ }
  }

  // 拉取完成后再次闭环对账：服务端拉下的镜像若与本地其他镜像状态分叉，立即对齐
  try { reconcileCooperationPairs(); } catch { /* ignore */ }

  // 拉取后再执行名称/对账终态自愈：服务端旧快照刚覆盖本地，必须立即回写最新公司名与
  // 墓碑回写断言，否则「打开显示新名、点击查询后回到旧名」且供应商侧收不到对账结果
  let postFixed = 0;
  try { repairPurchaserSupplierNames(); } catch { /* ignore */ }
  try { postFixed += repairCounterpartyNames().length; } catch { /* ignore */ }
  try { if (healReconTerminalLinks()) postFixed++; } catch { /* ignore */ }
  if (postFixed > 0) applied++;

  // 第二步：本地有但服务端没有的数据集 → 自动上传（首次迁移，仅限当前账号）
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isSyncKey(key) || key.endsWith('_ts')) continue;
      if (!isKeyForCurrentAccount(key)) continue;
      if (meta[key]) continue; // 服务端已有，跳过
      const json = localStorage.getItem(key);
      if (!json || json === '[]' || json === '""') continue;
      // 携带本地数据的真实写入时间戳，避免旧数据以“最新”时间戳覆盖服务端
      let localTs = 0;
      try { localTs = Number(localStorage.getItem(`${key}_ts`) || 0) || 0; } catch { /* ignore */ }
      await doUpload(key, json, localTs || Date.now());
    }
  } catch { /* 首次迁移失败不影响启动 */ }

  if (applied > 0) {
    // 通知已挂载页面重新读取本地存储，实现多浏览器在线时自动刷新
    try { window.dispatchEvent(new Event('sync-data-updated')); } catch { /* ignore */ }
  }
  return applied;
}
