/**
 * 合作状态闭环：同一公司对（无论谁供谁采）全网只共享一个合作状态。
 * 背景：双向合作镜像（供应商侧 boundPurchasers_<供应商> 采购商卡片 / 采购商侧 purchaser_suppliers_<采购商> 供应商卡片）
 * 由各自流程写入，任一环节漏写、错写形状都会导致两公司后台显示的状态分叉。
 * 本模块聚合公司对的全部镜像，取规范状态（terminated > terminating > approved）回写所有镜像记录，
 * 按正确形状补全缺失镜像，并清理误混入 boundPurchasers 的供应商卡片 / 自引用脏数据，
 * 保证双方客户列表与供应商列表对同一合作关系始终显示一致状态。
 *
 * 陈旧副本隔离（防状态来回跳动）：非本账号的镜像键（如供应商浏览器里残留的
 * purchaser_suppliers_<采购商>）不参与本端启动拉取（isKeyForCurrentAccount 过滤），内容可能
 * 停留在任意久以前。这类副本只用于「知道存在哪一对合作关系」，禁止参与状态仲裁、禁止被回写或
 * 清理——否则一次页面加载就会用别的账号的陈旧状态改写本端权威键，再经上传固化到服务端。
 */
import { getDataOwner } from './brandAuth';
import { declareShrink } from './shrinkRegistry';

