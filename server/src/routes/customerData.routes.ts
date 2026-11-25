/**
 * 客户数据权威真表接口（/api/customer/*）
 *
 * 架构口径：服务端四张真表（customer_profiles / customer_archives / customer_credit_adj / customer_pay_summary）
 * 是唯一权威源，每条记录一行，写路径只 upsert/删除目标行；客户端经本组接口读写，本地 localStorage 同名键
 * （customers_ / customer_archive_ / credit_adjustments_ / customer_pay_summary_）退化为只读镜像缓存，
 * 四键退出全局键同步（serverSync EXCLUDE_PREFIXES）。
 * - 全部接口必须 JWT；归属（owner）由服务端令牌解析（marketOwnerOf，子账号归主账号）。
 * - 跨租户代写授权：
 *   ① 采购商可更新供应商客户档案里「指向自己」的行（purchaserUsername/purchaserNo 凭证匹配 actor），
 *      需握手凭证或对方档案早已接纳过自己（同合作三键门禁）；
 *   ② 对不指向自己的既有档案行（直客邀约确认场景），仅允许合并 type/cooperationDate 两个字段，
 *      不得触碰额度等其余字段；新注入一律拒绝。
 *   ③ 采购商批准合作时可解除供应商归档册里「凭证匹配自己」的条目（需 approved 握手），
 *      不得跨租户新增/修改归档条目。
 * - credit_adjustments / customer_pay_summary 仅本人可写。
 * - paySummary 行级防陈旧：条目带 updatedAt（ISO 串），仅当 incoming 不旧于存量时才覆写，
 *   防旧设备的重算值覆盖新值（汇总派生源头仍是本地优先账单/收款链）。
 */
import { Router, Request, Response } from 'express';
import { verifyJWT } from './auth.routes';
import { store } from '../database/store';
import {
  listCustomerProfiles, listCustomerProfileKeys, upsertCustomerProfileRow, deleteCustomerProfileRow,
  listCustomerArchives, listCustomerArchiveKeys, upsertCustomerArchiveRow, deleteCustomerArchiveRow,
  listCustomerCreditAdj, listCustomerCreditAdjKeys, upsertCustomerCreditAdjRow, deleteCustomerCreditAdjRow,
  listCustomerPaySummary, listCustomerPaySummaryKeys, upsertCustomerPaySummaryRow, deleteCustomerPaySummaryRow,
} from '../database/customer-store';
import { companyIndex, rootOfAccount, hasHandshake, CompanyIndex } from './cooperation.routes';
import { listAllCoopApps } from '../database/cooperation-store';
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

// ============ 一次性迁移：真表为空时从旧同步键导入历史数据 ============
async function migrateCustomers(owner: string): Promise<void> {
  try {
    if ((await listCustomerProfileKeys(owner)).length) return;
    const legacy = await store.getDataset(`customers_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      let i = 0;
      for (const rec of parsed) {
        const key = String(rec?.id || rec?.key || '');
        if (!rec || !key) continue;
        await upsertCustomerProfileRow(owner, key, JSON.stringify(rec), ts + (i++));
      }
      console.log(`[customer] 迁移 customers_${owner} → customer_profiles ${i} 行`);
    }
  } catch (err: any) {
    console.error('[customer] customer_profiles 迁移失败:', err?.message || err);
  }
}

async function migrateArchives(owner: string): Promise<void> {
  try {
    if ((await listCustomerArchiveKeys(owner)).length) return;
    const legacy = await store.getDataset(`customer_archive_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      let i = 0;
      for (const rec of parsed) {
        const key = String(rec?.id || '');
        if (!rec || !key) continue;
        await upsertCustomerArchiveRow(owner, key, JSON.stringify(rec), ts + (i++));
      }
      console.log(`[customer] 迁移 customer_archive_${owner} → customer_archives ${i} 行`);
    }
  } catch (err: any) {
    console.error('[customer] customer_archives 迁移失败:', err?.message || err);
  }
}

