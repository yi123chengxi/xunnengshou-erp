/**
 * 数据同步路由（双驱动版：DB_DRIVER=sqlite|mysql）
 * 所有业务数据经统一数据访问层 store（SQLite 文件库 或 独立 MySQL 服务器）
 * 不同浏览器登录同一账号 → 读写同一个数据库 → 天然数据同步
 */
import express, { Router, Request, Response } from 'express';
import { store, STORE_DRIVER } from '../database/store';
import { sendPushToUser } from './push.routes';
import {
  applyUsageDeltaForWrite, getCompanyUsageBytes, getAllUsageBytesByCompany, recomputeUsage, getDatasetJson,
} from '../services/storageUsage';
import {
  attachSyncUser, currentSyncUser, requireSyncAuth, isKeyAllowed, filterMetaForUser,
  sanitizeRegisteredUsersJson, hashRegisteredUsersJson, hashPassword, mergeRegisteredUsersJson, SyncUser,
} from '../middleware/syncGuard';
import { notifyDatasetUpdated } from '../ws/chat-ws';

const router = Router();
router.use(express.json({ limit: '60mb' }));
// 解析令牌（有则挂 req.user，无也放行；是否允许访问由各键的公开/归属规则决定）
router.use(attachSyncUser);

/** 统一的键访问拒绝响应：未登录 401，已登录但越权 403 */
const denyLogAt = new Map<string, number>();
function denyKey(res: Response, user: SyncUser | null, key: string, action: string): void {
  // 拒绝日志（同一用户+键 10 分钟一条）：便于排查“某类数据突然不同步”是否被鉴权拦下
  const tag = `${user ? user.username : 'anon'}|${key}|${action}`;
  const now = Date.now();
  if (now - (denyLogAt.get(tag) || 0) > 10 * 60_000) {
    denyLogAt.set(tag, now);
    console.warn(`[sync] 拒绝${action} key=${key} user=${user ? user.username : '(匿名)'}`);
  }
  if (!user) {
    res.status(401).json({ code: 401, message: '未登录或登录已过期，请重新登录' });
    return;
  }
  res.status(403).json({ code: 403, message: `无权${action}该数据(${key})` });
}

// 只增不删的全局列表键：任何情况下不允许整体替换导致记录缩水（无删除 UI，缩水必为客户端本地缺数据误上传）
const APPEND_ONLY_KEYS = ['market_trade_orders', 'purchaser_pushed_orders'];
// 墓碑语义键：即便 baseTs 与服务端版本一致也执行记录级并集合并。
// 这类键的删除/完成靠 delisted 墓碑表达，整体替换会让未同步墓碑的旧端（如另一端浏览器）
// 把已完成/已删除的对账记录重新写回，导致「刷新后又出现」「对账结果不回写」。
const MERGE_ALWAYS_KEYS = ['recon_records'];
// 墓碑语义键前缀：分平台对账独立库（recon_db_supplier_<账号> / recon_db_purchaser_<账号>）
const MERGE_ALWAYS_PREFIXES = ['recon_db_'];
const isMergeAlwaysKey = (key: string): boolean => MERGE_ALWAYS_KEYS.includes(key) || MERGE_ALWAYS_PREFIXES.some(p => key.startsWith(p));
// 永不缩水键前缀（租户核心账单/订单数据，丢失即信任事故）：PUT 一律改为「incoming 并集 + 仅按显式 removedIds 删除」，
// 绝不整键替换。未申报 removedIds 的缩水（跨端镜像空基覆盖/派生重建丢行等意外）在服务端被并集保留，物理杜绝误擦除；
// 合法删除由客户端删除操作随 body 申报 removedIds 生效（订单：仅撤回缺货拆分合并子单时申报）。
// 合作镜像键（purchaser_suppliers_ / boundPurchasers_）同样纳入：双方协作链路都会代写「对方账号下的键」，
// 而这类非本账号键不参与本端启动拉取（isKeyForCurrentAccount 过滤），代写端持有的可能是一份陈旧快照；
// 又因共享键对任何登录用户都下发 meta，陈旧副本会拿到「与服务端一致的 baseTs」→ 走整键替换分支 →
// 对方刚新增的供应商/采购商卡片被陈旧副本擦掉、刚建立的合作被改回旧状态。表现为列表数量与状态来回跳动。
const NEVER_SHRINK_PREFIXES = ['purchaser_bills_', 'pageData_customer_bill-detail_', 'pageData_sales_order-manage_', 'purchaser_suppliers_', 'boundPurchasers_', 'accounts_'];
// accounts_<主账号> 为账号列表：多个浏览器共同维护同一份名单，任何一端拿着陈旧名单整键上传
// 都会把另一端刚建的账号擦掉（表现为「新增的子账号在别的浏览器没有」）。
// 行内有 key/id，可按 removedIds 精确删除；未申报的缩水一律并集保留。
const isNeverShrinkKey = (key: string): boolean => NEVER_SHRINK_PREFIXES.some(p => key.startsWith(p));

