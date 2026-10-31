import { modules as MAIN_MODULES } from '../layouts/MainLayout';
import { PERM_V2, PERM_V3, PERM_V4, PERM_V5, PERM_V6, PERM_V7, PERM_V8, PERM_V9, PERM_V10, PERM_V11, PERM_V12, PERM_V13, PERM_V14, PURCHASER_PERM_MENUS, FACTORY_PERM_MENUS, buildPlatformPermNodes } from './devPerms';
import { safeSetItem } from './storageQuota';
import { loadTenantUsers, tenantUserDisplayName } from './tenantUsers';

// ===================== 开发者后台共享存储与权限工具 =====================

// 开发者身份（主开发者 dev / 开发者子账号）
export interface DevIdentity {
  user: string;      // 登录账号（dev 或子账号用户名）
  name: string;      // 显示名称
  parent: string;    // 归属主开发者（主开发者为 dev）
  isSub: boolean;
}

export const getDevIdentity = (): DevIdentity => {
  const user = localStorage.getItem('devUser') || 'dev';
  return {
    user,
    name: localStorage.getItem('devUserName') || user,
    parent: localStorage.getItem('devParent') || 'dev',
    isSub: localStorage.getItem('devIsSub') === 'true',
  };
};

// 开发者子账号（全局存储，供开发者平台业务员登录使用）
export interface DevSubAccount {
  key: string;
  username: string;
  password: string;
  displayName: string;
  status: 'normal' | 'disabled';
  createdAt: string;
  parentDev: string;
  roleId?: string; // 角色权限（dev_roles）
}

export const loadDevSubAccounts = (): DevSubAccount[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_sub_accounts') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const saveDevSubAccounts = (list: DevSubAccount[]) => {
  localStorage.setItem('dev_sub_accounts', JSON.stringify(list));
};

// ===================== 客户分组 =====================
export interface DevGroup {
  id: string;
  name: string;
  members: string[]; // 客户 username 列表
}

