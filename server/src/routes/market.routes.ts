/**
 * 商机市场独立库 API（/api/market/*）
 *
 * 取代 market_publish_orders 全局同步键：服务端 market_listings 真表为唯一权威源，
 * Web/小程序经本路由读写；客户端只保留只读缓存，不再整键上传/拉取。
 *
 * 鉴权口径：
 * - GET /listings 允许匿名（货盘公开分享页无登录态）——匿名视为未授权查看方，库存一律剥离；
 * - 写路径必须 JWT，且记录归属（publisherUsername）须等于操作者主账号，
 *   唯一例外是报价/询价（POST /quote）：报价方写的是别人的发布单，走单行合并接口。
 */
import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyJWT, JWTPayload } from './auth.routes';
import { getJwtSecret } from '../utils/jwtSecret';
import { store } from '../database/store';
import {
  listDecoratedListings, upsertRecord, deleteRecordByKey, mergeQuote,
  marketOwnerOf, getInvSyncViewers, setInvSyncViewers,
} from '../services/market-listings';

const JWT_SECRET = getJwtSecret();
const router = Router();

/** 可选鉴权：带令牌则解析（失败按匿名处理），不带令牌放行——供公开分享页读取市场列表 */
function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      (req as any).user = jwt.verify(authHeader.slice(7), JWT_SECRET) as JWTPayload;
    } catch { /* 无效令牌按匿名处理 */ }
  }
  next();
}

const actorOf = (req: Request): string => String((req as any).user?.username || '');

/** 公司名解析（registeredUsers 数据集，服务端权威口径，不信任客户端快照） */
async function companyOf(username: string): Promise<string> {
  try {
    const row = await store.getDataset('registeredUsers');
    if (row) {
      const users: any[] = JSON.parse(row.dataset_json || '[]');
      const hit = Array.isArray(users) ? users.find((u: any) => u && u.username === username) : null;
      if (hit?.companyName) return String(hit.companyName);
    }
  } catch { /* ignore */ }
  return username;
}

/** GET /api/market/listings —— 全量存活记录（成品含实时库存 join + 按查看方剥离未授权库存） */
router.get('/listings', optionalAuth, async (req: Request, res: Response) => {
  try {
    const viewer = actorOf(req);
    const list = await listDecoratedListings(viewer);
    res.json({ code: 200, data: { list, serverTs: Date.now() } });
  } catch (err: any) {
    console.error('[market] listings error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** PUT /api/market/listings —— 批量 upsert（仅发布方本人记录；发布/编辑/下架打标记/自动上架派生统一走这里） */
router.put('/listings', verifyJWT, async (req: Request, res: Response) => {
  try {
    const actor = actorOf(req);
    const owner = await marketOwnerOf(actor);
    const records: any[] = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length) { res.json({ code: 200, data: { saved: 0, rejected: [] } }); return; }
    let saved = 0;
    const rejected: { key: string; reason: string }[] = [];
    for (const rec of records.slice(0, 500)) {
      const key = String(rec?.key || '');
      if (!key) { rejected.push({ key: '', reason: '缺少记录键' }); continue; }
      // 归属校验：发布方主账号必须等于操作者主账号（子账号以主账号名义发布）
      if (String(rec?.publisherUsername || '') !== owner) {
        rejected.push({ key, reason: '无权修改他人发布记录' });
        continue;
      }
      await upsertRecord(rec);
      saved++;
    }
    res.json({ code: 200, data: { saved, rejected } });
  } catch (err: any) {
    console.error('[market] upsert error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/market/listings/delete —— 物理删除（撤回发布；仅发布方本人记录） */
router.post('/listings/delete', verifyJWT, async (req: Request, res: Response) => {
  try {
    const actor = actorOf(req);
    const owner = await marketOwnerOf(actor);
    const keys: string[] = Array.isArray(req.body?.keys) ? req.body.keys.map((k: any) => String(k)) : [];
    let deleted = 0;
    for (const key of keys.slice(0, 500)) {
      if (key && (await deleteRecordByKey(key, owner))) deleted++;
    }
    res.json({ code: 200, data: { deleted } });
  } catch (err: any) {
    console.error('[market] delete error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** POST /api/market/quote —— 报价/询价单行合并（同报价方去重覆盖；报价方身份由服务端令牌解析） */
router.post('/quote', verifyJWT, async (req: Request, res: Response) => {
  try {
    const actor = actorOf(req);
    const owner = await marketOwnerOf(actor);
    const key = String(req.body?.key || '');
    if (!key) { res.status(400).json({ code: 400, message: '缺少记录键' }); return; }
    const b = req.body?.quote || {};
    const unitPrice = Number(b.unitPrice) || 0;
    const quote = {
      key: String(b.key || `q_${owner}_${Date.now()}`),
      bidderUsername: owner, bidderCompany: await companyOf(owner),
      unitPrice,
      totalPrice: Number(b.totalPrice) || 0,
      quantity: Number(b.quantity) || 0,
      deliveryDays: Number(b.deliveryDays) || 0,
      contactPerson: String(b.contactPerson || ''), contactPhone: String(b.contactPhone || ''),
      remark: String(b.remark || ''),
      quoteTime: new Date().toISOString(), status: '待确认',
    };
    const result = await mergeQuote(key, quote);
    if (!result.ok) { res.status(400).json({ code: 400, message: result.message || '报价失败' }); return; }
    res.json({ code: 200, data: { saved: true, quoteCount: result.quoteCount } });
  } catch (err: any) {
    console.error('[market] quote error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** GET /api/market/inv-sync —— 读取本人（供应商主账号）的库存同步设置白名单 */
router.get('/inv-sync', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const viewers = await getInvSyncViewers(owner);
    res.json({ code: 200, data: { publisher: owner, viewers } });
  } catch (err: any) {
    console.error('[market] inv-sync get error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

/** PUT /api/market/inv-sync —— 整组覆盖库存同步设置（未列入的采购商不可见实际库存） */
router.put('/inv-sync', verifyJWT, async (req: Request, res: Response) => {
  try {
    const owner = await marketOwnerOf(actorOf(req));
    const viewers: string[] = Array.isArray(req.body?.viewers) ? req.body.viewers.map((v: any) => String(v)) : [];
    await setInvSyncViewers(owner, viewers.slice(0, 2000));
    res.json({ code: 200, data: { saved: true, viewers } });
  } catch (err: any) {
    console.error('[market] inv-sync put error:', err?.message || err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

export default router;
