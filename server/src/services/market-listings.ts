/**
 * 商机市场服务层：独立库（market_listings）之上的业务语义
 * - 列表装饰：成品卡片库存实时 join 发布方商品列表（pageData_basic-data_product-list_<owner>），
 *   并按「库存同步设置」白名单决定查看方能否看到实际库存（未授权一律剥离库存字段）；
 * - 旧键迁移：market_publish_orders 存量存活记录一次性迁入独立库（幂等，墓碑不迁）；
 * - 报价合并：按报价方去重覆盖（与 Web/小程序同口径）。
 */
import { store } from '../database/store';
import { resolveCompanyRoot } from './storageUsage';
import {
  listAllListings, getListing, upsertListing, deleteListing,
  getInvSyncViewers, setInvSyncViewers,
} from '../database/market-store';

const LEGACY_KEY = 'market_publish_orders';
const MIGRATED_FLAG = 'market_listings_migrated_v1';

/** 查看方归属主账号（子账号沿 parentAccount 链上溯，失败回退自身） */
export async function marketOwnerOf(username: string): Promise<string> {
  try {
    return (await resolveCompanyRoot(username)) || username;
  } catch {
    return username;
  }
}

// ============ 库存同步设置 ============
/** 判定 viewer 能否看到 publisher 商品的实际库存：发布方自己恒可见；其余须命中白名单（未设置=不可见） */
export async function canViewerSeeStock(publisher: string, viewer: string, viewerOwner: string): Promise<boolean> {
  if (!publisher) return false;
  if (viewer === publisher || viewerOwner === publisher) return true;
  const list = await getInvSyncViewers(publisher);
  return list.includes(viewer) || (!!viewerOwner && list.includes(viewerOwner));
}

export { getInvSyncViewers, setInvSyncViewers };