// ============ 权限类数据集变更实时通知 ============
// 权限数据写入成功后，经聊天 WebSocket 通知该租户所有在线端（主账号 + 全部子账号）
// 立即增量拉取，使「另一个浏览器给子账号改权限」无需刷新/等轮询即可生效。
const PERM_NOTIFY_EXACT = ['registeredUsers'];
const PERM_NOTIFY_PREFIXES = ['dev_', 'roles_', 'role_permsettings_', 'preset_role_overrides_', 'accounts_', 'account_groups_'];

function permNotifyTargets(key: string, user: SyncUser | null): string[] {
  if (!user) return [];
  if (!(PERM_NOTIFY_EXACT.includes(key) || PERM_NOTIFY_PREFIXES.some(p => key.startsWith(p)))) return [];
  const targets = new Set<string>();
  if (user.owner) targets.add(user.owner);
  if (user.username) targets.add(user.username);
  // 开发者后台改客户权限：键内后缀是被改的客户账号，直接通知该客户
  const m = key.match(/^dev_customer_(?:perms|deny)_(.+)$/);
  if (m && m[1]) targets.add(m[1]);
  return [...targets];
}

/** 写入成功后通知在线端拉取（静默失败：不影响写库结果，仍有 60 秒轮询兜底） */
function notifyPermDatasetChanged(key: string, user: SyncUser | null): void {
  const targets = permNotifyTargets(key, user);
  if (targets.length === 0) return;
  try { notifyDatasetUpdated(targets, key); } catch { /* ignore */ }
}

// 合作镜像键的状态单调保护：双方都携带显式 statusTs（状态变更时刻）且服务端记录的事件更新时，
// 不允许陈旧副本把状态字段写回旧值；其余字段仍以 incoming 为准。任一侧缺少 statusTs 时不改写原语义，
// 避免把「未打时间戳的合法状态变更」误判为陈旧而永久卡死。
const COOPERATION_MIRROR_PREFIXES = ['purchaser_suppliers_', 'boundPurchasers_'];
const isCooperationMirrorKey = (key: string): boolean => COOPERATION_MIRROR_PREFIXES.some(p => key.startsWith(p));
const STATUS_EVENT_FIELDS = ['cooperationStatus', 'status', 'terminateAt', 'terminateBy', 'statusTs'];
const explicitStatusTs = (r: any): number => (r && typeof r === 'object' && r.statusTs !== undefined && r.statusTs !== null && Number(r.statusTs) > 0) ? Number(r.statusTs) : 0;
function protectStaleStatus(existing: any, incoming: any): any {
  const et = explicitStatusTs(existing);
  const it = explicitStatusTs(incoming);
  if (!et || !it || et <= it) return incoming;
  const out: any = { ...incoming };
  STATUS_EVENT_FIELDS.forEach((f) => {
    if (existing[f] !== undefined) out[f] = existing[f];
    else delete out[f];
  });
  return out;
}

// ============ 收/付申请待处理推送（系统级 Web Push，浏览器关闭仍可提醒） ============
const payReqPushThrottle = new Map<string, number>();

/** 待处理记录口径：收款确认(pending_confirm) / 付款审核(pending_review) / 待支付(approved) */
function actionablePayRequests(list: any): any[] {
  if (!Array.isArray(list)) return [];
  return list.filter((r: any) =>
    (r && r.recordType === 'receipt' && r.status === 'pending_confirm') ||
    (r && r.recordType !== 'receipt' && (r.status === 'pending_review' || r.status === 'approved'))
  );
}

