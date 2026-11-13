/**
 * 租户存储用量统计服务（增量计算，双驱动异步版）
 *
 * 设计目标：避免每次查询都全表扫描 dataset_store。
 * - 增量：dataset 每次 PUT/DELETE 时按「新字节 - 旧字节」差值更新 owner_usage 计数器（O(1)）；
 * - 全量：仅在启动背填（计数器表为空）或手动「重新扫描」时做一次全表聚合；
 * - 归属：resolveOwnerKey 与客户端 getDataOwner 口径对齐（pageData_*_<owner> 及任意以
 *   注册用户名为后缀/内含 _<username>_ 的键）。
 */
import { store } from '../database/store';

// 已知用户名集合（服务端用户表 + 客户端同步上来的 registeredUsers 数据集），60s 缓存
let userNamesCache: { ts: number; names: Set<string> } | null = null;
async function knownUserNames(): Promise<Set<string>> {
  if (userNamesCache && Date.now() - userNamesCache.ts < 60000) return userNamesCache.names;
  const names = new Set<string>();
  try {
    for (const r of await store.getAllUsers()) if (r.username) names.add(r.username);
  } catch { /* ignore */ }
  try {
    const row = await store.getDataset('registeredUsers');
    if (row) for (const u of JSON.parse(row.dataset_json || '[]')) if (u && u.username) names.add(String(u.username));
  } catch { /* ignore */ }
  userNamesCache = { ts: Date.now(), names };
  return names;
}

/** 键归属租户解析：pageData 四段式取末段；其余键末段或中段命中已知用户名即归属该用户 */
export async function resolveOwnerKey(key: string): Promise<string> {
  const names = await knownUserNames();
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
  if (key === 'registeredUsers') userNamesCache = null; // 用户名单变化：失效缓存
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

/** 全部租户用量映射（字节） */
export async function getAllUsageBytes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    for (const r of await store.allUsage()) out[r.owner] = Math.max(0, Number(r.bytes) || 0);
  } catch { /* ignore */ }
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
    const targets = owner ? [owner] : Object.keys(sums);
    for (const t of targets) {
      await store.setUsageBytes(t, sums[t] || 0, Date.now());
    }
    // 指定租户重算时若该租户已无数据也要归零
    if (owner && !sums[owner]) await store.setUsageBytes(owner, 0, Date.now());
  } catch (err: any) {
    console.error('[usage] recompute error:', err.message);
  }
  return owner ? { [owner]: sums[owner] || 0 } : sums;
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