const STATUS_RANK: Record<string, number> = { approved: 1, terminating: 2, terminated: 3 };
const BOUND_PREFIX = 'boundPurchasers_';
const PS_PREFIX = 'purchaser_suppliers_';

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
    const me = getDataOwner();
    /** 本端是否持有该镜像键的权威副本：只有自己账号下的键会被启动拉取刷新，其余都是陈旧快照 */
    const isTrusted = (key: string): boolean => {
      const owner = key.indexOf(BOUND_PREFIX) === 0 ? key.slice(BOUND_PREFIX.length) : key.slice(PS_PREFIX.length);
      return !!me && owner === me;
    };
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

    // 时效守卫：终止/终止中镜像若存在同公司对更新的未作废合作申请（重新合作/邀约受理），
    // 不得参与规范状态仲裁——否则陈旧浏览器里的旧终止镜像会把新建合作改回已解除并回传服务端
    const apps: any[] = (() => { try { return JSON.parse(localStorage.getItem('cooperation_applications') || '[]'); } catch { return []; } })();
    const appTs = (a: any): number => Date.parse(String(a.approveDate || a.applyDate || '').replace(/-/g, '/')) || 0;
    const supersededByNewerCoop = (r: Rec): boolean => {
      if (r.status !== 'terminated' && r.status !== 'terminating') return false;
      const sRec = users.find(u => u.username === r.s);
      return apps.some((a: any) =>
        (a.type || 'cooperation') === 'cooperation' && !a.superseded &&
        (a.status === 'approved' || a.status === 'pending') &&
        a.purchaserUsername === r.p &&
        (a.supplierUsername === r.s || (sRec?.companyName && a.targetSupplierName === sRec.companyName)) &&
        appTs(a) > r.ts);
    };
    const guardedRecs = recs.filter(r => !supersededByNewerCoop(r));
    // 状态仲裁只采纳本账号权威副本：对方账号键的本地副本不会被拉取刷新，它的状态不能拿来裁决本公司
    const trustedRecs = guardedRecs.filter(r => isTrusted(r.key));

    // 公司对规范状态：取最近一次状态事件（statusTs/业务时间），同时间再取最进阶（terminated > terminating > approved）
    const arbitrate = (src: Rec[]): Map<string, { status: string; terminateAt: number; terminateBy: string; ts: number }> => {
      const out = new Map<string, { status: string; terminateAt: number; terminateBy: string; ts: number }>();
      src.forEach(r => {
        if (!STATUS_RANK[r.status] || r.s === r.p) return;
        const pk = pairKey(r.s, r.p);
        const cur = out.get(pk);
        const rank = STATUS_RANK[r.status];
        if (!cur || r.ts > cur.ts || (r.ts === cur.ts && rank > STATUS_RANK[cur.status])) {
          out.set(pk, { status: r.status, terminateAt: r.terminateAt, terminateBy: r.terminateBy, ts: r.ts });
        }
      });
      return out;
    };
    const canon = arbitrate(trustedRecs);
    // 宽松参考状态：含陈旧副本的仲裁结果，只用于「代写对方账号时补全缺失的新卡片」，绝不回写已有行
    const canonLoose = arbitrate(guardedRecs);
    if (canonLoose.size === 0 && dropMarks.length === 0) return;

    const changed = new Set<string>();
    const holderOf = (key: string) => (key.indexOf(BOUND_PREFIX) === 0 ? boundKeys : psKeys).find(x => x.key === key);

    // 1) 规范状态回写正确位置镜像（misplaced 记录不回写原位置，由补全+清理接管）
    //    仅回写本账号权威键：对方账号的键由对方自己按权威副本维护，代写等于用陈旧状态覆盖对方最新操作
    recs.forEach(r => {
      if (r.shape === 'misplaced' || r.s === r.p || !STATUS_RANK[r.status]) return;
      if (!isTrusted(r.key)) return;
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
    guardedRecs.forEach(r => { if (r.s !== r.p && STATUS_RANK[r.status]) dirs.set(pairKey(r.s, r.p), { s: r.s, p: r.p }); });
    dirs.forEach(({ s, p }) => {
      const pk = pairKey(s, p);
      const src = guardedRecs.filter(r => pairKey(r.s, r.p) === pk);
      const pRec = users.find(u => u.username === p);
      const sRec = users.find(u => u.username === s);
      // 供应商侧 boundPurchasers_<s> 应有 p 的采购商卡片
      const bKey = BOUND_PREFIX + s;
      // 本账号权威键只采纳仲裁结果；代写对方账号时允许参考陈旧副本，但仅在缺行时追加新卡片，不改已有行
      const cBound = canon.get(pk) || (isTrusted(bKey) ? undefined : canonLoose.get(pk));
      let bHolder = boundKeys.find(x => x.key === bKey);
      const bExist = bHolder ? bHolder.list.some((e: any) => e && e.purchaserUsername === p) : false;
      if (cBound && !bExist) {
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
          status: cBound.status,
          province: pRec?.province || '', city: pRec?.city || '', district: pRec?.district || '',
          detailAddress: pRec?.detailAddress || '',
        };
        if (cBound.status !== 'approved') { if (cBound.terminateAt) card.terminateAt = cBound.terminateAt; if (cBound.terminateBy) card.terminateBy = cBound.terminateBy; }
        if (cBound.ts) card.statusTs = cBound.ts;
        if (!bHolder) { bHolder = { key: bKey, owner: s, list: [] }; boundKeys.push(bHolder); }
        bHolder.list.push(card);
        changed.add(bKey);
      }
      // 采购商侧 purchaser_suppliers_<p> 应有 s 的供应商卡片
      const pKey = PS_PREFIX + p;
      const cPs = canon.get(pk) || (isTrusted(pKey) ? undefined : canonLoose.get(pk));
      let pHolder = psKeys.find(x => x.key === pKey);
      const pExist = pHolder ? pHolder.list.some((e: any) => e && e.supplierUsername === s) : false;
      if (cPs && !pExist) {
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
          cooperationStatus: cPs.status,
          province: sRec?.province || '', city: sRec?.city || '', district: sRec?.district || '', address: sRec?.address || '',
          orderPrefix: base.orderPrefix || '',
        };
        if (cPs.status !== 'approved') { if (cPs.terminateAt) card.terminateAt = cPs.terminateAt; if (cPs.terminateBy) card.terminateBy = cPs.terminateBy; }
        if (cPs.ts) card.statusTs = cPs.ts;
        if (!pHolder) { pHolder = { key: pKey, owner: p, list: [] }; psKeys.push(pHolder); }
        pHolder.list.push(card);
        changed.add(pKey);
      }
    });

    // 3) 清理误放/自引用脏条目（倒序删除避免错位）
    //    只清理本账号权威键，并随上传申报 removedIds：这两个键属于「永不缩水键」，
    //    不申报的减少会被服务端并集保留，被清理的脏条目会在下次拉取时复活
    const byKey = new Map<string, number[]>();
    dropMarks.forEach(m => {
      if (!isTrusted(m.key)) return;
      const arr = byKey.get(m.key) || []; arr.push(m.idx); byKey.set(m.key, arr);
    });
    byKey.forEach((idxs, key) => {
      const holder = holderOf(key);
      if (!holder) return;
      const removed: string[] = [];
      idxs.sort((a, b) => b - a).forEach(idx => {
        const gone = holder.list[idx];
        if (gone && gone.id) removed.push(String(gone.id));
        holder.list.splice(idx, 1);
      });
      if (removed.length) declareShrink(key, removed);
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
