/**
 * 订单桶修复（纯函数，客户端/服务端同口径）：
 * 1) 完全重复行（同 key）去重：历史会话在 owner 翻转/多次落地时把同一行 concat 进同一桶，
 *    表现为「同一个订单莫名多了一条」；
 * 2) 订单编号撞号重编号：主账号本地视图缺失子账号订单时取号会从 MC000002 重新开始，
 *    与既有订单撞号（MC 号是 patchOrderInStorage/账单重建的查找主键，必须唯一）。
 *    规则：最近更新的一行保留原编号，其余改派下一个空闲编号（仅处理 MC<数字> 标准号，
 *    MC000006-1 这类缺货拆分派生号不参与）。
 */
export interface OrderRepairResult {
  rows: any[];
  /** 被移除的完全重复行 key（上传时需 declareShrink 申报，否则永不缩水并集会复活） */
  removedKeys: string[];
  renumbered: { key: string; from: string; to: string }[];
}

const rowKeyOf = (r: any): string => (r && (r.key || r.id)) ? String(r.key || r.id) : '';

const rowTsOf = (r: any): number => {
  const t = Number(r && r.updatedAt) || 0;
  if (t) return t;
  const s = String((r && (r.updateTime || r.payTime || r.createTime)) || '');
  const p = Date.parse(s.replace(/-/g, '/'));
  return Number.isFinite(p) ? p : 0;
};

export const repairOrderBucket = (rows: any[]): OrderRepairResult => {
  const removedKeys: string[] = [];
  const renumbered: { key: string; from: string; to: string }[] = [];
  if (!Array.isArray(rows) || rows.length === 0) return { rows: Array.isArray(rows) ? rows : [], removedKeys, renumbered };

  // 1) 完全重复行（同 key）去重，保留首条
  const seen = new Set<string>();
  const deduped: any[] = [];
  rows.forEach((r) => {
    const k = rowKeyOf(r);
    if (k && seen.has(k)) { removedKeys.push(k); return; }
    if (k) seen.add(k);
    deduped.push(r);
  });

  // 2) 编号撞号：同 id 不同 key 的多行 → 最近更新者保留编号，其余改派空闲号
  const taken = new Set<string>();
  deduped.forEach((r) => { if (r && r.id) taken.add(String(r.id)); });
  const nextFree = (): string => {
    let max = 0;
    taken.forEach((id) => { const m = id.match(/^MC(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
    let cand = `MC${String(max + 1).padStart(6, '0')}`;
    while (taken.has(cand)) {
      max += 1;
      cand = `MC${String(max + 1).padStart(6, '0')}`;
    }
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
    group.slice(1).forEach((r) => {
      const to = nextFree();
      renumbered.push({ key: rowKeyOf(r), from: id, to });
      r.id = to;
    });
  });

  return { rows: deduped, removedKeys, renumbered };
};
