/**
 * 启动期错桶迁移：把服务端残留的「子账号后缀」租户规范键并入主账号桶并排空来源键。
 *
 * 背景：子账号被误判为主账号时（陈旧令牌 owner=自己 / 会话 isSubAccount 字段缺失），
 * 订单等数据会写进 pageData_sales_order-manage_<子账号> 独立桶；主账号端不拉取这些键，
 * 表现为「子账号有订单、主账号没有」。写入侧重定向（sync.routes PUT）只挡新写入，
 * 历史残留由本迁移在每次启动时收敛（幂等：来源键排空后下次启动自动跳过）。
 *
 * 合并口径与客户端 mergeStrandedTenantDataset 一致：主桶已有的同 id 行优先，
 * 错桶独有的行补入主桶；不申报删除语义（来源键整体排空为 []）。
 */
import { store } from '../database/store';
import { tenantFamilySuffix, mergeRowsUnionJson } from '../middleware/syncGuard';

export async function migrateStrandedOwnerDatasets(): Promise<number> {
  try {
    const rec = await store.getDataset('registeredUsers');
    if (!rec) return 0;
    const users: any[] = JSON.parse(rec.dataset_json || '[]');
    if (!Array.isArray(users) || users.length === 0) return 0;
    const byName = new Map<string, any>();
    users.forEach((u: any) => { if (u && u.username) byName.set(String(u.username), u); });
    const rootOf = (name: string): string => {
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
    };
    const meta = await store.getAllMeta();
    let moved = 0;
    for (const m of meta) {
      const key = m.dataset_key;
      const suffix = tenantFamilySuffix(key);
      if (!suffix || !byName.has(suffix)) continue;
      const root = rootOf(suffix);
      if (!root || root === suffix) continue;
      const src = await store.getDataset(key).catch(() => undefined);
      if (!src) continue;
      let rows: any[] = [];
      try { rows = JSON.parse(src.dataset_json || '[]'); } catch { rows = []; }
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const targetKey = key.slice(0, key.length - suffix.length) + root;
      const tgt = await store.getDataset(targetKey).catch(() => undefined);
      // 主桶优先：existing=错桶行、incoming=主桶行 → 同 id 行保留主桶版本，错桶独有行补入
      const merged = mergeRowsUnionJson(src.dataset_json, tgt ? tgt.dataset_json : '[]');
      const ts = Date.now();
      await store.forceUpsertDataset(targetKey, merged, root, Math.max(ts, tgt ? tgt.updated_at : 0));
      await store.forceUpsertDataset(key, '[]', root, Math.max(ts, src.updated_at || 0));
      moved++;
      console.warn(`[rebucket] 错桶数据集 ${key} 已并入主桶 ${targetKey}（${rows.length} 行）`);
    }
    return moved;
  } catch (err: any) {
    // DB 不可写等失败不阻断启动：下次启动自动重试
    console.error('[rebucket] 错桶迁移失败（下次启动自动重试）:', (err && err.message) || err);
    return 0;
  }
}
