/**
 * 供应商邀约合作链接（采购商侧受理闭环）共享模块：
 * - 链接 token 自包含（base64url JSON），仅携带公司编号、不携带公司账户，天然支持跨浏览器；
 * - 采购商打开链接后落地供应商列表页并弹窗显示邀约公司信息，点「同意合作」立即建立合作；
 * - 同意时三处回写：采购商侧供应商条目（purchaser_suppliers_，同步键）+
 *   合作申请记录（cooperation_applications，全局同步键，供应商侧凭已批准申请兜底重建绑定客户）+
 *   供应商侧已绑定采购商（boundPurchasers_，同浏览器即时回写）。
 */
import dayjs from 'dayjs';
import { appMatchesSupplierEntry, noOfUser } from './cooperationCred';

export const PENDING_INVITE_KEY = 'pending_cooperation_invite';
export const COOPERATION_APPLICATIONS_KEY = 'cooperation_applications';
const PURCHASER_SUPPLIERS_PREFIX = 'purchaser_suppliers_';

/** 邀约链接载荷：只含公司编号与绑定负责人信息，不含公司账户 */
export interface CooperationInvitePayload {
  v: 1;
  no: string;           // 供应商公司编号
  bind: 0 | 1;          // 是否绑定负责人
  salesman: string;     // 绑定负责人时的供应商账号
  salesmanName: string; // 绑定负责人的显示名称
  ts: number;
  r: string;
}

// ========== token 编解码（base64url，链接自包含）==========
export const encodeInviteToken = (p: CooperationInvitePayload): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const decodeInviteToken = (token: string): CooperationInvitePayload | null => {
  try {
    const b64 = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (!p || p.v !== 1 || !p.no) return null;
    return p as CooperationInvitePayload;
  } catch { return null; }
};

export const buildInviteLink = (p: CooperationInvitePayload): string =>
  `${window.location.origin}/purchaser-invite/${encodeInviteToken(p)}`;

// ========== 注册账号解析 ==========
export const loadRegisteredUsers = (): any[] => {
  try {
    const u = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    return Array.isArray(u) ? u : [];
  } catch { return []; }
};

/** 按公司编号解析注册账号（兼容老账号回退公司简称） */
export const resolveUserByCompanyNo = (no: string): any | null => {
  const users = loadRegisteredUsers();
  return users.find((u: any) => String(u.companyNo || '') === no || String(u.companyShortName || '') === no) || null;
};

// ========== 待受理邀约（落地页写入 → 供应商列表页弹窗读取）==========
export const savePendingInvite = (p: CooperationInvitePayload): void => {
  try { localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
};

export const takePendingInvite = (): CooperationInvitePayload | null => {
  try {
    const raw = localStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_INVITE_KEY);
    const p = JSON.parse(raw) as CooperationInvitePayload;
    return p && p.v === 1 && p.no ? p : null;
  } catch { return null; }
};

