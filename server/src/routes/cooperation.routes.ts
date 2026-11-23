/**
 * 供应商菜单 / 合作握手权威真表接口（/api/cooperation/*）
 *
 * 架构口径：服务端三张真表（supplier_directory / bound_purchasers / cooperation_apps）是唯一权威源，
 * 每条记录一行，写路径只 upsert/删除目标行；客户端经本组接口读写，本地 localStorage 同名键退化为
 * 只读镜像缓存（供既有同步读逻辑与跨页消费），三键退出全局键同步（serverSync EXCLUDE_PREFIXES）。
 * - 全部接口必须 JWT；归属（owner）由服务端令牌解析（marketOwnerOf，子账号归主账号）。
 * - 跨租户代写授权：供应商可把自己写进采购商的 supplier_directory（行的 supplierUsername 必须=actor），
 *   采购商可把自己写进供应商的 bound_purchasers（行的 purchaserUsername 必须=actor）；跨租户一律只 upsert、不删除。
 * - cooperation_apps 沿用历史「全局共享」语义（今日 cooperation_applications 即全局并集键，客户端按编号自过滤），
 *   快照读返回全量，写不限制发起方，保持行为 1:1。
 */
import { Router, Request, Response } from 'express';
import { verifyJWT } from './auth.routes';
import { store } from '../database/store';
import {
  listSupplierDirectory, listSupplierDirectoryKeys, upsertSupplierDirectoryRow, deleteSupplierDirectoryRow,
  listBoundPurchasers, listBoundPurchaserKeys, upsertBoundPurchaserRow, deleteBoundPurchaserRow,
  listAllCoopApps, upsertCoopApp, deleteCoopApp,
} from '../database/cooperation-store';
import { marketOwnerOf } from '../services/market-listings';

const router = Router();

const actorOf = (req: Request): string => String((req as any).user?.username || '');

/** 行转记录：record_json 解析失败的行跳过（坏行不阻断整列表） */
function rowsToRecords(rows: { record_json: string }[]): any[] {
  const out: any[] = [];
  rows.forEach((r) => {
    try {
      const rec = JSON.parse(r.record_json);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch { /* ignore */ }
  });
  return out;
}

/** 一次性迁移：真表为空时从旧全局同步键导入历史数据 */
async function migrateSuppliers(owner: string): Promise<void> {
  try {
    if ((await listSupplierDirectoryKeys(owner)).length) return;
    const legacy = await store.getDataset(`purchaser_suppliers_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      let i = 0;
      for (const rec of parsed) {
        const key = String(rec?.id || rec?.key || '');
        if (!rec || !key) continue;
        await upsertSupplierDirectoryRow(owner, key, JSON.stringify(rec), ts + (i++));
      }
      console.log(`[cooperation] 迁移 purchaser_suppliers_${owner} → supplier_directory ${i} 行`);
    }
  } catch (err: any) {
    console.error('[cooperation] supplier_directory 迁移失败:', err?.message || err);
  }
}

async function migrateBound(owner: string): Promise<void> {
  try {
    if ((await listBoundPurchaserKeys(owner)).length) return;
    const legacy = await store.getDataset(`boundPurchasers_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      let i = 0;
      for (const rec of parsed) {
        const key = String(rec?.key || rec?.id || '');
        if (!rec || !key) continue;
        await upsertBoundPurchaserRow(owner, key, JSON.stringify(rec), ts + (i++));
      }
      console.log(`[cooperation] 迁移 boundPurchasers_${owner} → bound_purchasers ${i} 行`);
    }
  } catch (err: any) {
    console.error('[cooperation] bound_purchasers 迁移失败:', err?.message || err);
  }
}

// cooperation_applications 是单个全局键：整表迁移仅执行一次（表非空即视为已迁移）
let appsMigrated = false;
async function migrateApps(): Promise<void> {
  if (appsMigrated) return;
  try {
    if ((await listAllCoopApps()).length) { appsMigrated = true; return; }
    const legacy = await store.getDataset('cooperation_applications');
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      let i = 0;
      for (const rec of parsed) {
        const key = String(rec?.applicationId || rec?.id || '');
        if (!rec || !key) continue;
        await upsertCoopApp(key, String(rec.purchaserUsername || ''), String(rec.supplierUsername || ''), String(rec.status || ''), JSON.stringify(rec), ts + (i++));
      }
      console.log(`[cooperation] 迁移 cooperation_applications → cooperation_apps ${i} 行`);
    }
    appsMigrated = true;
  } catch (err: any) {
    console.error('[cooperation] cooperation_apps 迁移失败:', err?.message || err);
  }
}

/** 组装 actor 的权威快照（读前先迁移） */
async function buildSnapshot(owner: string): Promise<{ suppliers: any[]; boundPurchasers: any[]; applications: any[] }> {
  await migrateSuppliers(owner);
  await migrateBound(owner);
  await migrateApps();
  const [sup, bound, apps] = await Promise.all([
    listSupplierDirectory(owner),
    listBoundPurchasers(owner),
    listAllCoopApps(),
  ]);
  return { suppliers: rowsToRecords(sup), boundPurchasers: rowsToRecords(bound), applications: rowsToRecords(apps) };
}

