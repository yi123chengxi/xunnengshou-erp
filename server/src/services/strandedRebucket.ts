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

// ============ 订单桶修复（与客户端 utils/orderRepair.ts 同口径） ============
const rowKeyOf = (r: any): string => (r && (r.key || r.id)) ? String(r.key || r.id) : '';
const rowTsOf = (r: any): number => {
  const t = Number(r && r.updatedAt) || 0;
  if (t) return t;
  const s = String((r && (r.updateTime || r.payTime || r.createTime)) || '');
  const p = Date.parse(s.replace(/-/g, '/'));
  return Number.isFinite(p) ? p : 0;
};
/** 完全重复行（同 key）去重 + MC 编号撞号重编号（最近更新者保留原号） */
export function repairOrderBucket(rows: any[]): { rows: any[]; removedKeys: string[]; renumbered: { key: string; from: string; to: string }[] } {
  const removedKeys: string[] = [];
  const renumbered: { key: string; from: string; to: string }[] = [];
  if (!Array.isArray(rows) || rows.length === 0) return { rows: Array.isArray(rows) ? rows : [], removedKeys, renumbered };
  const seen = new Set<string>();
  const deduped: any[] = [];
  rows.forEach((r) => {
    const k = rowKeyOf(r);
    if (k && seen.has(k)) { removedKeys.push(k); return; }
    if (k) seen.add(k);
    deduped.push(r);
  });
  const taken = new Set<string>();
  deduped.forEach((r) => { if (r && r.id) taken.add(String(r.id)); });
  const nextFree = (): string => {
    let max = 0;
    taken.forEach((id) => { const m = id.match(/^MC(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
    let cand = `MC${String(max + 1).padStart(6, '0')}`;
    while (taken.has(cand)) { max += 1; cand = `MC${String(max + 1).padStart(6, '0')}`; }
    taken.add(cand);
    return cand;
  };
  const byId = new Map<string, any[]>();
  deduped.forEach((r) => {
    const id = r && r.id ? String(r.id) : '';
    if (!id || !/^MC\d+$/.test(id)) return;
    const g = byId.get(id);
    if (g) g.push(r); else byId.set(id, [r]);
  });
  byId.forEach((group, id) => {
    if (group.length < 2) return;
    group.sort((a, b) => rowTsOf(b) - rowTsOf(a));
    group.slice(1).forEach((r) => { const to = nextFree(); renumbered.push({ key: rowKeyOf(r), from: id, to }); r.id = to; });
  });
  return { rows: deduped, removedKeys, renumbered };
}

export async function migrateStrandedOwnerDatasets(): Promise<number> {
  try {
    const rec = await store.getDataset('registeredUsers');
    if (!rec) return 0;
    const users: any[] = JSON.parse(rec.dataset_json || '[]');
    if (!Array.isArray(users) || users.length === 0) return 0;
    const byName = new Map<string, any>();
    users.forEach((u: any) => { if (u && u.username) byName.set(String(u.username), u); });
    // 身份污染修复（启动即修，不等客户端自愈）：被其他行当作父账号引用、自己却被标成
    // 子账号且父账号悬空（指向不存在的账号）的行，恢复为主账号。真实事故：yichengxi60
    // 被一份陈旧本地注册表改写成 sub/parent='admin'（admin 不存在），主账号登录后走
    // 子账号角色层（roles 空）→ 供应商菜单全部被拒，表现为「所有权限突然没了」。
    const referencedAsParent = new Set<string>();
    users.forEach((u: any) => { if (u && u.parentAccount) referencedAsParent.add(String(u.parentAccount)); });
    let healedIdentity = 0;
    users.forEach((u: any) => {
      if (!u || !u.username || u.isSubAccount !== true) return;
      const name = String(u.username);
      const parent = u.parentAccount ? String(u.parentAccount) : '';
      const dangling = !parent || !byName.has(parent);
      if (dangling && referencedAsParent.has(name)) {
        console.warn(`[rebucket] 身份修复：${name} 被误标为子账号且父账号「${parent || '(空)'}」不存在，恢复为主账号`);
        u.isSubAccount = false;
        u.parentAccount = '';
        healedIdentity++;
      }
    });
    if (healedIdentity > 0) {
      await store.forceUpsertDataset('registeredUsers', JSON.stringify(users), '', Math.max(Date.now(), rec.updated_at || 0));
    }
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
      // 逐键隔离：单键异常（坏 JSON/单键写失败等）不得打断其余键的收敛
      try {
        const src = await store.getDataset(key).catch(() => undefined);
        if (!src) continue;
        let rows: any[] = [];
        try { rows = JSON.parse(src.dataset_json || '[]'); } catch { rows = []; }
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const targetKey = key.slice(0, key.length - suffix.length) + root;
        const tgt = await store.getDataset(targetKey).catch(() => undefined);
        // 主桶优先：existing=错桶行、incoming=主桶行 → 同 id 行保留主桶版本，错桶独有行补入
        const merged = mergeRowsUnionJson(src.dataset_json, tgt ? tgt.dataset_json : '[]');
        // 归并后立刻修复订单桶：完全重复行去重 + 编号撞号重编号
        let finalJson = merged;
        if (targetKey.startsWith('pageData_sales_order-manage_')) {
          try {
            const rep = repairOrderBucket(JSON.parse(merged));
            finalJson = JSON.stringify(rep.rows);
            if (rep.renumbered.length > 0) console.warn(`[rebucket] 编号撞号重编号 ${rep.renumbered.map(x => `${x.from}→${x.to}`).join(',')}`);
          } catch { /* ignore */ }
        }
        const ts = Date.now();
        await store.forceUpsertDataset(targetKey, finalJson, root, Math.max(ts, tgt ? tgt.updated_at : 0));
        await store.forceUpsertDataset(key, '[]', root, Math.max(ts, src.updated_at || 0));
        moved++;
        console.warn(`[rebucket] 错桶数据集 ${key} 已并入主桶 ${targetKey}（${rows.length} 行）`);
      } catch (err: any) {
        console.error(`[rebucket] 单键迁移失败已跳过 ${key}:`, (err && err.message) || err);
      }
    }
    // 第二轮：各租户自有桶就地修复（完全重复行 + 编号撞号），不依赖是否存在错桶来源
    for (const m of meta) {
      const key = m.dataset_key;
      const suffix = tenantFamilySuffix(key);
      if (!suffix || !byName.has(suffix)) continue;
      if (rootOf(suffix) !== suffix) continue; // 错桶键第一轮已处理/排空
      if (!key.startsWith('pageData_sales_order-manage_')) continue;
      // 逐键隔离：同第一轮
      try {
        const row = await store.getDataset(key).catch(() => undefined);
        if (!row) continue;
        let rows2: any[] = [];
        try { rows2 = JSON.parse(row.dataset_json || '[]'); } catch { rows2 = []; }
        if (!Array.isArray(rows2) || rows2.length === 0) continue;
        const rep = repairOrderBucket(rows2);
        if (rep.removedKeys.length === 0 && rep.renumbered.length === 0) continue;
        await store.forceUpsertDataset(key, JSON.stringify(rep.rows), suffix, Math.max(Date.now(), row.updated_at || 0));
        moved++;
        console.warn(`[rebucket] 订单桶 ${key} 就地修复：去重 ${rep.removedKeys.length} 行、重编号 ${rep.renumbered.length} 行`);
      } catch (err: any) {
        console.error(`[rebucket] 单键就地修复失败已跳过 ${key}:`, (err && err.message) || err);
      }
    }
    return moved;
  } catch (err: any) {
    // DB 不可写等失败不阻断启动：下次启动自动重试
    console.error('[rebucket] 错桶迁移失败（下次启动自动重试）:', (err && err.message) || err);
    return 0;
  }
}

// 运行期周期迁移：注册表隶属关系可能在运行期变化（如在线数据串联、账号管理改绑），
// 仅启动时跑一次会错过窗口（历史事故：串联写入后无重启，错桶一直不收敛）。
// 10 分钟一轮 + 在途守卫；迁移本身幂等，无错桶时两轮 meta 扫描即空转返回。
let migrationInflight = false;
export function startStrandedMigrationLoop(intervalMs = 10 * 60_000): void {
  setInterval(() => {
    if (migrationInflight) return;
    migrationInflight = true;
    void migrateStrandedOwnerDatasets()
      .then((n) => { if (n > 0) console.log(`[rebucket] 周期迁移收敛 ${n} 个数据集`); })
      .catch(() => { /* ignore */ })
      .finally(() => { migrationInflight = false; });
  }, intervalMs);
}
