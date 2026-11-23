/**
 * 模具管理权威真表接口（/api/molds/*）
 *
 * 架构口径：服务端 molds 真表是唯一权威源（每条模具一行，写路径只改目标行）；
 * 客户端经本组接口读写，本地仅保留 IndexedDB 只读缓存，不再参与全局键同步。
 * - 全部接口必须 JWT；归属（owner）由服务端令牌解析（子账号归主账号），客户端无法越权读写他人模具；
 * - 写接口（create/update/delete）成功后统一返回该租户最新完整列表，客户端据此刷新页面与缓存，
 *   避免各端持有自己的全量副本互相覆盖（模具记录跨设备丢失的根因）。
 */
import { Router, Request, Response } from 'express';
import { verifyJWT } from './auth.routes';
import { store } from '../database/store';
import { listMolds, upsertMold, deleteMoldRow, MoldRow } from '../database/mold-store';
import { marketOwnerOf } from '../services/market-listings';

const router = Router();

const actorOf = (req: Request): string => String((req as any).user?.username || '');

/** 行转记录：record_json 解析失败的行跳过（坏行不阻断整列表） */
function rowsToRecords(rows: MoldRow[]): any[] {
  const out: any[] = [];
  rows.forEach((r) => {
    try {
      const rec = JSON.parse(r.record_json);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch { /* ignore */ }
  });
  return out;
}

/** 一次性迁移：真表为空时从旧全局同步键 molds_<owner>（dataset_store）导入历史数据 */
async function migrateLegacy(owner: string): Promise<MoldRow[]> {
  let rows = await listMolds(owner);
  if (rows.length) return rows;
  try {
    const legacy = await store.getDataset(`molds_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      for (let i = 0; i < parsed.length; i++) {
        const rec = parsed[i];
        if (!rec || !rec.key) continue;
        await upsertMold(owner, String(rec.key), JSON.stringify(rec), ts + i);
      }
      rows = await listMolds(owner);
      console.log(`[molds] 迁移旧同步键 molds_${owner} → 真表 ${rows.length} 行`);
    }
  } catch (err: any) {
    console.error('[molds] 旧键迁移失败:', err?.message || err);
  }
  return rows;
}

/** GET /api/molds/list —— 拉取本人（主账号）全部模具（首访自动从旧同步键迁移） */
router.get('/list', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const rows = await migrateLegacy(owner);
    res.json({ code: 200, data: { list: rowsToRecords(rows) } });
  } catch (err: any) {
    console.error('[molds] list error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/molds/create —— 新增模具（同键存在则覆盖），返回最新完整列表 */
router.post('/create', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const record = req.body?.record;
    if (!record || !record.key) { res.status(400).json({ code: 400, message: '缺少模具记录键' }); return; }
    await upsertMold(owner, String(record.key), JSON.stringify(record), Date.now());
    const rows = await listMolds(owner);
    res.json({ code: 200, data: { list: rowsToRecords(rows) } });
  } catch (err: any) {
    console.error('[molds] create error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/molds/update —— 编辑模具（按记录键 upsert），返回最新完整列表 */
router.post('/update', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const record = req.body?.record;
    if (!record || !record.key) { res.status(400).json({ code: 400, message: '缺少模具记录键' }); return; }
    await upsertMold(owner, String(record.key), JSON.stringify(record), Date.now());
    const rows = await listMolds(owner);
    res.json({ code: 200, data: { list: rowsToRecords(rows) } });
  } catch (err: any) {
    console.error('[molds] update error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/molds/import —— 批量导入（编号已存在则跳过），返回最新完整列表与导入/跳过统计 */
router.post('/import', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const records: any[] = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length) { res.json({ code: 200, data: { list: [], imported: 0, skipped: 0, skipReasons: [] } }); return; }
    const existing = await listMolds(owner);
    const codeSet = new Set<string>();
    existing.forEach((r) => {
      try { const rec = JSON.parse(r.record_json); if (rec && rec.moldCode) codeSet.add(String(rec.moldCode)); } catch { /* ignore */ }
    });
    let imported = 0;
    const skipReasons: string[] = [];
    const ts = Date.now();
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.key) { skipReasons.push(`第${i + 1}条：缺少记录键，已跳过`); continue; }
      const code = String(rec.moldCode || '');
      if (code && codeSet.has(code)) { skipReasons.push(`编号 ${code} 已存在，已跳过`); continue; }
      if (code) codeSet.add(code);
      await upsertMold(owner, String(rec.key), JSON.stringify(rec), ts + i);
      imported++;
    }
    const list = rowsToRecords(await listMolds(owner));
    res.json({ code: 200, data: { list, imported, skipped: skipReasons.length, skipReasons } });
  } catch (err: any) {
    console.error('[molds] import error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/molds/delete —— 物理删除模具，返回最新完整列表 */
router.post('/delete', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const key = String(req.body?.key || '');
    if (!key) { res.status(400).json({ code: 400, message: '缺少模具记录键' }); return; }
    await deleteMoldRow(owner, key);
    const rows = await listMolds(owner);
    res.json({ code: 200, data: { list: rowsToRecords(rows) } });
  } catch (err: any) {
    console.error('[molds] delete error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