/** GET /api/cooperation/snapshot —— 拉取本人供应商目录 + 已绑定采购商 + 全量合作申请（首访自动迁移旧键） */
router.get('/snapshot', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    res.json({ code: 200, data: await buildSnapshot(owner) });
  } catch (err: any) {
    console.error('[cooperation] snapshot error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * GET /api/cooperation/bound-purchasers?owner=<账号> —— 跨租户读某账号的已绑定采购商（登录即可）。
 * 等价旧 SHARED 键 boundPurchasers_<对方> 的跨租户读，供采购商侧现算供应商发布的有效信用额度兜底。
 */
router.get('/bound-purchasers', verifyJWT, async (req: Request, res: Response) => {
  try {
    const target = String(req.query.owner || '');
    if (!target) { res.json({ code: 200, data: { list: [] } }); return; }
    await migrateBound(target);
    res.json({ code: 200, data: { list: rowsToRecords(await listBoundPurchasers(target)) } });
  } catch (err: any) {
    console.error('[cooperation] bound-purchasers error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * POST /api/cooperation/push —— 授权写入（可只带其中若干段），返回 actor 最新完整快照。
 * body:
 *   supplierDirectory?: { owner, rows, removedKeys? }  // owner=目标采购商账号；跨租户仅 upsert 指向 actor 的行
 *   boundPurchasers?:   { owner, rows, removedKeys? }  // owner=目标供应商账号；跨租户仅 upsert 指向 actor 的行
 *   applications?:      { rows, removedKeys? }         // 全局合作申请
 */
router.post('/push', verifyJWT, async (req: Request, res: Response) => {
  try {
    const actor = actorOf(req);
    const owner = await marketOwnerOf(actor);
    const body = req.body || {};

    // ---- supplier_directory ----
    const sd = body.supplierDirectory;
    if (sd && typeof sd === 'object') {
      const target = String(sd.owner || owner);
      await migrateSuppliers(target);
      const own = target === owner;
      const rows: any[] = Array.isArray(sd.rows) ? sd.rows : [];
      const removed: string[] = Array.isArray(sd.removedKeys) ? sd.removedKeys.map((k: any) => String(k)) : [];
      const ts = Date.now();
      let i = 0;
      for (const r of rows) {
        const key = String(r?.id || r?.key || '');
        if (!r || !key) continue;
        if (!own) {
          // 跨租户代写守卫：只能写入指向自己的行（供应商把自己写进采购商目录）
          const ref = String(r.supplierUsername || '');
          if (ref !== actor && ref !== owner) continue;
        }
        await upsertSupplierDirectoryRow(target, key, JSON.stringify(r), ts + (i++));
      }
      if (own) { for (const k of removed) { if (k) await deleteSupplierDirectoryRow(target, k); } }
    }

    // ---- bound_purchasers ----
    const bp = body.boundPurchasers;
    if (bp && typeof bp === 'object') {
      const target = String(bp.owner || owner);
      await migrateBound(target);
      const own = target === owner;
      const rows: any[] = Array.isArray(bp.rows) ? bp.rows : [];
      const removed: string[] = Array.isArray(bp.removedKeys) ? bp.removedKeys.map((k: any) => String(k)) : [];
      const ts = Date.now();
      let i = 0;
      for (const r of rows) {
        const key = String(r?.key || r?.id || '');
        if (!r || !key) continue;
        if (!own) {
          // 跨租户代写守卫：只能写入指向自己的行（采购商把自己写进供应商已绑定列表）
          const ref = String(r.purchaserUsername || '');
          if (ref !== actor && ref !== owner) continue;
        }
        await upsertBoundPurchaserRow(target, key, JSON.stringify(r), ts + (i++));
      }
      if (own) { for (const k of removed) { if (k) await deleteBoundPurchaserRow(target, k); } }
    }

    // ---- cooperation_apps（全局共享，沿用历史语义） ----
    const ap = body.applications;
    if (ap && typeof ap === 'object') {
      await migrateApps();
      const rows: any[] = Array.isArray(ap.rows) ? ap.rows : [];
      const removed: string[] = Array.isArray(ap.removedKeys) ? ap.removedKeys.map((k: any) => String(k)) : [];
      const ts = Date.now();
      let i = 0;
      for (const r of rows) {
        const key = String(r?.applicationId || r?.id || '');
        if (!r || !key) continue;
        await upsertCoopApp(key, String(r.purchaserUsername || ''), String(r.supplierUsername || ''), String(r.status || ''), JSON.stringify(r), ts + (i++));
      }
      for (const k of removed) { if (k) await deleteCoopApp(k); }
    }

    res.json({ code: 200, data: await buildSnapshot(owner) });
  } catch (err: any) {
    console.error('[cooperation] push error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
