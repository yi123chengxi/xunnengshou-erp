/**
 * 数据同步路由（双驱动版：DB_DRIVER=sqlite|mysql）
 * 所有业务数据经统一数据访问层 store（SQLite 文件库 或 独立 MySQL 服务器）
 * 不同浏览器登录同一账号 → 读写同一个数据库 → 天然数据同步
 */
import express, { Router, Request, Response } from 'express';
import { store, STORE_DRIVER } from '../database/store';
import { sendPushToUser } from './push.routes';
import {
  applyUsageDeltaForWrite, getUsageBytes, getAllUsageBytes, recomputeUsage, getDatasetJson,
} from '../services/storageUsage';

const router = Router();
router.use(express.json({ limit: '60mb' }));

// 只增不删的全局列表键：任何情况下不允许整体替换导致记录缩水（无删除 UI，缩水必为客户端本地缺数据误上传）
const APPEND_ONLY_KEYS = ['market_trade_orders', 'purchaser_pushed_orders'];
// 墓碑语义键：即便 baseTs 与服务端版本一致也执行记录级并集合并。
// 这类键的删除/完成靠 delisted 墓碑表达，整体替换会让未同步墓碑的旧端（如另一端浏览器）
// 把已完成/已删除的对账记录重新写回，导致「刷新后又出现」「对账结果不回写」。
const MERGE_ALWAYS_KEYS = ['recon_records'];
// 墓碑语义键前缀：分平台对账独立库（recon_db_supplier_<账号> / recon_db_purchaser_<账号>）
const MERGE_ALWAYS_PREFIXES = ['recon_db_'];
const isMergeAlwaysKey = (key: string): boolean => MERGE_ALWAYS_KEYS.includes(key) || MERGE_ALWAYS_PREFIXES.some(p => key.startsWith(p));

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
router.get('/meta', async (_req: Request, res: Response) => {
  try {
    const rows = await store.getAllMeta();
    const meta: Record<string, number> = {};
    for (const r of rows) {
      meta[r.dataset_key] = r.updated_at;
    }
    res.json(meta);
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
    const row = await store.getDataset(key);
    if (!row) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ key: row.dataset_key, json: row.dataset_json, updatedAt: row.updated_at });
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
    const { key, json, updatedAt, baseTs, force } = req.body;
    if (!key || typeof json !== 'string') { res.status(400).json({ error: 'missing key or json' }); return; }
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
      // 只增不删键/墓碑语义键：即使客户端自认为最新，也强制记录级并集合并，
      // 防止本地缺数据的客户端清空服务端记录或复活已墓碑的记录
      if (APPEND_ONLY_KEYS.includes(key) || isMergeAlwaysKey(key)) {
        const guarded = mergeArrayDatasets(row.dataset_json, json);
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
    const merged = mergeArrayDatasets(row.dataset_json, json);
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

/** 数组数据集并集合并：incoming 版本优先，existing 中 incoming 不认识的记录追加保留 */
function mergeArrayDatasets(existingJson: string, incomingJson: string): string | null {
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
      if (av && av.delisted === true && r.delisted !== true) return { ...r, delisted: true, delistedAt: av.delistedAt };
      return r;
    });
    const aOnly = a.filter((r: any) => !bIds.has(idOf(r)));
    if (aOnly.length === 0) return JSON.stringify(bFixed);
    return JSON.stringify([...bFixed, ...aOnly]);
  } catch { return null; }
}

/** 删除数据集 */
router.delete('/dataset', async (req: Request, res: Response) => {
  try {
    const key = String(req.query.key || '');
    if (!key) { res.status(400).json({ error: 'missing key' }); return; }
    const oldJson = await getDatasetJson(key);
    await store.deleteDataset(key);
    await applyUsageDeltaForWrite(key, oldJson, null);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 存储用量（增量计数器） ============

/** 查询某租户数据库用量（字节，O(1)） */
router.get('/usage', async (req: Request, res: Response) => {
  const owner = String(req.query.owner || '');
  if (!owner) { res.status(400).json({ error: 'missing owner' }); return; }
  res.json({ code: 0, data: { owner, bytes: await getUsageBytes(owner) } });
});

/** 全部租户用量映射（开发者后台列表用） */
router.get('/usage-all', async (_req: Request, res: Response) => {
  res.json({ code: 0, data: await getAllUsageBytes() });
});

/** 重新扫描：全量重算某租户（或全部）用量计数器 */
router.post('/usage-recompute', async (req: Request, res: Response) => {
  const owner = String(req.query.owner || req.body?.owner || '');
  const result = await recomputeUsage(owner || undefined);
  res.json({ code: 0, data: result });
});

// ============ 用户账号 CRUD ============

/** 获取所有注册用户 */
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await store.getAllUsers();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取单个用户 */
router.get('/users/:username', async (req: Request, res: Response) => {
  try {
    const user = await store.getUser(req.params.username);
    if (!user) { res.status(404).json({ error: 'user not found' }); return; }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 注册用户 */
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { username, password, role, company_name, contact_person, phone, email, register_date, status } = req.body;
    if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
    const changes = await store.insertUser({
      username, password, role: role || 'user', company_name: company_name || '', contact_person: contact_person || '',
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
router.put('/users/:username', async (req: Request, res: Response) => {
  try {
    const { password, role, company_name, contact_person, phone, email, status } = req.body;
    await store.updateUser({ password: password || null, role: role || null, company_name: company_name || null, contact_person: contact_person || null, phone: phone || null, email: email || null, status: status || null }, req.params.username);
    res.json({ updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 删除用户 */
router.delete('/users/:username', async (req: Request, res: Response) => {
  try {
    await store.deleteUser(req.params.username);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 系统设置 ============

router.get('/settings/:key', async (req: Request, res: Response) => {
  try {
    const value = await store.getSetting(req.params.key);
    res.json({ value: value || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings/:key', async (req: Request, res: Response) => {
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
