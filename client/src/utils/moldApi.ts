/**
 * 模具管理权威真表 API 客户端（/api/molds/*）
 *
 * 架构口径：服务端 molds 真表是唯一权威源；本地 IndexedDB（molds_<owner>）
 * 退化为只读缓存（离线兜底/加速首屏），localStorage 不再存放全量模具表。
 * 读：优先请求服务端，成功更新 IndexedDB 缓存；失败读缓存并由调用方提示「当前为离线缓存」。
 * 写：前端提交 → 后端写库 → 后端返回最新完整列表 → 前端更新页面与缓存；
 * 写失败返回 null，调用方提示重试，不做本地脏写（杜绝陈旧副本整键覆盖丢数据）。
 */
import { API_BASE } from './apiBase';
import { saveDataset, loadDataset } from './dataStore';

export const moldCacheKey = (owner: string): string => `molds_${owner}`;

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
export async function readMoldCache(owner: string): Promise<any[]> {
  try {
    const rec = await loadDataset(moldCacheKey(owner));
    if (!rec) return [];
    const parsed = JSON.parse(rec.json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** 写 IndexedDB 只读缓存（异步容错，失败不影响当次会话） */
function writeMoldCache(owner: string, list: any[]): void {
  try { saveDataset(moldCacheKey(owner), JSON.stringify(list)); } catch { /* ignore */ }
}

/** 拉取服务端权威列表并水合缓存；失败（离线/服务端不可达）返回 null */
export async function fetchMolds(owner: string): Promise<any[] | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/molds/list`, { headers: authHeaders() }, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.data?.list) ? data.data.list : null;
    if (!list) return null;
    writeMoldCache(owner, list);
    return list;
  } catch { return null; }
}

/** 服务端优先加载：成功更新缓存；失败读 IndexedDB 缓存并标记 offline */
export async function loadMolds(owner: string): Promise<{ records: any[]; offline: boolean }> {
  const list = await fetchMolds(owner);
  if (list) return { records: list, offline: false };
  const cached = await readMoldCache(owner);
  return { records: cached, offline: true };
}

async function postMold(path: string, body: any): Promise<any[] | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/molds${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }, 15000);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.data?.list) ? data.data.list : null;
  } catch { return null; }
}

/** 新增模具：后端写库后返回最新完整列表（null=失败，调用方提示重试） */
export async function createMold(owner: string, record: any): Promise<any[] | null> {
  const list = await postMold('/create', { record });
  if (list) writeMoldCache(owner, list);
  return list;
}

/** 编辑模具：后端按记录键 upsert 后返回最新完整列表 */
export async function updateMold(owner: string, record: any): Promise<any[] | null> {
  const list = await postMold('/update', { record });
  if (list) writeMoldCache(owner, list);
  return list;
}

/** 删除模具：后端物理删除后返回最新完整列表 */
export async function deleteMoldByKey(owner: string, key: string): Promise<any[] | null> {
  const list = await postMold('/delete', { key });
  if (list) writeMoldCache(owner, list);
  return list;
}

/** 批量导入模具：后端按编号去重（已存在跳过）后返回最新完整列表与导入/跳过统计 */
export async function importMolds(owner: string, records: any[]): Promise<{ list: any[]; imported: number; skipped: number; skipReasons: string[] } | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/molds/import`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ records }),
    }, 30000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.data?.list)) return null;
    const list = data.data.list;
    writeMoldCache(owner, list);
    return {
      list,
      imported: Number(data.data.imported) || 0,
      skipped: Number(data.data.skipped) || 0,
      skipReasons: Array.isArray(data.data.skipReasons) ? data.data.skipReasons : [],
    };
  } catch { return null; }
}