async function migrateCreditAdj(owner: string): Promise<void> {
  try {
    if ((await listCustomerCreditAdjKeys(owner)).length) return;
    const legacy = await store.getDataset(`credit_adjustments_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      let i = 0;
      for (const rec of parsed) {
        const key = String(rec?.id || rec?.key || '');
        if (!rec || !key) continue;
        await upsertCustomerCreditAdjRow(owner, key, JSON.stringify(rec), ts + (i++));
      }
      console.log(`[customer] 迁移 credit_adjustments_${owner} → customer_credit_adj ${i} 行`);
    }
  } catch (err: any) {
    console.error('[customer] customer_credit_adj 迁移失败:', err?.message || err);
  }
}

async function migratePaySummary(owner: string): Promise<void> {
  try {
    if ((await listCustomerPaySummaryKeys(owner)).length) return;
    const legacy = await store.getDataset(`customer_pay_summary_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '{}') : {};
    // 旧键是 主体名→汇总条目 的对象映射：按条目拆行（key=主体名）
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const ts = Date.now();
      let i = 0;
      for (const [name, entry] of Object.entries(parsed)) {
        if (!name || !entry || typeof entry !== 'object') continue;
        await upsertCustomerPaySummaryRow(owner, name, JSON.stringify({ key: name, ...(entry as object) }), ts + (i++));
      }
      if (i) console.log(`[customer] 迁移 customer_pay_summary_${owner} → customer_pay_summary ${i} 行`);
    }
  } catch (err: any) {
    console.error('[customer] customer_pay_summary 迁移失败:', err?.message || err);
  }
}

async function migrateAll(owner: string): Promise<void> {
  await migrateCustomers(owner);
  await migrateArchives(owner);
  await migrateCreditAdj(owner);
  await migratePaySummary(owner);
}

/** 组装 actor 的权威快照（读前先迁移） */
async function buildSnapshot(owner: string): Promise<{ customers: any[]; archives: any[]; creditAdjustments: any[]; paySummary: any[] }> {
  await migrateAll(owner);
  const [cust, arch, adj, sum] = await Promise.all([
    listCustomerProfiles(owner),
    listCustomerArchives(owner),
    listCustomerCreditAdj(owner),
    listCustomerPaySummary(owner),
  ]);
  return { customers: rowsToRecords(cust), archives: rowsToRecords(arch), creditAdjustments: rowsToRecords(adj), paySummary: rowsToRecords(sum) };
}

