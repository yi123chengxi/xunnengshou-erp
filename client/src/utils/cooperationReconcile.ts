/**
 * 合作状态闭环：同一公司对（无论谁供谁采）全网只共享一个合作状态。
 * 背景：双向合作镜像（供应商侧 boundPurchasers_<供应商> 采购商卡片 / 采购商侧 purchaser_suppliers_<采购商> 供应商卡片）
 * 由各自流程写入，任一环节漏写、错写形状都会导致两公司后台显示的状态分叉。
 * 本模块聚合公司对的全部镜像，取规范状态（terminated > terminating > approved）回写所有镜像记录，
 * 按正确形状补全缺失镜像，并清理误混入 boundPurchasers 的供应商卡片 / 自引用脏数据，
 * 保证双方客户列表与供应商列表对同一合作关系始终显示一致状态。
 */

const STATUS_RANK: Record<string, number> = { approved: 1, terminating: 2, terminated: 3 };

const parseTs = (v: any): number => {
  if (!v) return 0;
  const t = Date.parse(String(v).replace(/-/g, '/'));
  return Number.isFinite(t) ? t : 0;
};

/** 记录的状态事件时间：优先显式 statusTs；存量数据回退 terminateAt / 业务日期 */
const recTs = (status: string, e: any): number => {
  const explicit = Number(e.statusTs) || 0;
  if (explicit) return explicit;
  if (status === 'terminated' || status === 'terminating') {
    return Number(e.terminateAt) || parseTs(e.addedDate || e.cooperationDate);
  }
  return parseTs(e.cooperationDate || e.addedDate || e.bindDate);
};

interface Rec {
  s: string;
  p: string;
  status: string;
  terminateAt: number;
  terminateBy: string;
  ts: number;
  key: string;
  idx: number;
  /** bound=boundPurchasers 正确位置采购商卡片；ps=purchaser_suppliers 正确位置供应商卡片；misplaced=误放 boundPurchasers 的供应商卡片（待清理） */
  shape: 'bound' | 'ps' | 'misplaced';
}

const pairKey = (s: string, p: string) => (s < p ? s + '|' + p : p + '|' + s);

