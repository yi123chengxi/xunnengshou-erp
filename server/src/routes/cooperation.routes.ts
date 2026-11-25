/**
 * 供应商菜单 / 合作握手权威真表接口（/api/cooperation/*）
 *
 * 架构口径：服务端三张真表（supplier_directory / bound_purchasers / cooperation_apps）是唯一权威源，
 * 每条记录一行，写路径只 upsert/删除目标行；客户端经本组接口读写，本地 localStorage 同名键退化为
 * 只读镜像缓存（供既有同步读逻辑与跨页消费），三键退出全局键同步（serverSync EXCLUDE_PREFIXES）。
 * - 全部接口必须 JWT；归属（owner）由服务端令牌解析（marketOwnerOf，子账号归主账号）。
 * - 跨租户代写授权：供应商可把自己写进采购商的 supplier_directory（行的 supplierUsername 必须=actor），
 *   采购商可把自己写进供应商的 bound_purchasers（行的 purchaserUsername 必须=actor）；跨租户一律只 upsert、不删除。
 * - 首次注入门禁（同名公司串号根治）：跨租户「新增一行」必须持有握手凭证——cooperation_apps 里存在
 *   (purchaser=目标账号, supplier=actor) 的未作废合作申请（pending/approved，账号等值或公司编号等值）。
 *   仅「对方目录里已存在指向 actor 的行」时放行无申请的更新（镜像补全/状态收敛/历史数据），
 *   因为那说明对方早已接纳过该主体。缺此门禁时，任何账号只要在自己浏览器里点一次「同意」，
 *   就能把一行 supplierUsername=自己 的卡片塞进任意采购商的目录（公司名称重名时表现为
 *   「同名新账号自动出现在我的供应商列表」）。
 * - cooperation_apps 沿用历史「全局共享」语义（今日 cooperation_applications 即全局并集键，客户端按编号自过滤），
 *   快照读返回全量，写不限制发起方，保持行为 1:1；可见性收紧在客户端凭证谓词侧完成。
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

// ============ 公司身份索引（跨租户代写凭证校验用） ============
// registeredUsers 为全局键：账号 → 归属主账号（子账号沿 parentAccount 上溯，与客户端 getDataOwner 同口径）
// 与公司编号。30s 缓存，避免每次 push 都 parse 数百 KB JSON。
interface CompanyIndex { rootOf: Map<string, string>; noOf: Map<string, string>; }
let companyIdxCache: { ts: number; idx: CompanyIndex } | null = null;

export async function companyIndex(): Promise<CompanyIndex> {
  const now = Date.now();
  if (companyIdxCache && now - companyIdxCache.ts < 30000) return companyIdxCache.idx;
  const rootOf = new Map<string, string>();
  const noOf = new Map<string, string>();
  try {
    const rec = await store.getDataset('registeredUsers');
    const parsed = rec ? JSON.parse(rec.dataset_json || '[]') : [];
    const users: any[] = Array.isArray(parsed) ? parsed : [];
    const byName = new Map<string, any>();
    users.forEach((u: any) => { if (u && u.username) byName.set(String(u.username), u); });
    byName.forEach((u: any, un: string) => {
      noOf.set(un, String(u.companyNo || u.companyShortName || '').trim());
      let cur = un;
      const seen = new Set<string>();
      let g = 0;
      while (g++ < 10 && !seen.has(cur)) {
        const h = byName.get(cur);
        if (!h || !h.isSubAccount || !h.parentAccount) break;
        const next = String(h.parentAccount);
        if (!byName.has(next)) break;
        seen.add(cur);
        cur = next;
      }
      rootOf.set(un, cur);
    });
  } catch (err: any) {
    console.error('[cooperation] 公司身份索引读取失败:', err?.message || err);
  }
  const idx: CompanyIndex = { rootOf, noOf };
  companyIdxCache = { ts: now, idx };
  return idx;
}

export type { CompanyIndex };

export const rootOfAccount = (idx: CompanyIndex, un: string): string => {
  const s = String(un || '').trim();
  return s ? (idx.rootOf.get(s) || s) : '';
};

const HANDSHAKE_STATUS = new Set(['pending', 'approved']);

/**
 * 握手凭证判定：是否存在 (purchaser, supplier) 这一对的未作废合作申请。
 * 账号等值优先（子账号归主账号），编号等值兜底历史无账号记录；
 * 名称一律不参与——公司名称既不唯一也不稳定，同名两家公司的申请不得互相认领。
 * incomingApps 为本次请求同时携带的申请行（客户端按键分别推送，通常为空，保留以兼容合并推送）。
 */
