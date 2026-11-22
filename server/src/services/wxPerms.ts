/**
 * 小程序侧权限解析（网页版 utils/perm.ts PERM_V2 菜单点链路的服务端移植）
 * - 权限数据本身存在客户端 localStorage，但相关键（registeredUsers / roles_ / role_permsettings_ /
 *   preset_role_overrides_ / user_perm_overrides_ / dev_customer_*）都在 syncGuard 白名单里随端同步入库，
 *   因此服务端可以按同一条解析链复算，无需小程序上传任何权限信息（防伪造）。
 * - 只解析「菜单点」（形如 production/production-pending-stats）；功能点/字段点手机端用不到，不移植。
 * - 解析优先级（与网页版严格一致，不得调整顺序）：
 *   用户显式覆写 → 开发者客户层（显式禁止 / 白名单 + 版本哨兵兼容） → 主账号 bypass →
 *   分组三态 → 角色三态（deny 优先） → legacy 角色/独立权限白名单 → 新增菜单默认放行哨兵
 */
import { store } from '../database/store';
import { resolveCompanyRoot } from './storageUsage';

async function readRows(key: string): Promise<any[]> {
  try {
    const row = await store.getDataset(key);
    const parsed = row ? JSON.parse(row.dataset_json || '[]') : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function readJson(key: string): Promise<any> {
  try {
    const row = await store.getDataset(key);
    return row ? JSON.parse(row.dataset_json || 'null') : null;
  } catch {
    return null;
  }
}

/** 供应商平台菜单点（网页版 config/permRegistry.ts PERM_MENUS.supplier 的看板相关子集） */
export const SUPPLIER_MENU_KEYS = [
  'production/production-pending-stats', 'production/production-order',
  'production/processing-order', 'production/purchase-requisition',
  'production/workflow-templates', 'production/production-schedule',
  'sales/order-manage', 'finance/bank-account', 'finance/reimbursement', 'finance/payment-request',
];
const isMenuPoint = (key: string): boolean => SUPPLIER_MENU_KEYS.includes(key);

/**
 * 开发者白名单层的版本哨兵兼容（网页版 utils/devPerms.ts isPermAllowed）：
 * 白名单保存于某菜单上线之前（数组里没有该哨兵标记）时，该菜单点默认放行，
 * 否则会被历史勾选快照误杀。只保留本看板涉及的菜单点所属分组。
 */
const DEV_SENTINEL_GROUPS: { sentinel: string; keys: string[] }[] = [
  { sentinel: '__v8', keys: ['finance/bank-account', 'finance/reimbursement', 'finance/payment-request'] },
  { sentinel: '__v18', keys: ['basic-data/image-space'] },
  { sentinel: '__v19', keys: ['production/production-pending-stats'] },
];
const legacyMenuAllowed = (list: string[], key: string): boolean =>
  DEV_SENTINEL_GROUPS.some(g => g.keys.includes(key) && !list.includes(g.sentinel));

/**
 * 角色层兜底默认放行清单（网页版 perm.ts 第 3.2 步之后直接判 PERM_V18_DEFAULT_KEYS ∪ PERM_V19_DEFAULT_KEYS，
 * 不看哨兵）——注意与上面的哨兵分组不是同一集合，不得合用
 */
const ROLE_LAYER_DEFAULT_KEYS = ['basic-data/image-space', 'production/production-pending-stats'];

/** 预设角色（网页版 config/permissions.ts presetRoles）：name 为角色名（用户挂的是名字），
 *  permissions 用模块通配展开，等价于该角色 children 全量权限点 */
const PRESET_ROLES: { key: string; name: string; permissions: string[] }[] = [
  { key: 'role-all', name: '全部权限', permissions: ['*'] },
  { key: 'role-production', name: '生产管理', permissions: ['basic-data/*', 'production/*', 'inventory/*'] },
  { key: 'role-sales', name: '销售管理', permissions: ['customer/*', 'sales/*', 'dashboard/*'] },
  { key: 'role-finance', name: '财务管理', permissions: ['finance/*', 'dashboard/*'] },
  { key: 'role-purchase', name: '采购与库存', permissions: ['inventory/*', 'basic-data/*', 'production/*'] },
];

const matchAny = (list: string[], key: string): boolean =>
  list.some(p => p === '*' || p === key || (p.endsWith('/*') && key.startsWith(p.slice(0, -1))));

export interface PermSubject {
  username: string;
  /** 归属主账号（数据键后缀） */
  owner: string;
  isSub: boolean;
  /** 角色三态/自定义角色存储键基座：子账号取父账号 */
  base: string;
  roles: string[];
  customPermissions: string[];
  group: string;
}

/** 解析账号身份：子账号判定与角色基座与网页版 getRolesStorageKey 同口径 */
export async function loadPermSubject(username: string): Promise<PermSubject> {
  const [users, owner] = await Promise.all([readRows('registeredUsers'), resolveCompanyRoot(username).catch(() => username)]);
  const row: any = users.find((u: any) => u && u.username === username) || {};
  const isSub = row.isSubAccount === true || (!!owner && username !== owner);
  const base = isSub ? String(row.parentAccount || owner || username) : username;
  let group = '';
  try {
    const accs = await readJson(`accounts_${base}`);
    if (Array.isArray(accs)) group = String(accs.find((a: any) => a && a.username === username)?.group || '');
  } catch { /* ignore */ }
  return {
    username,
    owner: owner || username,
    isSub,
    base,
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
    customPermissions: Array.isArray(row.customPermissions) ? row.customPermissions.map(String) : [],
    group,
  };
}

/** 菜单点可见性判定（与网页版 resolvePerm(scope='supplier') 等价） */
export async function canViewMenu(subject: PermSubject, key: string): Promise<boolean> {
  const { username, base, isSub } = subject;
  // 1) 账号个人三态覆写（独立小键权威，回退注册表镜像字段）
  let ov: any = await readJson(`user_perm_overrides_${username}`);
  if (!ov || typeof ov !== 'object' || Array.isArray(ov)) {
    const users = await readRows('registeredUsers');
    ov = users.find((u: any) => u && u.username === username)?.permOverrides || {};
  }
  if (ov[key] === 'allow') return true;
  if (ov[key] === 'deny') return false;

  // 2) 开发者客户层：显式禁止 → 拒绝；白名单存在且未列入 → 拒绝（旧快照缺新菜单键时按哨兵放行）
  const devDeny = await readJson(`dev_customer_deny_${username}`);
  if (Array.isArray(devDeny) && devDeny.includes(key)) return false;
  const devWlRaw = await readJson(`dev_customer_perms_${username}`);
  if (Array.isArray(devWlRaw)) {
    const wl = devWlRaw.filter(k => typeof k === 'string' && !k.startsWith('PERM_V'));
    if (!wl.includes(key) && !legacyMenuAllowed(wl, key)) return false;
  }

  // 3) 主账号不受角色层限制
  if (!isSub) return true;

  const [settingsAll, customRoles, presetOverrides] = await Promise.all([
    readJson(`role_permsettings_${base}`), readJson(`roles_${base}`), readJson(`preset_role_overrides_${base}`),
  ]);
  const settings: Record<string, Record<string, string>> = settingsAll && typeof settingsAll === 'object' ? settingsAll : {};
  // 3.0) 分组三态（账号管理-分组权限配置）
  if (subject.group) {
    const gst = settings[`__group__${subject.group}`]?.[key];
    if (gst === 'deny') return false;
    if (gst === 'allow') return true;
  }
  // 3.1) 角色三态：任一 deny 即拒，否则任一 allow 即放行（预设覆盖表先套用）
  const overrideOf: Record<string, string[]> = {};
  (Array.isArray(presetOverrides) ? presetOverrides : []).forEach((o: any) => {
    if (o && o.key && Array.isArray(o.permissions)) overrideOf[o.key] = o.permissions.map(String);
  });
  const presets = PRESET_ROLES.map(p => (overrideOf[p.key] ? { ...p, permissions: overrideOf[p.key] } : p));
  const allRoles = [
    ...presets,
    ...(Array.isArray(customRoles) ? customRoles : []),
  ];
  const permsOf = (name: string): string[] => {
    const role: any = allRoles.find((r: any) => r && r.name === name);
    return role && Array.isArray(role.permissions) ? role.permissions.map(String) : [];
  };
  let roleAllow = false;
  for (const name of subject.roles) {
    const role: any = allRoles.find((r: any) => r && r.name === name);
    if (!role) continue;
    const st = settings[role.key]?.[key];
    if (st === 'deny') return false;
    if (st === 'allow') roleAllow = true;
  }
  if (roleAllow) return true;
  // 3.2) legacy 白名单：角色 permissions ∪ 独立分配权限；菜单点未列入即不可见
  const merged: string[] = [];
  subject.roles.forEach(n => merged.push(...permsOf(n)));
  merged.push(...subject.customPermissions);
  if (matchAny(merged, key)) return true;
  // 3.3) 旧角色快照早于该菜单上线时默认放行（与网页版一致：此层不看哨兵，只看键是否在新增菜单默认清单里）
  return isMenuPoint(key) && ROLE_LAYER_DEFAULT_KEYS.includes(key);
}

/** 批量判定（看板一次请求内复用同一身份，避免重复读注册表） */
export async function canViewMenus(username: string, keys: string[]): Promise<Record<string, boolean>> {
  const subject = await loadPermSubject(username);
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = await canViewMenu(subject, k);
  return out;
}