// ============ 实时库存 join ============
/** 读取发布方商品列表（服务端 dataset_store 私有键，客户端跨账号读不到，只能在这里 join） */
async function productsOf(owner: string): Promise<any[]> {
  try {
    const row = await store.getDataset(`pageData_basic-data_product-list_${owner}`);
    if (!row) return [];
    const parsed = JSON.parse(row.dataset_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface StyleStock { total: number; byProductCode: Map<string, number>; byVariantKey: Map<string, number> }

/** 按款式聚合发布方实时库存：总量 + 按 SKU 编码/变体键的细分（join 变体明细用） */
function buildStyleStock(prods: any[]): Map<string, StyleStock> {
  const map = new Map<string, StyleStock>();
  for (const p of prods || []) {
    const sc = String(p?.styleCode || '');
    if (!sc) continue;
    let e = map.get(sc);
    if (!e) { e = { total: 0, byProductCode: new Map(), byVariantKey: new Map() }; map.set(sc, e); }
    const stock = Number(p?.actualStock) || 0;
    e.total += stock;
    const pc = String(p?.productCode || '');
    if (pc) e.byProductCode.set(pc, (e.byProductCode.get(pc) || 0) + stock);
    const k = String(p?.key || '');
    if (k) e.byVariantKey.set(k, (e.byVariantKey.get(k) || 0) + stock);
  }
  return map;
}

/** 剥离成品卡片中的实际库存字段（未授权查看方拿到的记录不含任何库存数值） */
function stripStock(rec: any): any {
  const out = { ...rec, quantity: undefined, canViewInventory: false };
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map((v: any) => ({ ...v, actualStock: undefined }));
  }
  return out;
}

/**
 * 列表装饰（GET /api/market/listings 的核心）：
 * 1. 只返回存活行（delisted=0 且记录未打墓碑）；
 * 2. 成品卡片实时 join 发布方商品列表库存（语义：市场库存=发布方当前实际库存）；
 * 3. 按查看方逐条判定库存可见性，未授权剥离库存字段并置 canViewInventory=false。
 */
export async function listDecoratedListings(viewer: string): Promise<any[]> {
  const rows = await listAllListings();
  const viewerOwner = viewer ? await marketOwnerOf(viewer) : '';
  // 发布方商品列表缓存：一次请求内同发布方只读一次 dataset
  const prodCache = new Map<string, Map<string, StyleStock>>();
  const invCache = new Map<string, boolean>();
  const out: any[] = [];
  for (const row of rows) {
    let rec: any;
    try { rec = JSON.parse(row.record_json); } catch { continue; }
    if (!rec || rec.delisted === true || row.delisted) continue;
    const pub = String(rec.publisherUsername || row.publisher || '');
    if (rec.type === 'finished') {
      if (!prodCache.has(pub)) prodCache.set(pub, buildStyleStock(await productsOf(pub)));
      const stock = prodCache.get(pub)!.get(String(rec.styleCode || ''));
      if (stock) {
        rec = { ...rec, quantity: stock.total };
        if (Array.isArray(rec.variants)) {
          rec.variants = rec.variants.map((v: any) => {
            const live = stock.byVariantKey.get(String(v?.key || ''))
              ?? stock.byProductCode.get(String(v?.productCode || ''));
            return live === undefined ? v : { ...v, actualStock: live };
          });
        }
      }
      const ck = `${pub}|${viewer}|${viewerOwner}`;
      if (!invCache.has(ck)) invCache.set(ck, await canViewerSeeStock(pub, viewer, viewerOwner));
      rec = invCache.get(ck) ? { ...rec, canViewInventory: true } : stripStock(rec);
    }
    out.push(rec);
  }
  return out;
}

// ============ 写路径 ============
/** upsert 单条记录（调用方须已完成归属校验）；返回落库后的行 */
export async function upsertRecord(rec: any): Promise<void> {
  const key = String(rec?.key || '');
  if (!key) throw new Error('record missing key');
  const pub = String(rec.publisherUsername || '');
  const ltype = rec.type === 'finished' ? 'finished' : 'semi';
  const delisted = rec.delisted === true ? 1 : 0;
  // 服务端注入字段不落库（读取时按查看方逐条派生）
  const { canViewInventory, ...clean } = rec;
  await upsertListing({
    listingKey: key, publisher: pub, ltype,
    recordJson: JSON.stringify(clean), delisted, updatedAt: Date.now(),
  });
}

/** 按 listing_key 删除（撤回发布：物理删除，独立库无并集复活语义） */
export async function deleteRecordByKey(listingKey: string, actorOwner: string): Promise<boolean> {
  const row = await getListing(listingKey);
  if (!row) return false;
  if (row.publisher !== actorOwner) return false;
  await deleteListing(listingKey);
  return true;
}

/**
 * 报价/询价合并：按报价方（bidderUsername）去重覆盖，首报后 待报价→报价中。
 * 独立库单行读改写，不再有整键替换风险。
 */
export async function mergeQuote(
  listingKey: string, quote: any,
): Promise<{ ok: boolean; message?: string; quoteCount?: number }> {
  const row = await getListing(listingKey);
  if (!row) return { ok: false, message: '该记录不存在或已删除' };
  let rec: any;
  try { rec = JSON.parse(row.record_json); } catch { return { ok: false, message: '记录数据损坏' }; }
  if (rec.delisted === true) return { ok: false, message: '该记录已下架' };
  if (rec.status === '已中标' || rec.status === '已关闭') return { ok: false, message: `该记录${rec.status}，不可报价` };
  const quotes: any[] = Array.isArray(rec.quotes) ? rec.quotes : [];
  const bidder = String(quote?.bidderUsername || '');
  const idx = quotes.findIndex((q: any) => String(q.bidderUsername || '') === bidder);
  if (idx >= 0) quotes[idx] = { ...quote, key: quotes[idx].key || quote.key };
  else quotes.push(quote);
  rec.quotes = quotes;
  if (rec.status === '待报价') rec.status = '报价中';
  await upsertRecord(rec);
  return { ok: true, quoteCount: quotes.length };
}

// ============ 旧键一次性迁移 ============
/**
 * 把 market_publish_orders 存量存活记录迁入独立库（启动时调用，幂等）：
 * - 墓碑（delisted=true）不迁——旧并集语义下的墓碑多为 sweep 误伤，独立库重新按发布方派生；
 * - 同 id 冲突保留 publishTime 较新的一条（旧全端副本可能各自发号）；
 * - 完成后写 system_settings 标记，不再重复迁移。
 */
export async function migrateLegacyMarketKey(): Promise<number> {
  try {
    const flag = await store.getSetting(MIGRATED_FLAG);
    if (flag === 'done') return 0;
    const row = await store.getDataset(LEGACY_KEY);
    if (!row) { await store.setSetting(MIGRATED_FLAG, 'done'); return 0; }
    const parsed = JSON.parse(row.dataset_json || '[]');
    const records: any[] = Array.isArray(parsed) ? parsed : [];
    // 同 id 去重：保留 publishTime 较新的
    const byId = new Map<string, any>();
    for (const rec of records) {
      if (!rec || rec.delisted === true || !rec.key) continue;
      const id = String(rec.id || rec.key);
      const prev = byId.get(id);
      if (!prev || new Date(rec.publishTime || 0).getTime() >= new Date(prev.publishTime || 0).getTime()) byId.set(id, rec);
    }
    let n = 0;
    for (const rec of byId.values()) {
      await upsertRecord(rec);
      n++;
    }
    await store.setSetting(MIGRATED_FLAG, 'done');
    if (n > 0) console.log(`[market] 旧键 market_publish_orders 迁移完成：${n} 条存活记录已迁入独立库`);
    return n;
  } catch (err: any) {
    console.error('[market] 旧键迁移失败（下次启动重试）:', err?.message || err);
    return 0;
  }
}