/** 数据集写入后比对新增待处理记录，向负责人推送系统通知 */
async function notifyNewPayRequests(key: string, oldJson: string, newJson: string): Promise<void> {
  try {
    const oldKeys = new Set(actionablePayRequests(JSON.parse(oldJson)).map((r: any) => String(r.key)));
    const fresh = actionablePayRequests(JSON.parse(newJson)).filter((r: any) => !oldKeys.has(String(r.key)));
    if (fresh.length === 0) return;
    const owner = key.replace(/^payment_requests_/, '');
    let managers: any = {};
    try {
      const mrow = await store.getDataset(`payment_request_managers_${owner}`);
      if (mrow) managers = JSON.parse(mrow.dataset_json || '{}');
    } catch { /* ignore */ }
    for (const rec of fresh.slice(0, 3)) {
      const rk = String(rec.key);
      const nowTs = Date.now();
      if (nowTs - (payReqPushThrottle.get(rk) || 0) < 60_000) continue;
      payReqPushThrottle.set(rk, nowTs);
      const cat = rec.recordType === 'receipt' ? 'receipt' : rec.status === 'pending_review' ? 'review' : 'pay';
      const title = cat === 'receipt' ? '收款确认提醒' : cat === 'review' ? '付款审核提醒' : '待支付提醒';
      const who = String(rec.payerName || rec.supplierName || rec.applicantName || rec.description || '');
      const body = `${rec.requestNo || ''} ${who} ¥${Number(rec.amount || 0).toFixed(2)} 待处理，点击可直接处理`;
      let targets: string[] = Array.isArray(managers[cat]) ? managers[cat].filter((x: any) => !!x) : [];
      if (targets.length === 0) targets = [owner];
      for (const u of targets) {
        try {
          // 弹窗设置开关：pay-request 关闭后不推送
          const srow = await store.getDataset(`notification_settings_${u}`);
          if (srow) {
            const s = JSON.parse(srow.dataset_json || '{}');
            if (s['pay-request'] === false) continue;
          }
        } catch { /* ignore */ }
        sendPushToUser(u, title, body, {
          url: `/finance/payment-request?payreq=${encodeURIComponent(rk)}&tab=${cat}`,
          tag: `payreq-${rk}`,
          payreqKey: rk,
          payreqTab: cat,
          actions: [{ action: 'handle', title: '立即处理' }, { action: 'dismiss', title: '稍后处理' }],
        }).catch(() => { /* ignore */ });
      }
    }
  } catch { /* ignore */ }
}

// ============ 数据集 CRUD ============

