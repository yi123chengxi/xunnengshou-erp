/**
 * 数据同步路由（SQLite 版）
 * 所有业务数据存储在 SQLite 数据库（server/data/factory.db）
 * 不同浏览器登录同一账号 → 读写同一个数据库 → 天然数据同步
 */
import express, { Router, Request, Response } from 'express';
import {
  stmtGetDataset, stmtGetAllMeta, stmtUpsertDataset, stmtForceUpsertDataset, stmtDeleteDataset,
  stmtGetUser, stmtGetAllUsers, stmtInsertUser, stmtUpdateUser, stmtDeleteUser,
  stmtGetSetting, stmtSetSetting,
} from '../database/sqlite';
import { sendPushToUser } from './push.routes';
import {
  applyUsageDeltaForWrite, getUsageBytes, getAllUsageBytes, recomputeUsage, getDatasetJson,
} from '../services/storageUsage';

const router = Router();
router.use(express.json({ limit: '60mb' }));

// 只增不删的全局列表键：任何情况下不允许整体替换导致记录缩水（无删除 UI，缩水必为客户端本地缺数据误上传）
const APPEND_ONLY_KEYS = ['market_trade_orders', 'purchaser_pushed_orders'];

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
      const mrow = stmtGetDataset.get(`payment_request_managers_${owner}`) as any;
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
          const srow = stmtGetDataset.get(`notification_settings_${u}`) as any;
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
router.get('/meta', (_req: Request, res: Response) => {
  try {
    const rows = stmtGetAllMeta.all() as { dataset_key: string; updated_at: number }[];
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
router.get('/dataset', (req: Request, res: Response) => {
  try {
    const key = String(req.query.key || '');
    if (!key) { res.status(400).json({ error: 'missing key' }); return; }
    const row = stmtGetDataset.get(key) as { dataset_key: string; dataset_json: string; updated_at: number } | undefined;
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
router.put('/dataset', (req: Request, res: Response) => {
  try {
    const { key, json, updatedAt, baseTs, force } = req.body;
    if (!key || typeof json !== 'string') { res.status(400).json({ error: 'missing key or json' }); return; }
    const ts = Number(updatedAt) || Date.now();
    const owner = extractOwner(key);
    const row = stmtGetDataset.get(key) as { dataset_key: string; dataset_json: string; updated_at: number } | undefined;

    if (!row) {
      stmtForceUpsertDataset.run(key, json, owner, ts);
      applyUsageDeltaForWrite(key, null, json);
      res.json({ saved: true, newTs: ts });
      return;
    }
    if (force) {
      const finalTs = Math.max(ts, row.updated_at);
      stmtForceUpsertDataset.run(key, json, owner, finalTs);
      applyUsageDeltaForWrite(key, row.dataset_json, json);
      if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, json);
      res.json({ saved: true, newTs: finalTs });
      return;
    }
    if (Number(baseTs) === row.updated_at) {
      // 只增不删键：即使客户端自认为最新， incoming 数组比服务端短时也强制并集，防止本地缺数据的客户端清空服务端
      if (APPEND_ONLY_KEYS.includes(key)) {
        const guarded = mergeArrayDatasets(row.dataset_json, json);
        if (guarded) {
          const gTs = Math.max(ts, row.updated_at);
          stmtForceUpsertDataset.run(key, guarded, owner, gTs);
          applyUsageDeltaForWrite(key, row.dataset_json, guarded);
          if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, guarded);
          res.json({ saved: true, merged: true, newTs: gTs });
          return;
        }
      }
      // 客户端基于最新版本修改 → 整体替换
      const finalTs = Math.max(ts, row.updated_at);
      stmtForceUpsertDataset.run(key, json, owner, finalTs);
      applyUsageDeltaForWrite(key, row.dataset_json, json);
      if (key.startsWith('payment_requests_')) void notifyNewPayRequests(key, row.dataset_json, json);
      res.json({ saved: true, newTs: finalTs });
      return;
    }
    // 客户端已过期 → 并集合并，防止旧数据删除新增记录
    const merged = mergeArrayDatasets(row.dataset_json, json);
    const finalJson = merged || json;
    const finalTs = Math.max(ts, row.updated_at);
    stmtForceUpsertDataset.run(key, finalJson, owner, finalTs);
    applyUsageDeltaForWrite(key, row.dataset_json, finalJson);
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
router.delete('/dataset', (req: Request, res: Response) => {
  try {
    const key = String(req.query.key || '');
    if (!key) { res.status(400).json({ error: 'missing key' }); return; }
    const oldJson = getDatasetJson(key);
    stmtDeleteDataset.run(key);
    applyUsageDeltaForWrite(key, oldJson, null);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 存储用量（增量计数器） ============

/** 查询某租户数据库用量（字节，O(1)） */
router.get('/usage', (req: Request, res: Response) => {
  const owner = String(req.query.owner || '');
  if (!owner) { res.status(400).json({ error: 'missing owner' }); return; }
  res.json({ code: 0, data: { owner, bytes: getUsageBytes(owner) } });
});

/** 全部租户用量映射（开发者后台列表用） */
router.get('/usage-all', (_req: Request, res: Response) => {
  res.json({ code: 0, data: getAllUsageBytes() });
});

/** 重新扫描：全量重算某租户（或全部）用量计数器 */
router.post('/usage-recompute', (req: Request, res: Response) => {
  const owner = String(req.query.owner || req.body?.owner || '');
  const result = recomputeUsage(owner || undefined);
  res.json({ code: 0, data: result });
});

// ============ 用户账号 CRUD ============

/** 获取所有注册用户 */
router.get('/users', (_req: Request, res: Response) => {
  try {
    const users = stmtGetAllUsers.all();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取单个用户 */
router.get('/users/:username', (req: Request, res: Response) => {
  try {
    const user = stmtGetUser.get(req.params.username);
    if (!user) { res.status(404).json({ error: 'user not found' }); return; }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 注册用户 */
router.post('/users', (req: Request, res: Response) => {
  try {
    const { username, password, role, company_name, contact_person, phone, email, register_date, status } = req.body;
    if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
    const result = stmtInsertUser.run(
      username, password, role || 'user', company_name || '', contact_person || '',
      phone || '', email || '', register_date || new Date().toISOString().slice(0, 10), status || 'active'
    );
    if (result.changes === 0) {
      res.status(409).json({ error: 'username already exists' });
      return;
    }
    res.json({ created: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 更新用户 */
router.put('/users/:username', (req: Request, res: Response) => {
  try {
    const { password, role, company_name, contact_person, phone, email, status } = req.body;
    stmtUpdateUser.run(password || null, role || null, company_name || null, contact_person || null, phone || null, email || null, status || null, req.params.username);
    res.json({ updated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 删除用户 */
router.delete('/users/:username', (req: Request, res: Response) => {
  try {
    stmtDeleteUser.run(req.params.username);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 系统设置 ============

router.get('/settings/:key', (req: Request, res: Response) => {
  try {
    const row = stmtGetSetting.get(req.params.key) as { setting_value: string } | undefined;
    res.json({ value: row?.setting_value || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings/:key', (req: Request, res: Response) => {
  try {
    stmtSetSetting.run(req.params.key, String(req.body.value || ''));
    res.json({ saved: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 健康检查 ============
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, db: 'sqlite', timestamp: Date.now() });
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