// ========== 采购商同意邀约：立即建立合作 ==========
export const acceptCooperationInvite = (p: CooperationInvitePayload, purchaserOwner: string): { ok: boolean; msg: string } => {
  const users = loadRegisteredUsers();
  const me = users.find((u: any) => u.username === purchaserOwner);
  const myCompany = me?.companyName || purchaserOwner;
  const supplierUser = resolveUserByCompanyNo(p.no);
  if (!supplierUser) return { ok: false, msg: '未找到邀约公司编号对应的供应商账号，请联系供应商核实' };
  const myNo = noOfUser(me);
  const supplierCompany = supplierUser.companyName || supplierUser.username;
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const today = dayjs().format('YYYY-MM-DD');

  // 1. 采购商侧供应商条目：公司编号/公司名命中已有条目则自动更新，否则新建
  const pKey = PURCHASER_SUPPLIERS_PREFIX + purchaserOwner;
  let list: any[] = [];
  try { list = JSON.parse(localStorage.getItem(pKey) || '[]'); } catch { /* ignore */ }
  const profile: any = {
    contactPerson: supplierUser.contactPerson || '',
    contactPhone: supplierUser.phone || '',
    email: supplierUser.email || '',
    legalPerson: supplierUser.legalPerson || '',
    province: supplierUser.province || '',
    city: supplierUser.city || '',
    district: supplierUser.district || '',
    address: supplierUser.addressDetail || supplierUser.businessAddress || '',
  };
  const idx = list.findIndex((s: any) => (String(s.supplierNo || '') === String(p.no)) || s.supplierName === supplierCompany);
  let entry: any;
  if (idx >= 0) {
    entry = {
      ...list[idx],
      ...profile,
      supplierNo: p.no,
      supplierUsername: supplierUser.username,
      cooperationStatus: 'approved',
      cooperationDate: today,
      // 刷新状态时间戳并清除终止残留，避免 reconcile/加载归一化按旧时间戳回滚为已解除
      statusTs: Date.now(),
      terminateAt: undefined,
      terminateBy: undefined,
      supplierInitiated: false,
      remark: list[idx].remark || '通过供应商邀约链接建立合作',
    };
    list[idx] = entry;
  } else {
    entry = {
      id: `SP-${Date.now()}`,
      supplierName: supplierCompany,
      shortName: '',
      ...profile,
      supplierNo: p.no,
      supplierUsername: supplierUser.username,
      cooperationStatus: 'approved',
      addedDate: now,
      cooperationDate: today,
      remark: '通过供应商邀约链接建立合作',
    };
    list.unshift(entry);
  }
  localStorage.setItem(pKey, JSON.stringify(list));

  // 2. 合作申请记录（全局同步键）：供应商侧凭已批准申请兜底重建绑定客户（含负责人）
  const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
  // 作废旧的在途合作申请（含供应商按编号发起的待确认申请），避免受理后仍残留待审核按钮
  apps.forEach((a: any) => {
    if (
      (a.type || 'cooperation') === 'cooperation' && a.status === 'pending' && !a.superseded &&
      a.purchaserUsername === purchaserOwner &&
      (a.targetSupplierName === supplierCompany || appMatchesSupplierEntry(a, entry))
    ) {
      a.superseded = true;
      a.status = 'rejected';
      a.remark = `${a.remark || ''}（采购商已通过邀约链接建立合作，本申请作废）`;
    }
  });
  const appId = `COOP-INV-${Date.now()}`;
  apps.push({
    id: appId,
    applicationId: appId,
    purchaserUsername: purchaserOwner,
    purchaserCompanyName: myCompany,
    purchaserCompanyId: me?.companyId || '',
    purchaserContact: me?.contactPerson || '',
    purchaserPhone: me?.phone || '',
    targetSupplierName: supplierCompany,
    targetSupplierNo: String(p.no || '').trim(),
    purchaserNo: myNo,
    targetSupplierId: entry.id,
    purchaserSupplierEntryId: entry.id,
    supplierUsername: supplierUser.username,
    supplierInitiated: true,
    canDirectApprove: false,
    applyDate: now,
    approveDate: now,
    status: 'approved',
    type: 'cooperation',
    salesman: p.bind === 1 ? p.salesman : '',
    salesmanName: p.bind === 1 ? p.salesmanName : '',
    remark: `采购商「${myCompany}」同意供应商「${supplierCompany}」邀约链接合作`,
  });
  localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));

  // 3. 回写供应商侧已绑定采购商（同浏览器即时生效；跨浏览器由供应商侧兜底重建）
  const boundKey = 'boundPurchasers_' + supplierUser.username;
  try {
    const bound: any[] = JSON.parse(localStorage.getItem(boundKey) || '[]');
    const bi = bound.findIndex((bp: any) => bp.purchaserName === myCompany || bp.purchaserUsername === purchaserOwner);
    if (bi >= 0) {
      bound[bi] = {
        ...bound[bi],
        status: 'approved',
        bindDate: today,
        statusTs: Date.now(),
        terminateAt: undefined,
        terminateBy: undefined,
        salesman: p.bind === 1 ? (p.salesmanName || p.salesman) : (bound[bi].salesman || ''),
      };
    } else {
      bound.unshift({
        key: `bp-${Date.now()}`,
        id: `BIND-${Date.now()}`,
        purchaserName: myCompany,
        purchaserContact: me?.contactPerson || '',
        purchaserPhone: me?.phone || '',
        bindDate: today,
        status: 'approved',
        purchaserUsername: purchaserOwner,
        salesman: p.bind === 1 ? (p.salesmanName || p.salesman) : '',
      });
    }
    localStorage.setItem(boundKey, JSON.stringify(bound));
  } catch { /* ignore */ }

  try { window.dispatchEvent(new Event('cooperation-applications-changed')); } catch { /* ignore */ }
  return { ok: true, msg: `已与「${supplierCompany}」建立合作关系` };
};

// ========== 采购商拒绝邀约：留痕供供应商侧可见 ==========
export const rejectCooperationInvite = (p: CooperationInvitePayload, purchaserOwner: string): { ok: boolean; msg: string } => {
  const users = loadRegisteredUsers();
  const me = users.find((u: any) => u.username === purchaserOwner);
  const myCompany = me?.companyName || purchaserOwner;
  const supplierUser = resolveUserByCompanyNo(p.no);
  const supplierCompany = supplierUser?.companyName || p.no;
  const myNo = noOfUser(me);
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
  const appId = `COOP-INV-${Date.now()}`;
  apps.push({
    id: appId,
    applicationId: appId,
    purchaserUsername: purchaserOwner,
    purchaserCompanyName: myCompany,
    purchaserCompanyId: me?.companyId || '',
    purchaserContact: me?.contactPerson || '',
    purchaserPhone: me?.phone || '',
    targetSupplierName: supplierCompany,
    targetSupplierNo: String(p.no || '').trim(),
    purchaserNo: myNo,
    targetSupplierId: '',
    purchaserSupplierEntryId: '',
    supplierUsername: supplierUser?.username || '',
    supplierInitiated: true,
    canDirectApprove: false,
    applyDate: now,
    status: 'rejected',
    type: 'cooperation',
    remark: `采购商「${myCompany}」拒绝供应商「${supplierCompany}」邀约链接合作`,
  });
  localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));
  try { window.dispatchEvent(new Event('cooperation-applications-changed')); } catch { /* ignore */ }
  return { ok: true, msg: `已拒绝「${supplierCompany}」的合作邀约` };
};