export function reconcileCooperationPairs(): void {
  try {
    const users: any[] = (() => { try { return JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { return []; } })();
    const boundKeys: { key: string; owner: string; list: any[] }[] = [];
    const psKeys: { key: string; owner: string; list: any[] }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf('boundPurchasers_') === 0) {
        try { const list = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(list)) boundKeys.push({ key: k, owner: k.slice('boundPurchasers_'.length), list }); } catch { /* ignore */ }
      } else if (k.indexOf('purchaser_suppliers_') === 0) {
        try { const list = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(list)) psKeys.push({ key: k, owner: k.slice('purchaser_suppliers_'.length), list }); } catch { /* ignore */ }
      }
    }

    const recs: Rec[] = [];
    const dropMarks: { key: string; idx: number }[] = [];
    boundKeys.forEach(({ key, owner, list }) => {
      list.forEach((e: any, idx: number) => {
        if (!e || typeof e !== 'object') return;
        if (e.purchaserUsername) {
          recs.push({ s: owner, p: String(e.purchaserUsername), status: e.status || '', terminateAt: Number(e.terminateAt) || 0, terminateBy: e.terminateBy || '', ts: recTs(e.status || '', e), key, idx, shape: 'bound' });
        } else if (e.supplierUsername) {
          // 供应商卡片误混入 boundPurchasers：实为（供应商=该供应商，采购商=本键 owner）方向镜像，补全正确位置后清理
          const s = String(e.supplierUsername);
          if (s === owner) { dropMarks.push({ key, idx }); return; } // 自引用脏数据，直接丢弃
          const st = e.cooperationStatus || e.status || '';
          recs.push({ s, p: owner, status: st, terminateAt: Number(e.terminateAt) || 0, terminateBy: e.terminateBy || '', ts: recTs(st, e), key, idx, shape: 'misplaced' });
          dropMarks.push({ key, idx });
        }
      });
    });
    psKeys.forEach(({ key, owner, list }) => {
      list.forEach((e: any, idx: number) => {
        if (!e || typeof e !== 'object' || !e.supplierUsername) return;
        recs.push({ s: String(e.supplierUsername), p: owner, status: e.cooperationStatus || '', terminateAt: Number(e.terminateAt) || 0, terminateBy: e.terminateBy || '', ts: recTs(e.cooperationStatus || '', e), key, idx, shape: 'ps' });
      });
    });

    // 公司对规范状态：取最近一次状态事件（statusTs/业务时间），同时间再取最进阶（terminated > terminating > approved）
    const canon = new Map<string, { status: string; terminateAt: number; terminateBy: string; ts: number }>();
    recs.forEach(r => {
      if (!STATUS_RANK[r.status] || r.s === r.p) return;
      const pk = pairKey(r.s, r.p);
      const cur = canon.get(pk);
      const rank = STATUS_RANK[r.status];
      if (!cur || r.ts > cur.ts || (r.ts === cur.ts && rank > STATUS_RANK[cur.status])) {
        canon.set(pk, { status: r.status, terminateAt: r.terminateAt, terminateBy: r.terminateBy, ts: r.ts });
      }
    });
    if (canon.size === 0 && dropMarks.length === 0) return;

    const changed = new Set<string>();
    const holderOf = (key: string) => (key.indexOf('boundPurchasers_') === 0 ? boundKeys : psKeys).find(x => x.key === key);

    // 1) 规范状态回写正确位置镜像（misplaced 记录不回写原位置，由补全+清理接管）
    recs.forEach(r => {
      if (r.shape === 'misplaced' || r.s === r.p || !STATUS_RANK[r.status]) return;
      const c = canon.get(pairKey(r.s, r.p));
      const holder = holderOf(r.key);
      if (!c || !holder) return;
      const e = holder.list[r.idx];
      if (!e) return;
      const field = r.shape === 'bound' ? 'status' : 'cooperationStatus';
      const oldAt = Number(e.terminateAt) || 0;
      const oldTs = Number(e.statusTs) || 0;
      if (e[field] === c.status && (c.status === 'approved' ? oldAt === 0 : oldAt === c.terminateAt) && oldTs === (c.ts || 0)) return;
      e[field] = c.status;
      if (c.status === 'approved') { delete e.terminateAt; delete e.terminateBy; }
      else { if (c.terminateAt) e.terminateAt = c.terminateAt; if (c.terminateBy) e.terminateBy = c.terminateBy; }
      if (c.ts) e.statusTs = c.ts;
      changed.add(r.key);
    });

    // 2) 每方向镜像补全：boundPurchasers_<s> / purchaser_suppliers_<p> 任一侧缺失时按对侧镜像 + registeredUsers 补正确形状
    const dirs = new Map<string, { s: string; p: string }>();
    recs.forEach(r => { if (r.s !== r.p && STATUS_RANK[r.status]) dirs.set(pairKey(r.s, r.p), { s: r.s, p: r.p }); });
    dirs.forEach(({ s, p }) => {
      const c = canon.get(pairKey(s, p));
      if (!c) return;
      const pk = pairKey(s, p);
      const src = recs.filter(r => pairKey(r.s, r.p) === pk);
      const pRec = users.find(u => u.username === p);
      const sRec = users.find(u => u.username === s);
      // 供应商侧 boundPurchasers_<s> 应有 p 的采购商卡片
      const bKey = 'boundPurchasers_' + s;
      let bHolder = boundKeys.find(x => x.key === bKey);
      const bExist = bHolder ? bHolder.list.some((e: any) => e && e.purchaserUsername === p) : false;
      if (!bExist) {
        const from = src.find(r => r.shape === 'bound') || src[0];
        const base: any = (from && holderOf(from.key) ? holderOf(from.key)!.list[from.idx] : null) || {};
        const card: any = {
          id: base.id || `BIND-${p.slice(-6)}`,
          purchaserName: pRec?.companyName || base.purchaserName || p,
          purchaserUsername: p,
          purchaserNo: pRec?.companyNo || base.purchaserNo || '',
          purchaserContact: pRec?.contactPerson || base.purchaserContact || '',
          purchaserPhone: pRec?.phone || base.purchaserPhone || '',
          bindDate: String(base.cooperationDate || base.addedDate || base.bindDate || '').slice(0, 10),
          status: c.status,
          province: pRec?.province || '', city: pRec?.city || '', district: pRec?.district || '',
          detailAddress: pRec?.detailAddress || '',
        };
        if (c.status !== 'approved') { if (c.terminateAt) card.terminateAt = c.terminateAt; if (c.terminateBy) card.terminateBy = c.terminateBy; }
        if (c.ts) card.statusTs = c.ts;
        if (!bHolder) { bHolder = { key: bKey, owner: s, list: [] }; boundKeys.push(bHolder); }
        bHolder.list.push(card);
        changed.add(bKey);
      }
      // 采购商侧 purchaser_suppliers_<p> 应有 s 的供应商卡片
      const pKey = 'purchaser_suppliers_' + p;
      let pHolder = psKeys.find(x => x.key === pKey);
      const pExist = pHolder ? pHolder.list.some((e: any) => e && e.supplierUsername === s) : false;
      if (!pExist) {
        const from = src.find(r => r.shape === 'ps' || r.shape === 'misplaced') || src[0];
        const base: any = (from && holderOf(from.key) ? holderOf(from.key)!.list[from.idx] : null) || {};
        const card: any = {
          id: base.id || `SP-${Date.now()}`,
          supplierName: sRec?.companyName || base.supplierName || s,
          supplierUsername: s,
          supplierNo: sRec?.companyNo || base.supplierNo || '',
          contactPerson: sRec?.contactPerson || base.contactPerson || '',
          contactPhone: sRec?.phone || base.contactPhone || '',
          addedDate: base.addedDate || new Date().toISOString().slice(0, 19).replace('T', ' '),
          cooperationDate: base.cooperationDate || String(base.bindDate || '').slice(0, 10),
          cooperationStatus: c.status,
          province: sRec?.province || '', city: sRec?.city || '', district: sRec?.district || '', address: sRec?.address || '',
          orderPrefix: base.orderPrefix || '',
        };
        if (c.status !== 'approved') { if (c.terminateAt) card.terminateAt = c.terminateAt; if (c.terminateBy) card.terminateBy = c.terminateBy; }
        if (c.ts) card.statusTs = c.ts;
        if (!pHolder) { pHolder = { key: pKey, owner: p, list: [] }; psKeys.push(pHolder); }
        pHolder.list.push(card);
        changed.add(pKey);
      }
    });

    // 3) 清理误放/自引用脏条目（倒序删除避免错位）
    const byKey = new Map<string, number[]>();
    dropMarks.forEach(m => { const arr = byKey.get(m.key) || []; arr.push(m.idx); byKey.set(m.key, arr); });
    byKey.forEach((idxs, key) => {
      const holder = holderOf(key);
      if (!holder) return;
      idxs.sort((a, b) => b - a).forEach(idx => holder.list.splice(idx, 1));
      changed.add(key);
    });

    // 4) 回写变更键（经 setItem 钩子自动触发跨浏览器同步上传）
    changed.forEach(key => {
      const holder = holderOf(key);
      if (holder) localStorage.setItem(key, JSON.stringify(holder.list));
    });
    // 通知已挂载页面（客户列表/供应商列表）重读存储，立即呈现一致状态
    if (changed.size > 0) {
      try { window.dispatchEvent(new Event('sync-data-updated')); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
