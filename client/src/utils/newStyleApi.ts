/**
 * 新款进度权威真表 API 客户端（/api/newstyle/*）
 *
 * 架构口径：服务端 newstyle_records 真表是唯一权威源；本地 IndexedDB（newstyle_<dataset>_<owner>）
 * 退化为只读缓存（离线兜底/加速首屏），localStorage 同名键仅作统计页同步读的镜像缓存，
 * 四个数据键不再参与全局键同步（serverSync EXCLUDE_PREFIXES 已排除）。
 * 读：优先请求服务端，成功更新 IndexedDB 缓存；失败读缓存并由调用方提示「当前为离线缓存」。
 * 写：前端整表提交 → 后端行级 upsert/删除 → 后端返回最新完整列表 → 前端更新页面与缓存；
 * 写失败返回 null，调用方提示重试，本地副本不作权威（杜绝陈旧副本整键覆盖丢数据）。
 */
import { API_BASE } from './apiBase';
import { saveDataset, loadDataset } from './dataStore';

export type NewStyleDataset = 'progress' | 'photo' | 'arrival' | 'listing';

export const newStyleCacheKey = (owner: string, dataset: NewStyleDataset): string => `newstyle_${dataset}_${owner}`;

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

/** 读 IndexedDB 离线缓存（服务端不可达时的兜底数据源） */
export async function readNewStyleCache(owner: string, dataset: NewStyleDataset): Promise<any[]> {
  try {
    const rec = await loadDataset(newStyleCacheKey(owner, dataset));
    if (!rec) return [];
    const parsed = JSON.parse(rec.json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** 写 IndexedDB 只读缓存（异步容错，失败不影响当次会话） */
export function writeNewStyleCache(owner: string, dataset: NewStyleDataset, list: any[]): void {
  try { saveDataset(newStyleCacheKey(owner, dataset), JSON.stringify(list)); } catch { /* ignore */ }
}

/** 拉取服务端权威列表并水合缓存；失败（离线/服务端不可达）返回 null */
export async function fetchNewStyle(owner: string, dataset: NewStyleDataset): Promise<any[] | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/newstyle/list?dataset=${encodeURIComponent(dataset)}`, { headers: authHeaders() }, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.data?.list) ? data.data.list : null;
    if (!list) return null;
    writeNewStyleCache(owner, dataset, list);
    return list;
  } catch { return null; }
}

/** 服务端优先加载：成功更新缓存；失败读 IndexedDB 缓存并标记 offline */
export async function loadNewStyle(owner: string, dataset: NewStyleDataset): Promise<{ records: any[]; offline: boolean }> {
  const list = await fetchNewStyle(owner, dataset);
  if (list) return { records: list, offline: false };
  const cached = await readNewStyleCache(owner, dataset);
  return { records: cached, offline: true };
}

/** 整表提交：后端行级 upsert + 缺失行删除后返回最新完整列表（null=失败，调用方提示重试） */
export async function saveNewStyle(owner: string, dataset: NewStyleDataset, rows: any[]): Promise<any[] | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/newstyle/save`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ dataset, rows }),
    }, 20000);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.data?.list) ? data.data.list : null;
    if (!list) return null;
    writeNewStyleCache(owner, dataset, list);
    return list;
  } catch { return null; }
}
