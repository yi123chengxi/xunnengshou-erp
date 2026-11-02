/**
 * 一次性邀约链接登记簿（全局同步键 cooperation_invites）：
 * - 供应商在客户列表对某个客户生成邀约链接时登记邀约码（code）与客户行标识；
 * - 链接载荷在既有自包含 token 基础上附加 code/customerId/customerName 字段；
 * - 采购商同意或拒绝合作后即标记 usedAt/usedBy，链接自动失效（只能使用一次）；
 * - 登记簿为全局同步键（serverSync SYNC_EXACT），跨浏览器/跨账号送达：
 *   写入经 safeSetItem 的 setItem 钩子自动调度上传，标记使用时再 flush 立即推送。
 */
import dayjs from 'dayjs';
import { safeSetItem } from './storageQuota';
import { flushDatasetUpload } from './serverSync';
import { buildInviteLink } from './cooperationInvite';
import type { CooperationInvitePayload } from './cooperationInvite';

export const INVITE_REGISTRY_KEY = 'cooperation_invites';

export interface InviteRecord {
  code: string;
  supplierUsername: string;
  customerId: string;
  customerName: string;
  createdAt: string;
  usedAt: string;
  usedBy: string;
  usedByCompany: string;
  usedResult: 'approved' | 'rejected' | '';
}

/** 客户级邀约链接载荷：既有字段 + 一次性邀约码 + 客户行标识 */
export interface CustomerInvitePayload extends CooperationInvitePayload {
  code: string;
  customerId: string;
  customerName: string;
}

export const loadInviteRegistry = (): InviteRecord[] => {
  try {
    const l = JSON.parse(localStorage.getItem(INVITE_REGISTRY_KEY) || '[]');
    return Array.isArray(l) ? l : [];
  } catch { return []; }
};

const saveInviteRegistry = (list: InviteRecord[]): void => {
  // safeSetItem 经 setItem 钩子自动调度服务器同步上传（全局键跨账号送达）
  safeSetItem(INVITE_REGISTRY_KEY, JSON.stringify(list));
};

export const findInviteRecord = (code: string): InviteRecord | null =>
  (code ? loadInviteRegistry().find(r => r.code === code) || null : null);

export const findUnusedInviteForCustomer = (supplierUsername: string, customerId: string): InviteRecord | null =>
  loadInviteRegistry().find(r => r.supplierUsername === supplierUsername && r.customerId === customerId && !r.usedAt) || null;

export const createInviteRecord = (supplierUsername: string, customerId: string, customerName: string): InviteRecord => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwx2356789';
  const gen = () => {
    let s = '';
    for (let i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  };
  const used = new Set(loadInviteRegistry().map(r => r.code));
  let code = gen();
  while (used.has(code)) code = gen();
  const rec: InviteRecord = {
    code, supplierUsername, customerId, customerName,
    createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    usedAt: '', usedBy: '', usedByCompany: '', usedResult: '',
  };
  saveInviteRegistry([rec, ...loadInviteRegistry()]);
  return rec;
};

/** 标记邀约码已使用（同意/拒绝均消耗一次性链接），并立即上传登记簿使其他浏览器即时失效 */
export const markInviteUsed = (code: string, byUsername: string, byCompany: string, result: 'approved' | 'rejected'): void => {
  if (!code) return;
  const list = loadInviteRegistry();
  const idx = list.findIndex(r => r.code === code);
  if (idx < 0 || list[idx].usedAt) return;
  list[idx] = { ...list[idx], usedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'), usedBy: byUsername, usedByCompany: byCompany, usedResult: result };
  saveInviteRegistry(list);
  try { flushDatasetUpload(INVITE_REGISTRY_KEY, JSON.stringify(list)); } catch { /* ignore */ }
};

/** 生成客户级一次性邀约链接（复用既有自包含 token 编码，附加 code/客户标识字段） */
export const buildCustomerInviteLink = (p: CustomerInvitePayload): string =>
  buildInviteLink({ ...p } as CooperationInvitePayload);

// ============ 受理消耗监听（事件驱动，不依赖受理页代码） ============
const ACTIVE_INVITE_CODE_KEY = 'active_invite_code';
const ACTIVE_INVITE_AT_KEY = 'active_invite_at';

/** 落地页打开邀约链接时记住当前邀约码（会话级），供受理完成事件消耗 */
export const rememberActiveInviteCode = (code?: string): void => {
  try {
    if (code) {
      sessionStorage.setItem(ACTIVE_INVITE_CODE_KEY, code);
      sessionStorage.setItem(ACTIVE_INVITE_AT_KEY, String(Date.now()));
    }
  } catch { /* ignore */ }
};

let consumeWatcherStarted = false;

/**
 * 受理消耗监听：同意/拒绝合作完成时（cooperation-applications-changed 事件），
 * 用会话内记住的邀约码匹配最新一条 COOP-INV 申请记录（采购商=当前账号、供应商=邀约供应商、
 * 申请时间不早于链接打开时刻），命中即消耗邀约码使链接失效。
 */
export const startInviteConsumeWatcher = (): void => {
  if (consumeWatcherStarted) return;
  consumeWatcherStarted = true;
  const onCoopChange = () => {
    try {
      const code = sessionStorage.getItem(ACTIVE_INVITE_CODE_KEY) || '';
      if (!code) return;
      const rec = findInviteRecord(code);
      if (!rec || rec.usedAt) return;
      const me = localStorage.getItem('isSubAccount') === 'true'
        ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '')
        : (localStorage.getItem('username') || '');
      if (!me || me === rec.supplierUsername) return;
      const apps: any[] = JSON.parse(localStorage.getItem('cooperation_applications') || '[]');
      const mine = apps.filter((a: any) =>
        (a.type || 'cooperation') === 'cooperation' &&
        String(a.applicationId || '').indexOf('COOP-INV') === 0 &&
        a.purchaserUsername === me && a.supplierUsername === rec.supplierUsername);
      if (!mine.length) return;
      const latest = mine.sort((a: any, b: any) => String(b.applyDate || '').localeCompare(String(a.applyDate || '')))[0];
      const openedAt = Number(sessionStorage.getItem(ACTIVE_INVITE_AT_KEY) || 0);
      const appTs = Date.parse(String(latest.applyDate || '').replace(/-/g, '/')) || 0;
      if (!openedAt || appTs < openedAt - 5000) return; // 历史申请不误消耗
      markInviteUsed(code, me, latest.purchaserCompanyName || me, latest.status === 'approved' ? 'approved' : 'rejected');
      sessionStorage.removeItem(ACTIVE_INVITE_CODE_KEY);
      sessionStorage.removeItem(ACTIVE_INVITE_AT_KEY);
    } catch { /* ignore */ }
  };
  window.addEventListener('cooperation-applications-changed', onCoopChange);
};