export async function hasHandshake(purchaser: string, supplier: string, incomingApps: any[], idx: CompanyIndex): Promise<boolean> {
  const pRoot = rootOfAccount(idx, purchaser);
  const sRoot = rootOfAccount(idx, supplier);
  if (!pRoot || !sRoot || pRoot === sRoot) return false;
  const pNo = idx.noOf.get(pRoot) || '';
  const sNo = idx.noOf.get(sRoot) || '';
  const match = (a: any): boolean => {
    if (!a || typeof a !== 'object' || a.superseded) return false;
    if ((a.type || 'cooperation') !== 'cooperation') return false;
    if (!HANDSHAKE_STATUS.has(String(a.status || ''))) return false;
    const ap = rootOfAccount(idx, a.purchaserUsername);
    const as = rootOfAccount(idx, a.supplierUsername);
    const pOk = (!!ap && ap === pRoot) || (!!pNo && String(a.purchaserNo || '').trim() === pNo);
    const sOk = (!!as && as === sRoot) || (!!sNo && String(a.targetSupplierNo || '').trim() === sNo);
    return pOk && sOk;
  };
  if (incomingApps.some(match)) return true;
  const rows = await listAllCoopApps();
  return rows.some((r) => { try { return match(JSON.parse(r.record_json)); } catch { return false; } });
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
    const idx = await companyIndex();
    const actorRoot = rootOfAccount(idx, owner) || owner;
    const actorNo = idx.noOf.get(actorRoot) || '';
    const incomingApps: any[] = Array.isArray(body?.applications?.rows) ? body.applications.rows : [];
    // 被门禁拦下的行：随响应回传供客户端诊断（不静默丢弃，否则同名串号排查无从下手）
    const rejected: { section: string; owner: string; key: string; reason: string }[] = [];

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
      let targetRoot = '';
      let targetNo = '';
      let handshake = false;
      let acceptedRefs = new Set<string>();
      if (!own && rows.length) {
        targetRoot = rootOfAccount(idx, target);
        targetNo = idx.noOf.get(targetRoot) || '';
        handshake = await hasHandshake(targetRoot, actorRoot, incomingApps, idx);
        // 对方目录里已存在的「指向我的行」：允许无申请更新（镜像补全/状态收敛/存量历史数据）
        acceptedRefs = new Set(
          rowsToRecords(await listSupplierDirectory(target))
            .map((r: any) => rootOfAccount(idx, r?.supplierUsername))
            .filter(Boolean)
        );
      }
      for (const r of rows) {
        const key = String(r?.id || r?.key || '');
        if (!r || !key) continue;
        if (!own) {
          // 跨租户代写守卫：只能写入指向自己的行（供应商把自己写进采购商目录）
          const ref = String(r.supplierUsername || '');
          const refRoot = rootOfAccount(idx, ref);
          if (!ref || (refRoot !== actorRoot && ref !== actor)) {
            rejected.push({ section: 'supplierDirectory', owner: target, key, reason: '行内供应商账号不是当前登录主体' });
            continue;
          }
          // 行内凭证不得指向第三方：同名公司串号的直接成因就是把别人的编号/账号写进本行
          const rowPurchaser = rootOfAccount(idx, r.purchaserUsername);
          if (rowPurchaser && rowPurchaser !== targetRoot) {
            rejected.push({ section: 'supplierDirectory', owner: target, key, reason: '行内采购商账号与目标目录不一致' });
            continue;
          }
          const rowPNo = String(r.purchaserNo || '').trim();
          if (rowPNo && targetNo && rowPNo !== targetNo) {
            rejected.push({ section: 'supplierDirectory', owner: target, key, reason: '行内采购商编号与目标公司编号不一致' });
            continue;
          }
          const rowSNo = String(r.supplierNo || '').trim();
          if (rowSNo && actorNo && rowSNo !== actorNo) {
            rejected.push({ section: 'supplierDirectory', owner: target, key, reason: '行内供应商编号与当前主体公司编号不一致' });
            continue;
          }
          // 首次注入门禁：无握手申请且对方目录里从未接纳过我 → 拒写
          if (!handshake && !acceptedRefs.has(actorRoot)) {
            rejected.push({ section: 'supplierDirectory', owner: target, key, reason: '无双方合作申请凭证，不得新增供应商条目' });
            continue;
          }
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
      let targetRoot = '';
      let targetNo = '';
      let handshake = false;
      let acceptedRefs = new Set<string>();
      if (!own && rows.length) {
        targetRoot = rootOfAccount(idx, target);
        targetNo = idx.noOf.get(targetRoot) || '';
        handshake = await hasHandshake(actorRoot, targetRoot, incomingApps, idx);
        acceptedRefs = new Set(
          rowsToRecords(await listBoundPurchasers(target))
            .map((r: any) => rootOfAccount(idx, r?.purchaserUsername))
            .filter(Boolean)
        );
      }
      for (const r of rows) {
        const key = String(r?.key || r?.id || '');
        if (!r || !key) continue;
        if (!own) {
          // 跨租户代写守卫：只能写入指向自己的行（采购商把自己写进供应商已绑定列表）
          const ref = String(r.purchaserUsername || '');
          const refRoot = rootOfAccount(idx, ref);
          if (!ref || (refRoot !== actorRoot && ref !== actor)) {
            rejected.push({ section: 'boundPurchasers', owner: target, key, reason: '行内采购商账号不是当前登录主体' });
            continue;
          }
          const rowSupplier = rootOfAccount(idx, r.supplierUsername);
          if (rowSupplier && rowSupplier !== targetRoot) {
            rejected.push({ section: 'boundPurchasers', owner: target, key, reason: '行内供应商账号与目标列表不一致' });
            continue;
          }
          const rowSNo = String(r.supplierNo || '').trim();
          if (rowSNo && targetNo && rowSNo !== targetNo) {
            rejected.push({ section: 'boundPurchasers', owner: target, key, reason: '行内供应商编号与目标公司编号不一致' });
            continue;
          }
          const rowPNo = String(r.purchaserNo || '').trim();
          if (rowPNo && actorNo && rowPNo !== actorNo) {
            rejected.push({ section: 'boundPurchasers', owner: target, key, reason: '行内采购商编号与当前主体公司编号不一致' });
            continue;
          }
          if (!handshake && !acceptedRefs.has(actorRoot)) {
            rejected.push({ section: 'boundPurchasers', owner: target, key, reason: '无双方合作申请凭证，不得新增绑定采购商' });
            continue;
          }
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

    if (rejected.length) {
      console.warn(`[cooperation] 跨租户代写被门禁拦下 ${rejected.length} 行（actor=${actor}）:`,
        rejected.slice(0, 5).map(r => `${r.section}/${r.owner}/${r.key}: ${r.reason}`).join(' | '));
    }
    res.json({ code: 200, data: await buildSnapshot(owner), rejected });
  } catch (err: any) {
    console.error('[cooperation] push error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
