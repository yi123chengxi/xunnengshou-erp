/**
 * 终止合作（单方发起 + 7 天宽限期自动完成）共享模块：
 * - 建立合作后双方都不能直接删除关系，只能由任一方在欠款结清时单方发起终止；
 * - 发起时双方存储（供应商 boundPurchasers_<供应商账号> / 采购商 purchaser_suppliers_<采购商账号>）
 *   同时置 terminating 并记录 terminateAt（now+7天）与 terminateBy（发起方）；
 * - 各侧加载数据时对 terminateAt 到期的条目自动落盘为 terminated（完成终止）；
 * - 撤回时双方存储回退 approved 并清除终止字段。
 */

/** 终止合作宽限期：发起后 7 天自动完成终止 */
export const TERMINATE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface TerminationParties {
  initiator: 'supplier' | 'purchaser';
  supplierUsername: string;
  purchaserUsername: string;
  supplierCompany: string;
  purchaserCompany: string;
}

/** 单方发起终止：双方存储同时置 terminating 并记录生效时间（宽限 7 天到期自动完成） */
export const startCooperationTermination = (o: TerminationParties): number => {
  const statusTs = Date.now();
  const terminateAt = statusTs + TERMINATE_GRACE_MS;
  // 供应商侧：boundPurchasers_<供应商账号>
  try {
    const bKey = 'boundPurchasers_' + o.supplierUsername;
    const bound: any[] = JSON.parse(localStorage.getItem(bKey) || '[]');
    const up = bound.map((bp: any) => (
      (bp.purchaserUsername && bp.purchaserUsername === o.purchaserUsername) || bp.purchaserName === o.purchaserCompany
        ? { ...bp, status: 'terminating', terminateAt, terminateBy: o.initiator, statusTs }
        : bp
    ));
    localStorage.setItem(bKey, JSON.stringify(up));
  } catch { /* ignore */ }
  // 采购商侧：purchaser_suppliers_<采购商账号>
  try {
    const pKey = 'purchaser_suppliers_' + o.purchaserUsername;
    const list: any[] = JSON.parse(localStorage.getItem(pKey) || '[]');
    const up = list.map((s: any) => (
      (s.supplierUsername && s.supplierUsername === o.supplierUsername) || s.supplierName === o.supplierCompany
        ? { ...s, cooperationStatus: 'terminating', terminateAt, terminateBy: o.initiator, statusTs }
        : s
    ));
    localStorage.setItem(pKey, JSON.stringify(up));
  } catch { /* ignore */ }
  return terminateAt;
};

/** 撤回终止：双方存储回退 approved 并清除终止字段 */
export const cancelCooperationTermination = (o: TerminationParties): void => {
  const statusTs = Date.now();
  try {
    const bKey = 'boundPurchasers_' + o.supplierUsername;
    const bound: any[] = JSON.parse(localStorage.getItem(bKey) || '[]');
    const up = bound.map((bp: any) => (
      bp.status === 'terminating' && ((bp.purchaserUsername && bp.purchaserUsername === o.purchaserUsername) || bp.purchaserName === o.purchaserCompany)
        ? { ...bp, status: 'approved', terminateAt: undefined, terminateBy: undefined, statusTs }
        : bp
    ));
    localStorage.setItem(bKey, JSON.stringify(up));
  } catch { /* ignore */ }
  try {
    const pKey = 'purchaser_suppliers_' + o.purchaserUsername;
    const list: any[] = JSON.parse(localStorage.getItem(pKey) || '[]');
    const up = list.map((s: any) => (
      s.cooperationStatus === 'terminating' && ((s.supplierUsername && s.supplierUsername === o.supplierUsername) || s.supplierName === o.supplierCompany)
        ? { ...s, cooperationStatus: 'approved', terminateAt: undefined, terminateBy: undefined, statusTs }
        : s
    ));
    localStorage.setItem(pKey, JSON.stringify(up));
  } catch { /* ignore */ }
};

/** 存量数据修复：采购商侧 purchaser_suppliers_<账号> 合作条目供应商名称统一为已认证公司全称 */
export const repairPurchaserSupplierNames = (): void => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    if (!users.length) return;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('purchaser_suppliers_') !== 0) continue;
      let list: any[] = [];
      try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch { continue; }
      if (!Array.isArray(list)) continue;
      let ch = false;
      const up = list.map((s: any) => {
        if (!['approved', 'terminating', 'terminated'].includes(s.cooperationStatus)) return s;
        if (!(s.supplierUsername || s.supplierNo)) return s;
        const u = users.find((x: any) => (s.supplierUsername && x.username === s.supplierUsername) || (s.supplierNo && String(x.companyNo || '') === String(s.supplierNo)));
        if (u?.companyName && u.companyName !== s.supplierName) { ch = true; return { ...s, supplierName: u.companyName }; }
        return s;
      });
      if (ch) localStorage.setItem(k, JSON.stringify(up));
    }
  } catch { /* ignore */ }
};
