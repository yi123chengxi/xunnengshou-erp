/**
 * 商机市场独立库 API 客户端（/api/market/*）
 *
 * 架构口径：服务端 market_listings 真表是唯一权威源；本地 MARKET_KEY
 * （market_publish_orders）退役为只读缓存——不再参与 serverSync 全局键同步，
 * 页面挂载/查询时经 fetchMarketListings 水合缓存，写操作走 API 后同步更新缓存。
 * 写失败不阻塞 UI（缓存先行），下次拉取以服务端为准收敛。
 */
import { API_BASE } from './apiBase';
import { safeSetItem } from './storageQuota';

export const MARKET_CACHE_KEY = 'market_publish_orders';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  try {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* ignore */ }
  return headers;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** 读本地只读缓存（离线兜底） */
export function readMarketCache(): any[] {
  try {
    const v = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** 写本地只读缓存（仅 safeSetItem，不再走 saveDataset 上传旧全局键） */
export function writeMarketCache(list: any[]): void {
  try { safeSetItem(MARKET_CACHE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/**
 * 拉取服务端权威列表并水合本地缓存。
 * 失败（离线/服务端不可达）返回 null，调用方继续用缓存。
 * 成品记录带服务端注入的 canViewInventory 与实时库存（quantity/variants.actualStock）。
 */
export async function fetchMarketListings(): Promise<any[] | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/market/listings`, { headers: authHeaders() }, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.data?.list) ? data.data.list : null;
    if (!list) return null;
    writeMarketCache(list);
    return list;
  } catch { return null; }
}

/**
 * 批量 upsert 自己的发布记录（发布/编辑/下架打标记/自动上架派生统一走这里）。
 * 只提交发布方=自己主账号的记录（服务端也按此校验，他人记录会被拒绝）。
 */
export async function pushMarketRecords(records: any[]): Promise<boolean> {
  if (!Array.isArray(records) || records.length === 0) return true;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/market/listings`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ records }),
    }, 15000);
    return res.ok;
  } catch { return false; }
}

/** 物理删除自己的发布记录（撤回发布） */
export async function deleteMarketRecords(keys: string[]): Promise<boolean> {
  if (!Array.isArray(keys) || keys.length === 0) return true;
  try {
    const res = await fetchWithTimeout(`${API_BASE}/market/listings/delete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keys }),
    }, 15000);
    return res.ok;
  } catch { return false; }
}

/** 报价/询价：服务端对目标行做单条合并（同报价方去重覆盖） */
export async function submitMarketQuote(listingKey: string, quote: any): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/market/quote`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ key: listingKey, quote }),
    }, 15000);
    return res.ok;
  } catch { return false; }
}

/** 读取本人（供应商主账号）的库存同步设置：可见实际库存的采购商白名单 */
export async function fetchInvSyncSettings(): Promise<string[] | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/market/inv-sync`, { headers: authHeaders() }, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.data?.viewers) ? data.data.viewers : null;
  } catch { return null; }
}

/** 保存库存同步设置（整组覆盖；空名单=所有采购商不可见实际库存） */
export async function saveInvSyncSettings(viewers: string[]): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/market/inv-sync`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ viewers }),
    }, 15000);
    return res.ok;
  } catch { return false; }
}
