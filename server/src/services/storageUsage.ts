/**
 * 租户存储用量统计服务（增量计算，双驱动异步版）
 *
 * 设计目标：避免每次查询都全表扫描 dataset_store。
 * - 增量：dataset 每次 PUT/DELETE 时按「新字节 - 旧字节」差值更新 owner_usage 计数器（O(1)）；
 * - 全量：仅在启动背填（计数器表为空）或手动「重新扫描」时做一次全表聚合；
 * - 归属：resolveOwnerKey 与客户端 getDataOwner 口径对齐（pageData_*_<owner> 及任意以
 *   注册用户名为后缀/内含 _<username>_ 的键）。
 *
 * 计数器按「账号名」分桶，但对外展示的用量口径是「公司（主账号）」：读侧由
 * getCompanyUsageBytes 把主账号与其名下子账号的计数器相加，不搬数据、不扫全表。
 */
import { store } from '../database/store';

// 用户索引（用户名集合 + 每个账号归属的主账号），60s 缓存；registeredUsers 变化时失效
let userIndexCache: { ts: number; names: Set<string>; roots: Map<string, string> } | null = null;

/** 沿 parentAccount 链追溯到真正的主账号（最多 8 层，防环），口径与 auth.routes.resolveOwner 一致 */
function rootOf(byName: Map<string, any>, name: string): string {
  let cur = name;
  const seen = new Set<string>([cur]);
  for (let i = 0; i < 8; i++) {
    const u = byName.get(cur);
    if (!u || !u.isSubAccount || !u.parentAccount) break;
    const next = String(u.parentAccount);
    if (seen.has(next)) break;
    seen.add(next);
    cur = next;
  }
  return cur;
}

async function loadUserIndex(): Promise<{ names: Set<string>; roots: Map<string, string> }> {
  if (userIndexCache && Date.now() - userIndexCache.ts < 60000) return userIndexCache;
  const names = new Set<string>();
  const byName = new Map<string, any>();
  // 隶属关系只存在于 registeredUsers 数据集（registered_users 表没有 parentAccount 列）
  try {
    const row = await store.getDataset('registeredUsers');
    if (row) for (const u of JSON.parse(row.dataset_json || '[]')) {
      if (u && u.username) { const n = String(u.username); names.add(n); byName.set(n, u); }
    }
  } catch { /* ignore */ }
  try {
    for (const r of await store.getAllUsers()) if (r.username) names.add(r.username);
  } catch { /* ignore */ }
  const roots = new Map<string, string>();
  for (const n of names) roots.set(n, rootOf(byName, n));
  userIndexCache = { ts: Date.now(), names, roots };
  return userIndexCache;
}

/** 某公司（主账号）名下的全部账号名：owner 自身 + 其所有子账号 */
export async function companyMembersOf(owner: string): Promise<string[]> {
  const { roots } = await loadUserIndex();
  const out = [owner];
  for (const [name, root] of roots) if (root === owner && name !== owner) out.push(name);
  return out;
}

/** 键归属租户解析：pageData 四段式取末段；其余键末段或中段命中已知用户名即归属该用户 */
export async function resolveOwnerKey(key: string): Promise<string> {
  const { names } = await loadUserIndex();
  const parts = key.split('_');
  if (parts.length >= 4 && parts[0] === 'pageData') {
    const last = parts[parts.length - 1];
    if (last && (names.has(last) || !!(await store.getUser(last)))) return last;
    return '';
  }
  const last = parts[parts.length - 1];
  if (last && last !== key && (names.has(last) || !!(await store.getUser(last)))) return last;
  for (let i = 1; i < parts.length - 1; i++) {
    if (names.has(parts[i]) || !!(await store.getUser(parts[i]))) return parts[i];
  }
  return '';
}

const byteLen = (s: string): number => Buffer.byteLength(s || '', 'utf8');

/** 增量调整某租户用量（写入/删除数据集时调用） */
export async function applyUsageDelta(owner: string, deltaBytes: number): Promise<void> {
  if (!owner || !deltaBytes) return;
  try {
    await store.addUsageDelta(owner, deltaBytes, Date.now());
  } catch (err: any) {
    console.error('[usage] delta error:', err.message);
  }
}

