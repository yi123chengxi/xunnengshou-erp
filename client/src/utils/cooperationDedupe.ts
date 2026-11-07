/**
 * 采购商侧供应商列表同源去重兜底（加载时自愈）：
 * 历史写点（供应商按编号申请 / 邀约链接受理 / 供应商端审批自动新增）在"本地副本陈旧"时
 * 会为同一供应商生成不同 id 的条目，服务端同步过期并集合并（union merge）会把新旧 id 同时保留，
 * 导致列表出现同名供应商多条记录；且自动新增分支曾把采购商联系人误写入供应商档案。
 * 本模块在页面加载时按"同一供应商账号/公司编号/唯一公司名"合并条目：
 * - 主条目优先取带 supplierUsername/supplierNo 且状态最新者；
 * - 其余条目的非空字段被吸收，addedDate 取最早值；
 * - 供应商档案（联系人/电话/邮箱）按注册账号修复被污染的取值；
 * - 合作申请记录中指向被合并 id 的引用改写为主条目 id。
 */
import { loadRegisteredUsers } from './cooperationInvite';

const PURCHASER_SUPPLIERS_PREFIX = 'purchaser_suppliers_';
const COOPERATION_APPLICATIONS_KEY = 'cooperation_applications';

/** 同名公司账号消歧：优先选取 boundPurchasers 中确实绑定了本采购商的账号 */
const resolveSupplierUserByName = (name: string, owner: string, users: any[]): any => {
  const cands = users.filter((u: any) => String(u.companyName || '') === name);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const me = users.find((u: any) => u.username === owner);
  const myCompany = me?.companyName || owner;
  const bound = cands.find((c: any) => {
    try {
      const b: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + c.username) || '[]');
      return b.some((bp: any) => bp.purchaserUsername === owner || bp.purchaserName === myCompany);
    } catch { return false; }
  });
  return bound || cands[0];
};

/** 合并采购商供应商列表中的同源重复条目；返回是否发生合并（已落盘） */
export const dedupePurchaserSuppliers = (owner: string): boolean => {
  try {
    const pKey = PURCHASER_SUPPLIERS_PREFIX + owner;
    const list: any[] = JSON.parse(localStorage.getItem(pKey) || '[]');
    if (!Array.isArray(list) || list.length < 2) return false;
    const users = loadRegisteredUsers();
    const nameCount = new Map<string, number>();
    users.forEach((u: any) => {
      const n = String(u.companyName || '');
      if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1);
    });
    const keyOf = (s: any): string | null => {
      if (s.supplierUsername) return 'u:' + s.supplierUsername;
      if (String(s.supplierNo || '').trim()) return 'n:' + String(s.supplierNo).trim().toUpperCase();
      const name = String(s.supplierName || '');
      if (!name) return null;
      if (nameCount.get(name) === 1) return 'c:' + name;
      const u = resolveSupplierUserByName(name, owner, users);
      return u ? 'u:' + u.username : null;
    };
    const groups = new Map<string, any[]>();
    const mergedList: any[] = [];
    list.forEach((s) => {
      const k = keyOf(s);
      if (!k) { mergedList.push(s); return; }
      const g = groups.get(k);
      if (g) g.push(s); else groups.set(k, [s]);
    });
    let changed = false;
    const idRemap = new Map<string, string>();
    const tsOf = (s: any) => Number(s.statusTs || 0) || Date.parse(String(s.addedDate || '').replace(/-/g, '/')) || 0;
    const weightOf = (s: any) =>
      (s.supplierUsername ? 4 : 0) + (s.supplierNo ? 2 : 0) +
      (['approved', 'terminating'].includes(s.cooperationStatus) ? 8 : 0);
    groups.forEach((g) => {
      if (g.length === 1) { mergedList.push(g[0]); return; }
      changed = true;
      const primary = g.slice().sort((a, b) => (weightOf(b) - weightOf(a)) || (tsOf(b) - tsOf(a)))[0];
      const merged: any = { ...primary };
      g.forEach((o) => {
        if (o === primary) return;
        idRemap.set(o.id, primary.id);
        Object.keys(o).forEach((k) => {
          const v = o[k];
          if (v !== undefined && v !== '' && (merged[k] === undefined || merged[k] === '')) merged[k] = v;
        });
        // 加入时间取最早值，保留条目真实创建时间
        if (o.addedDate && (!merged.addedDate || String(o.addedDate) < String(merged.addedDate))) merged.addedDate = o.addedDate;
      });
      // 供应商档案按注册账号修复：仅修复空白或"误写成采购商联系人/电话"的污染值，保留人工编辑
      const me = users.find((u: any) => u.username === owner);
      const su = users.find((u: any) => u.username === merged.supplierUsername) ||
        resolveSupplierUserByName(String(merged.supplierName || ''), owner, users);
      if (su) {
        if (!merged.supplierUsername) merged.supplierUsername = su.username;
        if (!merged.supplierNo && su.companyNo) merged.supplierNo = su.companyNo;
        if (su.contactPerson && (!merged.contactPerson || merged.contactPerson === me?.contactPerson)) merged.contactPerson = su.contactPerson;
        if (su.phone && (!merged.contactPhone || merged.contactPhone === me?.phone)) merged.contactPhone = su.phone;
        if (su.email && !merged.email) merged.email = su.email;
      }
      mergedList.push(merged);
    });
    if (!changed) return false;
    // 合作申请中指向被合并 id 的引用改写为主条目 id，避免审批/终止匹配落空
    try {
      const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
      let appChanged = false;
      apps.forEach((a: any) => {
        if (a.purchaserSupplierEntryId && idRemap.has(a.purchaserSupplierEntryId)) { a.purchaserSupplierEntryId = idRemap.get(a.purchaserSupplierEntryId); appChanged = true; }
        if (a.targetSupplierId && idRemap.has(a.targetSupplierId)) { a.targetSupplierId = idRemap.get(a.targetSupplierId); appChanged = true; }
      });
      if (appChanged) localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));
    } catch { /* ignore */ }
    localStorage.setItem(pKey, JSON.stringify(mergedList));
    return true;
  } catch { return false; }
};
