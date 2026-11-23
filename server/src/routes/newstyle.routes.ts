/**
 * 新款进度权威真表接口（/api/newstyle/*）
 *
 * 架构口径：服务端 newstyle_records 真表是唯一权威源（每条记录一行，写路径只改目标行）；
 * 客户端经本组接口读写，本地仅保留只读缓存（IndexedDB + localStorage 镜像供统计页同步读），
 * 四个数据键已退出全局键同步（serverSync EXCLUDE_PREFIXES）。
 * - 全部接口必须 JWT；归属（owner）由服务端令牌解析（子账号归主账号），客户端无法越权读写；
 * - /save 为整表提交语义：payload 全量行 upsert + 真表中不在 payload 的行删除（行级存储，
 *   删除不被并集复活），成功后返回该租户该数据集最新完整列表，客户端据此刷新页面与缓存。
 */
import { Router, Request, Response } from 'express';
import { verifyJWT } from './auth.routes';
import { store } from '../database/store';
import { listNewStyleRows, listNewStyleKeys, upsertNewStyleRow, deleteNewStyleRow, isNewStyleDataset, NewStyleDataset, NewStyleRow } from '../database/newstyle-store';
import { marketOwnerOf } from '../services/market-listings';

const router = Router();

const actorOf = (req: Request): string => String((req as any).user?.username || '');

/** 行转记录：record_json 解析失败的行跳过（坏行不阻断整列表） */
function rowsToRecords(rows: NewStyleRow[]): any[] {
  const out: any[] = [];
  rows.forEach((r) => {
    try {
      const rec = JSON.parse(r.record_json);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch { /* ignore */ }
  });
  return out;
}

/** 一次性迁移：真表为空时从旧全局同步键 newstyle_<dataset>_<owner>（dataset_store）导入历史数据 */
async function migrateLegacy(owner: string, dataset: NewStyleDataset): Promise<NewStyleRow[]> {
  let rows = await listNewStyleRows(owner, dataset);
  if (rows.length) return rows;
  try {
    const legacy = await store.getDataset(`newstyle_${dataset}_${owner}`);
    const parsed = legacy ? JSON.parse(legacy.dataset_json || '[]') : [];
    if (Array.isArray(parsed) && parsed.length) {
      const ts = Date.now();
      for (let i = 0; i < parsed.length; i++) {
        const rec = parsed[i];
        if (!rec || !rec.key) continue;
        await upsertNewStyleRow(owner, dataset, String(rec.key), JSON.stringify(rec), ts + i);
      }
      rows = await listNewStyleRows(owner, dataset);
      console.log(`[newstyle] 迁移旧同步键 newstyle_${dataset}_${owner} → 真表 ${rows.length} 行`);
    }
  } catch (err: any) {
    console.error('[newstyle] 旧键迁移失败:', err?.message || err);
  }
  return rows;
}

/** GET /api/newstyle/list?dataset=progress —— 拉取本人（主账号）某数据集全部记录（首访自动从旧同步键迁移） */
router.get('/list', verifyJWT, async (req: Request, res: Response) => {
  try {
    const dataset = String(req.query.dataset || '');
    if (!isNewStyleDataset(dataset)) { res.status(400).json({ code: 400, message: '非法数据集' }); return; }
    const owner = await marketOwnerOf(actorOf(req));
    const rows = await migrateLegacy(owner, dataset);
    res.json({ code: 200, data: { list: rowsToRecords(rows) } });
  } catch (err: any) {
    console.error('[newstyle] list error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/newstyle/save —— 整表提交（payload 行 upsert + 缺失行删除），返回最新完整列表 */
router.post('/save', verifyJWT, async (req: Request, res: Response) => {
  try {
    const dataset = String(req.body?.dataset || '');
    if (!isNewStyleDataset(dataset)) { res.status(400).json({ code: 400, message: '非法数据集' }); return; }
    const rows: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const owner = await marketOwnerOf(actorOf(req));
    // 无键行跳过（坏行不阻断整表提交）
    const keep = new Set<string>();
    const ts = Date.now();
    for (let i = 0; i < rows.length; i++) {
      const rec = rows[i];
      if (!rec || !rec.key) continue;
      const key = String(rec.key);
      keep.add(key);
      await upsertNewStyleRow(owner, dataset, key, JSON.stringify(rec), ts + i);
    }
    // 真表中不在 payload 的行 = 客户端已删除，物理删除（行级存储下删除无需并集申报）
    const existing = await listNewStyleKeys(owner, dataset);
    for (const k of existing) {
      if (!keep.has(k)) await deleteNewStyleRow(owner, dataset, k);
    }
    const list = rowsToRecords(await listNewStyleRows(owner, dataset));
    res.json({ code: 200, data: { list } });
  } catch (err: any) {
    console.error('[newstyle] save error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