/** GET /api/customer/snapshot —— 拉取本人客户档案 + 归档册 + 额度调整 + 欠款汇总（首访自动迁移旧键） */
router.get('/snapshot', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    res.json({ code: 200, data: await buildSnapshot(owner) });
  } catch (err: any) {
    console.error('[customer] snapshot error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/**
 * GET /api/customer/shared?owner=<账号> —— 跨租户读某账号的客户档案 + 额度调整（登录即可）。
 * 等价旧 SHARED 键 customers_<对方> / credit_adjustments_<对方> 的跨租户读，
 * 供采购商侧现算供应商给予的有效信用额度。
 */
router.get('/shared', verifyJWT, async (req: Request, res: Response) => {
  try {
    const target = String(req.query.owner || '');
    if (!target) { res.json({ code: 200, data: { customers: [], creditAdjustments: [] } }); return; }
    await migrateCustomers(target);
    await migrateCreditAdj(target);
    const [cust, adj] = await Promise.all([listCustomerProfiles(target), listCustomerCreditAdj(target)]);
    res.json({ code: 200, data: { customers: rowsToRecords(cust), creditAdjustments: rowsToRecords(adj) } });
  } catch (err: any) {
    console.error('[customer] shared error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** 归档条目凭证是否指向 actor（账号等值优先，编号等值兜底；名称不参与——同名不唯一） */
function archiveEntryOfActor(entry: any, actorRoot: string, actorNo: string, idx: CompanyIndex): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const un = rootOfAccount(idx, entry.username);
  if (un && actorRoot && un === actorRoot) return true;
  const no = String(entry.no || '').trim();
  return !!no && !!actorNo && no === actorNo;
}

/** 是否存在 (purchaser, supplier) 这一对的已批准合作申请（归档解除比握手门禁更严：pending 不算） */
async function hasApprovedHandshake(purchaser: string, supplier: string, idx: CompanyIndex): Promise<boolean> {
  const pRoot = rootOfAccount(idx, purchaser);
  const sRoot = rootOfAccount(idx, supplier);
  if (!pRoot || !sRoot || pRoot === sRoot) return false;
  const pNo = idx.noOf.get(pRoot) || '';
  const sNo = idx.noOf.get(sRoot) || '';
  const rows = await listAllCoopApps();
  return rows.some((r) => {
    try {
      const a = JSON.parse(r.record_json);
      if (!a || a.superseded || (a.type || 'cooperation') !== 'cooperation' || a.status !== 'approved') return false;
      const ap = rootOfAccount(idx, a.purchaserUsername);
      const as = rootOfAccount(idx, a.supplierUsername);
      const pOk = (!!ap && ap === pRoot) || (!!pNo && String(a.purchaserNo || '').trim() === pNo);
      const sOk = (!!as && as === sRoot) || (!!sNo && String(a.targetSupplierNo || '').trim() === sNo);
      return pOk && sOk;
    } catch { return false; }
  });
}

/**
 * POST /api/customer/push —— 授权写入（可只带其中若干段），返回 actor 最新完整快照。
 * body:
 *   customers?:         { owner, rows, removedKeys? }  // owner=目标供应商账号；跨租户按凭证门禁
 *   archives?:          { owner, rows, removedKeys?, removeParty? }  // 跨租户仅允许解除指向 actor 的条目
 *                       removeParty={username,no,name}：批准写点显式解除（客户端无对方镜像，无法按 id 申报）
 *   creditAdjustments?: { owner, rows, removedKeys? }  // 仅本人
 *   paySummary?:        { owner, rows, removedKeys? }  // 仅本人；行级 updatedAt 防陈旧
 */
router.post('/push', verifyJWT, async (req: Request, res: Response) => {
  try {
    const actor = actorOf(req);
    const owner = await marketOwnerOf(actor);
    const body = req.body || {};
    const idx = await companyIndex();
    const actorRoot = rootOfAccount(idx, owner) || owner;
    const actorNo = idx.noOf.get(actorRoot) || '';
    const rejected: { section: string; owner: string; key: string; reason: string }[] = [];

    // ---- customer_profiles ----
    const cp = body.customers;
    if (cp && typeof cp === 'object') {
      const target = String(cp.owner || owner);
      await migrateCustomers(target);
      const own = target === owner;
      const rows: any[] = Array.isArray(cp.rows) ? cp.rows : [];
      const removed: string[] = Array.isArray(cp.removedKeys) ? cp.removedKeys.map((k: any) => String(k)) : [];
      const ts = Date.now();
      let i = 0;
      let handshake = false;
      let acceptedRefs = new Set<string>();
      let existingById = new Map<string, any>();
      if (!own && rows.length) {
        const targetRoot = rootOfAccount(idx, target);
        handshake = await hasHandshake(targetRoot, actorRoot, [], idx);
        const existing = rowsToRecords(await listCustomerProfiles(target));
        existing.forEach((r: any) => { if (r?.id) existingById.set(String(r.id), r); });
        // 对方档案里已存在的「指向我的行」：允许无申请更新（历史数据/状态收敛）
        acceptedRefs = new Set(
          existing.map((r: any) => rootOfAccount(idx, r?.purchaserUsername)).filter(Boolean)
        );
      }
      for (const r of rows) {
        const key = String(r?.id || r?.key || '');
        if (!r || !key) continue;
        if (!own) {
          const refRoot = rootOfAccount(idx, r.purchaserUsername);
          const refNo = String(r.purchaserNo || '').trim();
          const pointsToActor = (!!refRoot && refRoot === actorRoot) || (!!refNo && !!actorNo && refNo === actorNo);
          if (pointsToActor) {
            // 首次注入门禁：无握手申请且对方档案里从未接纳过我 → 拒写
            if (!handshake && !acceptedRefs.has(actorRoot)) {
              rejected.push({ section: 'customers', owner: target, key, reason: '无双方合作申请凭证，不得新增客户档案' });
              continue;
            }
          } else {
            // 不指向 actor 的行：仅允许对既有行合并 type/cooperationDate（直客邀约确认场景），
            // 其余字段一律以服务端存量为准，防跨租户篡改额度等资料
            const prev = existingById.get(key);
            if (!prev) {
              rejected.push({ section: 'customers', owner: target, key, reason: '行内采购商凭证不是当前登录主体，不得新增' });
              continue;
            }
            const merged = { ...prev };
            if (r.type !== undefined) merged.type = r.type;
            if (r.cooperationDate !== undefined) merged.cooperationDate = r.cooperationDate;
            await upsertCustomerProfileRow(target, key, JSON.stringify(merged), ts + (i++));
            continue;
          }
        }
        await upsertCustomerProfileRow(target, key, JSON.stringify(r), ts + (i++));
      }
      if (own) { for (const k of removed) { if (k) await deleteCustomerProfileRow(target, k); } }
      else if (removed.length) { rejected.push({ section: 'customers', owner: target, key: removed.join(','), reason: '跨租户不得删除客户档案' }); }
    }

    // ---- customer_archives ----
    const ca = body.archives;
    if (ca && typeof ca === 'object') {
      const target = String(ca.owner || owner);
      await migrateArchives(target);
      const own = target === owner;
      const rows: any[] = Array.isArray(ca.rows) ? ca.rows : [];
      const removed: string[] = Array.isArray(ca.removedKeys) ? ca.removedKeys.map((k: any) => String(k)) : [];
      const ts = Date.now();
      let i = 0;
      if (own) {
        for (const r of rows) {
          const key = String(r?.id || '');
          if (!r || !key) continue;
          await upsertCustomerArchiveRow(target, key, JSON.stringify(r), ts + (i++));
        }
        for (const k of removed) { if (k) await deleteCustomerArchiveRow(target, k); }
      } else {
        // 跨租户：禁止新增/修改；仅允许解除「凭证指向 actor」的条目（批准写点 unarchiveParty），需 approved 握手
        if (rows.length) rejected.push({ section: 'archives', owner: target, key: '*', reason: '跨租户不得新增/修改归档条目' });
        const removeParty = ca.removeParty && typeof ca.removeParty === 'object' ? ca.removeParty : null;
        if (removed.length || removeParty) {
          const approved = await hasApprovedHandshake(actorRoot, rootOfAccount(idx, target), idx);
          const existing = rowsToRecords(await listCustomerArchives(target));
          const byId = new Map<string, any>();
          existing.forEach((r: any) => { if (r?.id) byId.set(String(r.id), r); });
          for (const k of removed) {
            const entry = byId.get(k);
            if (!entry) continue; // 已不存在视为幂等成功
            if (!approved) {
              rejected.push({ section: 'archives', owner: target, key: k, reason: '无已批准合作申请，不得解除对方归档' });
              continue;
            }
            if (!archiveEntryOfActor(entry, actorRoot, actorNo, idx)) {
              rejected.push({ section: 'archives', owner: target, key: k, reason: '归档条目凭证不是当前登录主体' });
              continue;
            }
            await deleteCustomerArchiveRow(target, k);
          }
          // 显式主体解除：客户端无对方归档镜像时按凭证申报（服务端只认凭证匹配 actor 的条目）
          if (removeParty) {
            const pUn = rootOfAccount(idx, removeParty.username);
            const pNo = String(removeParty.no || '').trim();
            const pointsToActor = (!!pUn && pUn === actorRoot) || (!!pNo && !!actorNo && pNo === actorNo);
            if (!pointsToActor) {
              rejected.push({ section: 'archives', owner: target, key: 'removeParty', reason: '解除主体凭证不是当前登录主体' });
            } else if (!approved) {
              rejected.push({ section: 'archives', owner: target, key: 'removeParty', reason: '无已批准合作申请，不得解除对方归档' });
            } else {
              for (const entry of existing) {
                if (archiveEntryOfActor(entry, actorRoot, actorNo, idx)) {
                  await deleteCustomerArchiveRow(target, String(entry.id));
                }
              }
            }
          }
        }
      }
    }

    // ---- customer_credit_adj（仅本人） ----
    const cc = body.creditAdjustments;
    if (cc && typeof cc === 'object') {
      const target = String(cc.owner || owner);
      if (target !== owner) {
        rejected.push({ section: 'creditAdjustments', owner: target, key: '*', reason: '额度调整仅本人可写' });
      } else {
        await migrateCreditAdj(target);
        const rows: any[] = Array.isArray(cc.rows) ? cc.rows : [];
        const removed: string[] = Array.isArray(cc.removedKeys) ? cc.removedKeys.map((k: any) => String(k)) : [];
        const ts = Date.now();
        let i = 0;
        for (const r of rows) {
          const key = String(r?.id || r?.key || '');
          if (!r || !key) continue;
          await upsertCustomerCreditAdjRow(target, key, JSON.stringify(r), ts + (i++));
        }
        for (const k of removed) { if (k) await deleteCustomerCreditAdjRow(target, k); }
      }
    }

    // ---- customer_pay_summary（仅本人；行级 updatedAt 防陈旧） ----
    const ps = body.paySummary;
    if (ps && typeof ps === 'object') {
      const target = String(ps.owner || owner);
      if (target !== owner) {
        rejected.push({ section: 'paySummary', owner: target, key: '*', reason: '欠款汇总仅本人可写' });
      } else {
        await migratePaySummary(target);
        const rows: any[] = Array.isArray(ps.rows) ? ps.rows : [];
        const removed: string[] = Array.isArray(ps.removedKeys) ? ps.removedKeys.map((k: any) => String(k)) : [];
        const existing = rowsToRecords(await listCustomerPaySummary(target));
        const prevByName = new Map<string, any>();
        existing.forEach((r: any) => { if (r?.key) prevByName.set(String(r.key), r); });
        const ts = Date.now();
        let i = 0;
        for (const r of rows) {
          const key = String(r?.key || '');
          if (!r || !key) continue;
          // ISO 串字典序即时间序：incoming 不旧于存量才覆写，防旧设备重算值覆盖新值
          const prev = prevByName.get(key);
          const incTs = String(r.updatedAt || '');
          const prevTs = String(prev?.updatedAt || '');
          if (prev && incTs && prevTs && incTs < prevTs) continue;
          await upsertCustomerPaySummaryRow(target, key, JSON.stringify(r), ts + (i++));
        }
        for (const k of removed) { if (k) await deleteCustomerPaySummaryRow(target, k); }
      }
    }

    if (rejected.length) {
      console.warn(`[customer] 写入被门禁拦下 ${rejected.length} 项（actor=${actor}）:`,
        rejected.slice(0, 5).map(r => `${r.section}/${r.owner}/${r.key}: ${r.reason}`).join(' | '));
    }
    res.json({ code: 200, data: await buildSnapshot(owner), rejected });
  } catch (err: any) {
    console.error('[customer] push error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;