/**
 * 财务管理主菜单待处理气泡计数：
 * 汇总当前登录账号在「报销 / 收付申请 / 开票申请」三个页面中的待处理任务数量，
 * 判定口径与各页面标签页保持一致：
 * - 报销：待审核（pending_review，审核负责人）+ 待支付（approved/pending_payment，支付负责人）
 * - 收/付申请：收款确认（receipt+pending_confirm）+ 付款审核（pending_review）+ 待支付（approved）
 * - 开票申请：收件箱中未到「开票成功/已开票」的申请（待开票）
 * 负责人名单为空或名单内账号全部失效时视为「所有人都可操作」，与页面逻辑一致。
 */
import { getSessionOwner, accountRootOf } from './dataOwner';

export interface FinancePending {
  total: number;
  reimbursement: number;
  paymentRequest: number;
  invoiceApply: number;
}

const parseJson = <T>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** 本租户成员账号集合（主账号 + 子账号，过滤其他租户；账号表读不到时返回空集=不做过滤） */
const getTenantMembers = (owner: string): Set<string> | null => {
  try {
    const users: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    if (!Array.isArray(users) || users.length === 0) return null;
    const members = new Set<string>([owner]);
    users.forEach((u: any) => {
      if (u && u.username && accountRootOf(users, String(u.username)) === owner) members.add(String(u.username));
    });
    return members;
  } catch {
    return null;
  }
};

/** 负责人名单过滤判定：admin 恒真；名单空/全失效 → 所有人可处理；否则须包含当前用户 */
const isManagerForTab = (
  rawList: string[],
  isAdmin: boolean,
  username: string,
  members: Set<string> | null,
): boolean => {
  if (isAdmin) return true;
  const list = Array.isArray(rawList) ? rawList : [];
  const mgrs = members && members.size > 0 ? list.filter(un => members.has(String(un))) : list;
  if (mgrs.length === 0) return true;
  return mgrs.includes(username);
};

export const getFinancePendingCounts = (): FinancePending => {
  const username = localStorage.getItem('username') || '';
  if (!username) return { total: 0, reimbursement: 0, paymentRequest: 0, invoiceApply: 0 };
  const isAdmin = localStorage.getItem('isSubAccount') !== 'true';
  const owner = getSessionOwner() || username;
  const members = getTenantMembers(owner);

  // ===== 报销 =====
  let reimbursement = 0;
  try {
    const records: any[] = parseJson(localStorage.getItem(`reimbursement_${owner}`), []);
    const mgrs: Record<string, string[]> = parseJson(localStorage.getItem(`reimbursement_managers_${owner}`), {});
    const canReview = isManagerForTab(mgrs.review || [], isAdmin, username, members);
    const canPay = isManagerForTab(mgrs.payment || [], isAdmin, username, members);
    for (const r of records) {
      if (canReview && r.status === 'pending_review') { reimbursement++; continue; }
      if (canPay && (r.status === 'approved' || r.status === 'pending_payment')) reimbursement++;
    }
  } catch { /* 数据损坏时跳过该模块 */ }

  // ===== 收/付申请 =====
  let paymentRequest = 0;
  try {
    const records: any[] = parseJson(localStorage.getItem(`payment_requests_${owner}`), []);
    const mgrs: Record<string, string[]> = parseJson(localStorage.getItem(`payment_request_managers_${owner}`), {});
    const canReceipt = isManagerForTab(mgrs.receipt || [], isAdmin, username, members);
    const canReview = isManagerForTab(mgrs.review || [], isAdmin, username, members);
    const canPay = isManagerForTab(mgrs.pay || [], isAdmin, username, members);
    for (const r of records) {
      if (canReceipt && r.recordType === 'receipt' && r.status === 'pending_confirm') { paymentRequest++; continue; }
      if (canReview && r.status === 'pending_review') { paymentRequest++; continue; }
      if (canPay && r.status === 'approved') paymentRequest++;
    }
  } catch { /* 数据损坏时跳过该模块 */ }

  // ===== 开票申请（收件箱，无负责人门控） =====
  let invoiceApply = 0;
  try {
    const records: any[] = parseJson(localStorage.getItem(`invoice_apply_requests_${owner}`), []);
    invoiceApply = records.filter(r => (r.status || '待开票') === '待开票').length;
  } catch { /* 数据损坏时跳过该模块 */ }

  const total = reimbursement + paymentRequest + invoiceApply;
  return { total, reimbursement, paymentRequest, invoiceApply };
};

/** storage 事件是否命中财务待处理相关键（用于跨标签页实时刷新气泡） */
export const isFinancePendingStorageKey = (key: string | null | undefined): boolean => {
  if (!key) return true; // 整库清空等 null 键：直接刷新
  return (
    key.startsWith('reimbursement_') ||
    key.startsWith('payment_requests_') ||
    key.startsWith('payment_request_managers_') ||
    key.startsWith('invoice_apply_requests_') ||
    key === 'registeredUsers'
  );
};