/** 数据集写入后调用：按新旧内容字节差增量更新计数 */
export async function applyUsageDeltaForWrite(key: string, oldJson: string | null, newJson: string | null): Promise<void> {
  if (key === 'registeredUsers') userIndexCache = null; // 用户名单/隶属关系变化：失效缓存
  const owner = await resolveOwnerKey(key);
  if (!owner) return;
  const delta = byteLen(newJson || '') - byteLen(oldJson || '');
  await applyUsageDelta(owner, delta);
}

/** 查询某租户数据库用量（字节，O(1) 读计数器） */
export async function getUsageBytes(owner: string): Promise<number> {
  try {
    return await store.getUsageBytes(owner);
  } catch {
    return 0;
  }
}

/**
 * 公司（主账号）级用量：把主账号与其名下子账号的计数器相加。
 * 读侧归并且不搬数据：成本只是「成员数 × 一次主键查询」，与 dataset_store 行数无关，
 * 因此不会拖慢启动，也不会像全表重算那样造成分钟级不可用。
 */
export async function getCompanyUsageBytes(owner: string): Promise<number> {
  if (!owner) return 0;
  let total = 0;
  for (const m of await companyMembersOf(owner)) total += await getUsageBytes(m);
  return total;
}

/** 全部租户用量映射（字节，按账号名分桶，开发者后台原始视图） */
export async function getAllUsageBytes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    for (const r of await store.allUsage()) out[r.owner] = Math.max(0, Number(r.bytes) || 0);
  } catch { /* ignore */ }
  return out;
}

/**
 * 全部租户用量映射：主账号行给公司合计，子账号行保留它自己名下的明细（开发者后台两种都要看得到）。
 * 合计只写进根账号，不会把同一个字节数算两遍（调用方不会对本映射求和）。
 */
export async function getAllUsageBytesByCompany(): Promise<Record<string, number>> {
  const { roots } = await loadUserIndex();
  const raw = await getAllUsageBytes();
  const out: Record<string, number> = { ...raw };
  for (const [name, bytes] of Object.entries(raw)) {
    const root = roots.get(name) || name;
    if (root === name) continue; // 根账号自己的桶已在结果里
    out[root] = (out[root] || 0) + bytes;
  }
  return out;
}

/** 全量重算（重新扫描）：单遍聚合 dataset_store，重写计数器；owner 为空时重算全部租户 */
export async function recomputeUsage(owner?: string): Promise<Record<string, number>> {
  const sums: Record<string, number> = {};
  try {
    for (const r of await store.allKeySizes()) {
      const o = await resolveOwnerKey(r.dataset_key);
      if (!o) continue;
      sums[o] = (sums[o] || 0) + (Number(r.bytes) || 0);
    }
    // 指定主账号时连同名下子账号一起重算（仍然是同一遍扫描，不增加成本），
    // 否则公司合计会因“只刷新主账号桶”而混入陈旧的子账号数据
    const targets = owner ? await companyMembersOf(owner) : Object.keys(sums);
    for (const t of targets) {
      await store.setUsageBytes(t, sums[t] || 0, Date.now());
    }
  } catch (err: any) {
    console.error('[usage] recompute error:', err.message);
  }
  if (!owner) return sums;
  const folded: Record<string, number> = {};
  for (const m of await companyMembersOf(owner)) folded[owner] = (folded[owner] || 0) + (sums[m] || 0);
  return folded;
}

/** 启动背填：计数器表为空时做一次全量聚合（仅首次升级后执行一次） */
export async function ensureUsageBackfill(): Promise<void> {
  try {
    const c = await store.usageCount();
    if (c === 0) {
      const sums = await recomputeUsage();
      console.log(`[usage] 首次背填完成，${Object.keys(sums).length} 个租户`);
    }
  } catch (err: any) {
    console.error('[usage] backfill error:', err.message);
  }
}

/** 供路由层取单键旧内容字节（删除场景增量用） */
export async function getDatasetJson(key: string): Promise<string | null> {
  try {
    const row = await store.getDataset(key);
    return row ? row.dataset_json : null;
  } catch {
    return null;
  }
}