export const loadGroups = (devMain: string): DevGroup[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`dev_groups_${devMain}`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const saveGroups = (devMain: string, list: DevGroup[]) => {
  localStorage.setItem(`dev_groups_${devMain}`, JSON.stringify(list));
};

// ===================== 软件菜单权限 =====================
// 权限键格式与 MainLayout 子账号权限一致：`${moduleKey}/${childKey}`（三级为 `${moduleKey}/${grandKey}`）
export interface PermNode { key: string; label: string; children?: PermNode[]; }

// 从主平台菜单构建权限树（模块 → 菜单 → 三级菜单），并追加采购商/加工厂平台控制
export const buildPermTree = (): PermNode[] => [
  ...MAIN_MODULES.map((mod: any) => ({
    key: mod.key,
    label: mod.label,
    children: (mod.children || []).map((c: any) => (c.children && c.children.length)
      ? { key: `${mod.key}/${c.key}`, label: c.label, children: c.children.map((g: any) => ({ key: `${mod.key}/${g.key}`, label: g.label })) }
      : { key: `${mod.key}/${c.key}`, label: c.label }),
  })),
  { key: 'purchaser', label: '采购商平台', children: buildPlatformPermNodes('purchaser', PURCHASER_PERM_MENUS) as PermNode[] },
  { key: 'factory', label: '加工厂平台', children: buildPlatformPermNodes('factory', FACTORY_PERM_MENUS) as PermNode[] },
];

// 全部叶子权限键
export const allPermKeys = (): string[] => {
  const out: string[] = [];
  buildPermTree().forEach(mod => (mod.children || []).forEach(c => {
    if (c.children && c.children.length) c.children.forEach(g => out.push(g.key));
    else out.push(c.key);
  }));
  return out;
};

// 客户软件权限（未设置视为全部允许）
export const loadCustomerPerms = (customerUsername: string): string[] | null => {
  try {
    const raw = localStorage.getItem(`dev_customer_perms_${customerUsername}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k: string) => k !== PERM_V2 && k !== PERM_V3 && k !== PERM_V4 && k !== PERM_V5 && k !== PERM_V6 && k !== PERM_V7 && k !== PERM_V8 && k !== PERM_V9 && k !== PERM_V10 && k !== PERM_V11 && k !== PERM_V12 && k !== PERM_V13 && k !== PERM_V14) : null;
  } catch { return null; }
};

export const saveCustomerPerms = (customerUsername: string, keys: string[]) => {
  let next = keys.includes(PERM_V2) ? keys : [...keys, PERM_V2];
  next = next.includes(PERM_V3) ? next : [...next, PERM_V3];
  next = next.includes(PERM_V4) ? next : [...next, PERM_V4];
  next = next.includes(PERM_V5) ? next : [...next, PERM_V5];
  next = next.includes(PERM_V6) ? next : [...next, PERM_V6];
  next = next.includes(PERM_V7) ? next : [...next, PERM_V7];
  next = next.includes(PERM_V8) ? next : [...next, PERM_V8];
  next = next.includes(PERM_V9) ? next : [...next, PERM_V9];
  next = next.includes(PERM_V10) ? next : [...next, PERM_V10];
  next = next.includes(PERM_V11) ? next : [...next, PERM_V11];
  next = next.includes(PERM_V12) ? next : [...next, PERM_V12];
  next = next.includes(PERM_V13) ? next : [...next, PERM_V13];
  next = next.includes(PERM_V14) ? next : [...next, PERM_V14];
  localStorage.setItem(`dev_customer_perms_${customerUsername}`, JSON.stringify(next));
  // 通知已打开的客户软件页面实时刷新菜单权限
  window.dispatchEvent(new Event('dev-perms-changed'));
};

export const clearCustomerPerms = (customerUsername: string) => {
  localStorage.removeItem(`dev_customer_perms_${customerUsername}`);
};

// 分组权限模板
export const loadGroupPerms = (groupId: string): string[] | null => {
  try {
    const raw = localStorage.getItem(`dev_group_perms_${groupId}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
};

export const saveGroupPerms = (groupId: string, keys: string[]) => {
  let next = keys.includes(PERM_V2) ? keys : [...keys, PERM_V2];
  next = next.includes(PERM_V3) ? next : [...next, PERM_V3];
  next = next.includes(PERM_V4) ? next : [...next, PERM_V4];
  next = next.includes(PERM_V5) ? next : [...next, PERM_V5];
  next = next.includes(PERM_V6) ? next : [...next, PERM_V6];
  next = next.includes(PERM_V7) ? next : [...next, PERM_V7];
  next = next.includes(PERM_V8) ? next : [...next, PERM_V8];
  next = next.includes(PERM_V9) ? next : [...next, PERM_V9];
  next = next.includes(PERM_V10) ? next : [...next, PERM_V10];
  next = next.includes(PERM_V11) ? next : [...next, PERM_V11];
  next = next.includes(PERM_V12) ? next : [...next, PERM_V12];
  next = next.includes(PERM_V13) ? next : [...next, PERM_V13];
  next = next.includes(PERM_V14) ? next : [...next, PERM_V14];
  localStorage.setItem(`dev_group_perms_${groupId}`, JSON.stringify(next));
  window.dispatchEvent(new Event('dev-perms-changed'));
};

// 修改分组权限 → 组内所有客户权限默认同步
export const applyGroupPermsToMembers = (group: DevGroup, keys: string[]) => {
  (group.members || []).forEach(m => saveCustomerPerms(m, keys));
};

// ===================== 客户领取（负责人） =====================
export interface ClaimInfo { devOwner?: string; devOwnerName?: string; devClaimDate?: string; }

export const updateRegisteredUsers = (fn: (users: any[]) => any[]): boolean => {
  let users: any[] = [];
  try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
  const next = fn(users);
  // 安全写入：配额溢出时自动紧急清理重试；仍失败则返回 false 由调用方提示，避免静默丢写
  return safeSetItem('registeredUsers', JSON.stringify(next));
};

// ===================== 角色权限（参考 my-crm settings/roles） =====================
export interface DevPermItem { key: string; label: string; }
export interface DevPermGroup { group: string; label: string; items: DevPermItem[]; }

// 开发者后台功能权限分组（与 my-crm PERMISSION_GROUPS 同构）
export const DEV_PERMISSION_GROUPS: DevPermGroup[] = [
  {
    group: 'customers',
    label: '客户管理',
    items: [
      { key: 'customers.mine', label: '我的客户' },
      { key: 'customers.all', label: '全部客户' },
      { key: 'customers.orders', label: '订单管理' },
      { key: 'customers.pool', label: '客户公海' },
      { key: 'customers.stats', label: '数据统计' },
      { key: 'customers.claim', label: '领取客户' },
      { key: 'customers.group', label: '客户分组' },
      { key: 'customers.perm', label: '权限设置' },
    ],
  },
  {
    group: 'analytics',
    label: '业绩分析',
    items: [
      { key: 'analytics.payment', label: '客户付款' },
      { key: 'analytics.group-stats', label: '分组统计' },
      { key: 'analytics.action-points', label: '动作积分' },
      { key: 'analytics.points-stats', label: '积分兑换' },
      { key: 'analytics.performance', label: '绩效考核' },
    ],
  },
  {
    group: 'settings',
    label: '系统设置',
    items: [
      { key: 'settings.accounts', label: '账号管理' },
      { key: 'settings.roles', label: '角色权限' },
      { key: 'settings.points', label: '积分兑换奖品' },
    ],
  },
];

export const ALL_DEV_PERMISSION_KEYS = DEV_PERMISSION_GROUPS.flatMap(g => g.items.map(i => i.key));

export interface DevTeamRel { leader: string; members: string[]; }
export interface DevRole {
  id: string;
  name: string;
  description?: string;
  dataScope: 'ALL' | 'OWN' | 'TEAM'; // 全部数据 / 仅本人 / 组员数据（组长）
  permissions: string[];
  teamRels: DevTeamRel[];
}

export const loadDevRoles = (): DevRole[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_roles') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const saveDevRoles = (list: DevRole[]) => {
  localStorage.setItem('dev_roles', JSON.stringify(list));
};

// 子账号的角色与数据范围
export const getSubRole = (username: string): DevRole | null => {
  const sub = loadDevSubAccounts().find(s => s.username === username);
  if (!sub || !sub.roleId) return null;
  return loadDevRoles().find(r => r.id === sub.roleId) || null;
};

// ===================== 积分兑换奖品（参考 my-crm settings/points-rewards） =====================
export interface DevReward {
  id: string;
  name: string;
  description?: string;
  imageKey?: string; // IndexedDB dev_reward_images 中的 key
  pointsCost: number;
  stock: number; // -1 不限
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface DevRedeem {
  id: string;
  rewardId: string;
  rewardName: string;
  username: string;
  displayName: string;
  points: number;
  status: '待审批' | '已兑换' | '已拒绝';
  createdAt: string;
  handledBy?: string;
}

export const loadDevRewards = (): DevReward[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_rewards') || '[]');
    return (Array.isArray(list) ? list : []).sort((a: DevReward, b: DevReward) => a.sortOrder - b.sortOrder);
  } catch { return []; }
};

export const saveDevRewards = (list: DevReward[]) => {
  localStorage.setItem('dev_rewards', JSON.stringify(list));
};

export const loadDevRedeems = (): DevRedeem[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_redeems') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const saveDevRedeems = (list: DevRedeem[]) => {
  localStorage.setItem('dev_redeems', JSON.stringify(list));
};

// 动作积分规则：领取客户 +5（本月新领额外 +5），客户审核通过 +10
export const calcDevPoints = (username: string): { earned: number; detail: string } => {
  let users: any[] = [];
  try { users = JSON.parse(localStorage.getItem('registeredUsers') || '[]'); } catch { /* ignore */ }
  const mine = users.filter(u => !u.isSubAccount && u.devOwner === username);
  const month = new Date().toISOString().slice(0, 7);
  const claimed = mine.length;
  const newThisMonth = mine.filter(u => (u.devClaimDate || '').startsWith(month)).length;
  const approved = mine.filter(u => u.status === '已审核').length;
  const earned = claimed * 5 + newThisMonth * 5 + approved * 10;
  return { earned, detail: `领取 ${claimed}×5 + 本月新领 ${newThisMonth}×5 + 审核通过 ${approved}×10` };
};

// 可用积分 = 获得 - 已兑换 - 待审批冻结
export const calcDevBalance = (username: string): { earned: number; spent: number; pending: number; available: number; detail: string } => {
  const { earned, detail } = calcDevPoints(username);
  const redeems = loadDevRedeems().filter(r => r.username === username);
  const spent = redeems.filter(r => r.status === '已兑换').reduce((s, r) => s + r.points, 0);
  const pending = redeems.filter(r => r.status === '待审批').reduce((s, r) => s + r.points, 0);
  return { earned, spent, pending, available: earned - spent - pending, detail };
};

// ===================== 业绩分析数据层（参考 my-crm analytics/*） =====================
// 付款订单登记（客户付款/分组统计/绩效考核的数据源）
export interface DevCrmOrder {
  id: string;
  ownerName: string; // 付款时负责人（业绩归属人）
  shopName: string;
  customerName: string;
  totalAmount: number;
  refundAmount: number;
  freight: number;
  purchaseQty: number;
  grossProfit: number;
  paidAt: string; // YYYY-MM-DD
}

export const loadDevOrders = (): DevCrmOrder[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_crm_orders') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const saveDevOrders = (list: DevCrmOrder[]) => {
  localStorage.setItem('dev_crm_orders', JSON.stringify(list));
};

// 动作积分配置（分类 → 积分项）
export interface DevActionPointItem { id: string; image: string | null; name: string; points: number; probability: number; triggerStage: number; }
export interface DevActionCategory { key: string; title: string; countWindow: '1day' | '1week' | '1month'; items: DevActionPointItem[]; }

export const DEFAULT_ACTION_CATEGORIES: DevActionCategory[] = [
  { key: 'transfer-customer', title: '客户转给他人', countWindow: '1day', items: [{ id: '1', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
  { key: 'write-followup', title: '写跟进', countWindow: '1day', items: [{ id: '2', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
  { key: 'claim-public', title: '公海领取', countWindow: '1day', items: [{ id: '3', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
  { key: 'create-custom-order', title: '创建定制单', countWindow: '1day', items: [{ id: '4', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
  { key: 'create-order', title: '创建订单', countWindow: '1day', items: [{ id: '5', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
  { key: 'new-customer', title: '新建客户', countWindow: '1day', items: [{ id: '6', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
  { key: 'new-opportunity', title: '新建商机', countWindow: '1week', items: [{ id: '7', image: null, name: '老板亲自点赞', points: 1, probability: 20, triggerStage: 1 }] },
];

export const loadActionConfig = (): DevActionCategory[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_action_config') || '[]');
    return Array.isArray(list) && list.length ? list : DEFAULT_ACTION_CATEGORIES;
  } catch { return DEFAULT_ACTION_CATEGORIES; }
};

export const saveActionConfig = (list: DevActionCategory[]) => {
  localStorage.setItem('dev_action_config', JSON.stringify(list));
};

// 动作积分记录
export interface DevPointRecord {
  id: string;
  staffName: string;
  actionType: string;
  actionTitle: string;
  points: number;
  reason?: string;
  orderNo?: string;
  buyerName?: string;
  feedbackImage?: string | null;
  triggerStage?: number;
  createdAt: string; // YYYY-MM-DD 或 ISO
}

export const loadPointRecords = (): DevPointRecord[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_action_records') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const savePointRecords = (list: DevPointRecord[]) => {
  localStorage.setItem('dev_action_records', JSON.stringify(list));
};

// 冠军头衔（分组统计冠军榜）
export interface DevChampionTitle { id: string; metricKey: string; name: string; icon: string | null; isActive: boolean; sortOrder: number; }

export const loadChampionTitles = (): DevChampionTitle[] => {
  try {
    const list = JSON.parse(localStorage.getItem('dev_champion_titles') || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

export const saveChampionTitles = (list: DevChampionTitle[]) => {
  localStorage.setItem('dev_champion_titles', JSON.stringify(list));
};

// 业务员名单（子账号）
export const loadDevStaffList = (): { id: string; name: string }[] =>
  loadDevSubAccounts().filter(s => s.status === 'normal').map(s => ({ id: s.username, name: s.displayName }));

// ===================== 客户跟进记录与客户日志 =====================
export interface DevFollowup {
  key: string;
  content: string;
  author: string;       // 写跟进人账号
  authorName: string;   // 写跟进人姓名
  createdAt: string;    // ISO 时间
}
export interface DevCustomerLog {
  key: string;
  action: string;       // 动作（编辑客户资料/领取客户/释放回公海/分配负责人）
  detail: string;       // 变更明细或备注
  operator: string;
  operatorName: string;
  createdAt: string;
}

export const loadFollowups = (username: string): DevFollowup[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`dev_followups_${username}`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};
export const addFollowup = (username: string, content: string, operator: string, operatorName: string): DevFollowup => {
  const list = loadFollowups(username);
  const rec: DevFollowup = {
    key: `fu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content, author: operator, authorName: operatorName, createdAt: new Date().toISOString(),
  };
  list.push(rec);
  localStorage.setItem(`dev_followups_${username}`, JSON.stringify(list));
  return rec;
};

export const loadCustomerLogs = (username: string): DevCustomerLog[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`dev_customer_log_${username}`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};
export const addCustomerLog = (username: string, action: string, detail: string, operator: string, operatorName: string): void => {
  const list = loadCustomerLogs(username);
  list.push({
    key: `lg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action, detail, operator, operatorName, createdAt: new Date().toISOString(),
  });
  localStorage.setItem(`dev_customer_log_${username}`, JSON.stringify(list));
};

// ===================== 平台感知存储（供应商/采购商独立数据库） =====================
export type AnalyticsPlatform = 'dev' | 'supplier' | 'purchaser';

/** 获取平台存储前缀（dev 保持兼容，supplier/purchaser 带 owner 后缀实现数据隔离） */
export const getPfx = (platform: AnalyticsPlatform): string => {
  if (platform === 'dev') return 'dev_';
  const owner = (() => {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (!isSub) return localStorage.getItem('username') || '';
    return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  })();
  return `${platform}_analytics_${owner}_`;
};

/** 平台感知：加载 CRM 订单 */
export const loadPlatformOrders = (platform: AnalyticsPlatform): DevCrmOrder[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`${getPfx(platform)}crm_orders`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 平台感知：保存 CRM 订单 */
export const savePlatformOrders = (platform: AnalyticsPlatform, list: DevCrmOrder[]) => {
  localStorage.setItem(`${getPfx(platform)}crm_orders`, JSON.stringify(list));
};

/** 平台感知：业务员名单（dev=子账号，supplier/purchaser=租户成员） */
export const loadPlatformStaffList = (platform: AnalyticsPlatform): { id: string; name: string }[] => {
  if (platform === 'dev') return loadDevStaffList();
  // supplier/purchaser 使用租户成员
  return (loadTenantUsers() as any[]).map((u: any) => ({ id: u.username, name: tenantUserDisplayName(u) }));
};

/** 平台感知：加载动作积分配置 */
export const loadPlatformActionConfig = (platform: AnalyticsPlatform): DevActionCategory[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`${getPfx(platform)}action_config`) || '[]');
    return Array.isArray(list) && list.length ? list : DEFAULT_ACTION_CATEGORIES;
  } catch { return DEFAULT_ACTION_CATEGORIES; }
};

/** 平台感知：保存动作积分配置 */
export const savePlatformActionConfig = (platform: AnalyticsPlatform, list: DevActionCategory[]) => {
  localStorage.setItem(`${getPfx(platform)}action_config`, JSON.stringify(list));
};

/** 平台感知：加载积分记录 */
export const loadPlatformPointRecords = (platform: AnalyticsPlatform): DevPointRecord[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`${getPfx(platform)}action_records`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 平台感知：保存积分记录 */
export const savePlatformPointRecords = (platform: AnalyticsPlatform, list: DevPointRecord[]) => {
  localStorage.setItem(`${getPfx(platform)}action_records`, JSON.stringify(list));
};

/** 平台感知：加载冠军头衔 */
export const loadPlatformChampionTitles = (platform: AnalyticsPlatform): DevChampionTitle[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`${getPfx(platform)}champion_titles`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 平台感知：保存冠军头衔 */
export const savePlatformChampionTitles = (platform: AnalyticsPlatform, list: DevChampionTitle[]) => {
  localStorage.setItem(`${getPfx(platform)}champion_titles`, JSON.stringify(list));
};

/** 平台感知：加载积分奖品 */
export const loadPlatformRewards = (platform: AnalyticsPlatform): DevReward[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`${getPfx(platform)}rewards`) || '[]');
    return (Array.isArray(list) ? list : []).sort((a: DevReward, b: DevReward) => a.sortOrder - b.sortOrder);
  } catch { return []; }
};

/** 平台感知：保存积分奖品 */
export const savePlatformRewards = (platform: AnalyticsPlatform, list: DevReward[]) => {
  localStorage.setItem(`${getPfx(platform)}rewards`, JSON.stringify(list));
};

/** 平台感知：加载兑换记录 */
export const loadPlatformRedeems = (platform: AnalyticsPlatform): DevRedeem[] => {
  try {
    const list = JSON.parse(localStorage.getItem(`${getPfx(platform)}redeems`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

/** 平台感知：保存兑换记录 */
export const savePlatformRedeems = (platform: AnalyticsPlatform, list: DevRedeem[]) => {
  localStorage.setItem(`${getPfx(platform)}redeems`, JSON.stringify(list));
};

/** 平台感知存储 key 解析（绩效考核等直接使用 key 的页面） */
export const platformKey = (platform: AnalyticsPlatform, suffix: string): string =>
  `${getPfx(platform)}${suffix}`;