/** 获取所有数据集的元信息（key + 更新时间） */
router.get('/meta', async (req: Request, res: Response) => {
  try {
    const rows = await store.getAllMeta();
    const meta: Record<string, number> = {};
    for (const r of rows) {
      meta[r.dataset_key] = r.updated_at;
    }
    // 匿名只返回公开键（避免被枚举他人账号下的数据集名称）
    res.json(filterMetaForUser(meta, currentSyncUser(req)));
  } catch (err: any) {
    console.error('[sync] /meta error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** 获取单个数据集 */
router.get('/dataset', async (req: Request, res: Response) => {
  try {
    const key = String(req.query.key || '');
    if (!key) { res.status(400).json({ error: 'missing key' }); return; }
    const user = currentSyncUser(req);
    if (!isKeyAllowed(key, user, 'read')) { denyKey(res, user, key, '读取'); return; }
    const row = await store.getDataset(key);
    if (!row) { res.status(404).json({ error: 'not found' }); return; }
    // 账号数据集读取脱敏：不下发任何密码凭据
    const json = key === 'registeredUsers' ? sanitizeRegisteredUsersJson(row.dataset_json) : row.dataset_json;
    res.json({ key: row.dataset_key, json, updatedAt: row.updated_at });
  } catch (err: any) {
    console.error('[sync] /dataset GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** 写入/更新数据集（乐观并发 + 记录级合并）
 * - 客户端携带 baseTs（其已知的服务端版本）：
 *   baseTs === 服务端当前版本 → 客户端是最新的 → 整体替换（尊重删除/编辑）；
 *   baseTs !== 服务端当前版本 → 客户端数据已过期 → 按 key/id 并集合并，
 *   保护该客户端“不知道”的新增记录不被旧数据覆盖删除。
 */
router.put('/dataset', async (req: Request, res: Response) => {
  try {
    const { key, updatedAt, baseTs, force } = req.body;
    let json = req.body.json;
    if (!key || typeof json !== 'string') { res.status(400).json({ error: 'missing key or json' }); return; }
    const user = currentSyncUser(req);
    if (!isKeyAllowed(key, user, 'write')) { denyKey(res, user, key, '写入'); return; }
    // 权限类数据集落库成功后通知该租户在线端立即拉取（响应正常结束才算保存成功）
    res.on('finish', () => { if (res.statusCode < 400) notifyPermDatasetChanged(key, user); });
    // 账号数据集写入前处理：明文密码统一转 bcrypt 哈希，服务端不再落明文
    if (key === 'registeredUsers') {
      const existing = await store.getDataset(key).catch(() => null);
      const existingJson = existing ? existing.dataset_json : null;
      // 行级并集：新增账号采纳、权限字段按 _permTs 保护、缩水需显式申报 removedIds
      // （子账号会话也要能建号：旧逻辑把子账号写入直接拦在客户端，导致新账号只留在本机）
      const guarded = existingJson ? mergeRegisteredUsersJson(existingJson, json, req.body.removedIds) : json;
      json = await hashRegisteredUsersJson(guarded, existingJson);
    }
    const ts = Number(updatedAt) || Date.now();
    const owner = extractOwner(key);
    const row = await store.getDataset(key);

    if (!row) {
      await store.forceUpsertDataset(key, json, owner, ts);
      await applyUsageDeltaForWrite(key, null, json);
      res.json({ saved: true, newTs: ts });
      return;
    }
    if (force) {
      const finalTs = Math.max(ts, row.updated_at);
      await store.forceUpsertDataset(key, json, owner, finalTs);
      await applyUsageDeltaForWrite(key, row.dataset_json, json);
      if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, json);
      res.json({ saved: true, newTs: finalTs });
      return;
    }
    if (Number(baseTs) === row.updated_at) {
      // 永不缩水键：即使客户端自认为最新，也仅允许「并集 + 显式 removedIds 删除」，禁止整键替换擦除存量行
      // （行缺 key/id 无法安合并时，退而记录级并集，仍比整键替换安全）
      if (isNeverShrinkKey(key)) {
        const coop = isCooperationMirrorKey(key);
        const guarded = mergeWithExplicitRemovals(row.dataset_json, json, req.body.removedIds, coop)
          || mergeArrayDatasets(row.dataset_json, json, isMergeAlwaysKey(key), coop);
        if (guarded) {
          const gTs = Math.max(ts, row.updated_at);
          await store.forceUpsertDataset(key, guarded, owner, gTs);
          await applyUsageDeltaForWrite(key, row.dataset_json, guarded);
          res.json({ saved: true, merged: true, newTs: gTs });
          return;
        }
      }
      // 只增不删键/墓碑语义键：即使客户端自认为最新，也强制记录级并集合并，
      // 防止本地缺数据的客户端清空服务端记录或复活已墓碑的记录
      if (APPEND_ONLY_KEYS.includes(key) || isMergeAlwaysKey(key)) {
        const guarded = mergeArrayDatasets(row.dataset_json, json, isMergeAlwaysKey(key));
        if (guarded) {
          const gTs = Math.max(ts, row.updated_at);
          await store.forceUpsertDataset(key, guarded, owner, gTs);
          await applyUsageDeltaForWrite(key, row.dataset_json, guarded);
          if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, guarded);
          res.json({ saved: true, merged: true, newTs: gTs });
          return;
        }
      }
      // 客户端基于最新版本修改 → 整体替换
      const finalTs = Math.max(ts, row.updated_at);
      await store.forceUpsertDataset(key, json, owner, finalTs);
      await applyUsageDeltaForWrite(key, row.dataset_json, json);
      if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, json);
      res.json({ saved: true, newTs: finalTs });
      return;
    }
    // 客户端已过期 → 并集合并，防止旧数据删除新增记录
    const coop = isCooperationMirrorKey(key);
    const merged = isNeverShrinkKey(key)
      ? (mergeWithExplicitRemovals(row.dataset_json, json, req.body.removedIds, coop) || mergeArrayDatasets(row.dataset_json, json, isMergeAlwaysKey(key), coop))
      : mergeArrayDatasets(row.dataset_json, json, isMergeAlwaysKey(key), coop);
    const finalJson = merged || json;
    const finalTs = Math.max(ts, row.updated_at);
    await store.forceUpsertDataset(key, finalJson, owner, finalTs);
    await applyUsageDeltaForWrite(key, row.dataset_json, finalJson);
    if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, finalJson);
    res.json({ saved: true, merged: !!merged, newTs: finalTs });
  } catch (err: any) {
    console.error('[sync] /dataset PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** 数组数据集并集合并：incoming 版本优先，existing 中 incoming 不认识的记录追加保留
 * fieldLevel=true（对账类键 recon_records / recon_db_*）：同一记录按字段并集合并，
 * 保留 existing 中 incoming 未携带的字段。对账记录由供应商/采购商双端各写不同断言字段
 * （supResult/supPerson vs purResult/purPerson），整条覆盖会互相抹除对方刚写入的结果；
 * 字段级并集让两端贡献共存，incoming 显式携带的字段（含清空为 ''）仍以 incoming 为准。 */
function mergeArrayDatasets(existingJson: string, incomingJson: string, fieldLevel = false, coopGuard = false): string | null {
  try {
    const a = JSON.parse(existingJson);
    const b = JSON.parse(incomingJson);
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const idOf = (r: any) => (r && (r.key || r.id)) ? String(r.key || r.id) : null;
    const bIds = new Set(b.map(idOf));
    if (bIds.has(null)) return null; // 存在无 key/id 的记录，无法安全合并
    // 墓碑优先：服务端持有同 id 的 delisted 版本时，incoming 的存活版本不得复活它（成品市场等下架语义键）
    const aById = new Map<string, any>();
    a.forEach((r: any) => { const id = idOf(r); if (id) aById.set(id, r); });
    const bFixed = b.map((r: any) => {
      const id = idOf(r);
      const av = id ? aById.get(id) : null;
      if (!av) return r;
      // 字段级并集：existing 为底、incoming 覆盖其上（incoming 省略的字段保留 existing 值）
      const base = fieldLevel ? { ...av, ...r } : (coopGuard ? protectStaleStatus(av, r) : r);
      if (av.delisted === true && base.delisted !== true) return { ...base, delisted: true, delistedAt: av.delistedAt };
      return base;
    });
    const aOnly = a.filter((r: any) => !bIds.has(idOf(r)));
    if (aOnly.length === 0) return JSON.stringify(bFixed);
    return JSON.stringify([...bFixed, ...aOnly]);
  } catch { return null; }
}

/** 永不缩水键合并：incoming 行优先保留，existing 中 incoming 未携带的行仅当其 id 在显式 removedIds 中才丢弃，
 * 否则一律追加保留（意外缩水被服务端拦截）。incoming 含无 key/id 行时无法安全合并，返回 null 回退原语义。
 * 安全加固（L3）：removedIds 仅认可「确实存在于该键存量行」的 id（交集），并设单次上限，越界/不存在部分忽略，
 * 防止伪造/超量 removedIds 删除非预期行。 */
const MAX_EXPLICIT_REMOVALS = 200;
function mergeWithExplicitRemovals(existingJson: string, incomingJson: string, removedIds: any, coopGuard = false): string | null {
  try {
    const a = JSON.parse(existingJson);
    const b = JSON.parse(incomingJson);
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const idOf = (r: any) => (r && (r.key || r.id)) ? String(r.key || r.id) : null;
    if (b.some((r: any) => !idOf(r))) return null;
    const aIds = new Set<string>(a.map(idOf).filter((x: any): x is string => !!x));
    let rmList = (Array.isArray(removedIds) ? removedIds : []).map((x: any) => String(x)).filter((id: string) => aIds.has(id));
    if (rmList.length > MAX_EXPLICIT_REMOVALS) rmList = rmList.slice(0, MAX_EXPLICIT_REMOVALS);
    const rm = new Set<string>(rmList);
    const bIds = new Set(b.map(idOf));
    const keepFromExisting = a.filter((r: any) => {
      const id = idOf(r);
      return !!id && !bIds.has(id) && !rm.has(id);
    });
    let rows: any[] = b;
    if (coopGuard) {
      const aById = new Map<string, any>();
      a.forEach((r: any) => { const id = idOf(r); if (id) aById.set(id, r); });
      rows = b.map((r: any) => {
        const id = idOf(r);
        const av = id ? aById.get(id) : null;
        return av ? protectStaleStatus(av, r) : r;
      });
    }
    return JSON.stringify([...rows, ...keepFromExisting]);
  } catch { return null; }
}

/** 删除数据集 */
router.delete('/dataset', async (req: Request, res: Response) => {
  try {
    const key = String(req.query.key || '');
    if (!key) { res.status(400).json({ error: 'missing key' }); return; }
    const delUser = currentSyncUser(req);
    if (!isKeyAllowed(key, delUser, 'delete')) { denyKey(res, delUser, key, '删除'); return; }
    const oldJson = await getDatasetJson(key);
    await store.deleteDataset(key);
    await applyUsageDeltaForWrite(key, oldJson, null);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 存储用量（增量计数器） ============

/** 查询公司数据库用量（字节）
 *  用量是公司（主账号）级口径：一律以令牌里的 owner 为准，忽略前端传入的账号名，
 *  并把主账号名下所有子账号的用量计入同一份总数，
 *  保证同一企业的主账号与任意子账号、任意浏览器查到完全同一个数字 */
router.get('/usage', requireSyncAuth, async (req: Request, res: Response) => {
  const u = currentSyncUser(req);
  const owner = String(u?.owner || u?.username || req.query.owner || '');
  if (!owner) { res.status(400).json({ error: 'missing owner' }); return; }
  res.json({ code: 0, data: { owner, bytes: await getCompanyUsageBytes(owner) } });
});

/** 全部用量映射（开发者后台列表用）：主账号行为公司合计，子账号行为其自身明细 */
router.get('/usage-all', requireSyncAuth, async (_req: Request, res: Response) => {
  res.json({ code: 0, data: await getAllUsageBytesByCompany() });
});

/** 重新扫描：全量重算某租户（或全部）用量计数器 */
router.post('/usage-recompute', requireSyncAuth, async (req: Request, res: Response) => {
  const owner = String(req.query.owner || req.body?.owner || '');
  const result = await recomputeUsage(owner || undefined);
  res.json({ code: 0, data: result });
});

// ============ 用户账号 CRUD ============

/** 获取所有注册用户 */
router.get('/users', requireSyncAuth, async (_req: Request, res: Response) => {
  try {
    const users = await store.getAllUsers();
    // 读取脱敏：不返回密码凭据
    res.json((users || []).map((u: any) => {
      const clone: any = { ...u };
      delete clone.password;
      delete clone.passwordHash;
      return clone;
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取单个用户 */
router.get('/users/:username', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const user = await store.getUser(req.params.username);
    if (!user) { res.status(404).json({ error: 'user not found' }); return; }
    const clone: any = { ...(user as any) };
    delete clone.password;
    delete clone.passwordHash;
    res.json(clone);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 注册用户 */
router.post('/users', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { username, password, role, company_name, contact_person, phone, email, register_date, status } = req.body;
    if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
    const changes = await store.insertUser({
      username, password: await hashPassword(String(password)), role: role || 'user', company_name: company_name || '', contact_person: contact_person || '',
      phone: phone || '', email: email || '', register_date: register_date || new Date().toISOString().slice(0, 10), status: status || 'active',
    });
    if (changes === 0) {
      res.status(409).json({ error: 'username already exists' });
      return;
    }
    res.json({ created: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 更新用户 */
router.put('/users/:username', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { password, role, company_name, contact_person, phone, email, status } = req.body;
    await store.updateUser({ password: password ? await hashPassword(String(password)) : null, role: role || null, company_name: company_name || null, contact_person: contact_person || null, phone: phone || null, email: email || null, status: status || null }, req.params.username);
    res.json({ updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 删除用户 */
router.delete('/users/:username', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    await store.deleteUser(req.params.username);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 系统设置 ============

router.get('/settings/:key', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const value = await store.getSetting(req.params.key);
    res.json({ value: value || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings/:key', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    await store.setSetting(req.params.key, String(req.body.value || ''));
    res.json({ saved: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 健康检查 ============

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, db: STORE_DRIVER, timestamp: Date.now() });
});

// ============ 辅助 ============

function extractOwner(key: string): string {
  // pageData_module_child_owner → owner is the last segment
  const parts = key.split('_');
  if (parts.length >= 4 && parts[0] === 'pageData') {
    return parts[parts.length - 1];
  }
  return '';
}

export default router;
