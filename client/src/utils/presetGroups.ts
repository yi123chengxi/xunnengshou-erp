/**
 * 预设分组契约：账号管理的分组（部门）列表按角色管理的「预设角色」预设同名同权限分组。
 * 新增子账号窗口移除「权限角色」后，分组是子账号唯一的预设权限载体，必须与预设角色一一对应；
 * 预设分组不可改名/删除（否则下次挂载又会被补回，产生重复或语义分裂）。
 * 纯函数实现，便于脱离页面组件做回归测试。
 */
export interface GroupLike { name: string; permissions: string[] }
export interface RoleLike { key?: string; name: string; isPreset?: boolean; permissions?: string[] }

/** 存量分组中缺失的预设角色 → 补同名同权限分组（幂等：已有同名分组不动） */
export function withPresetGroups(groups: GroupLike[], roles: RoleLike[]): { groups: GroupLike[]; added: GroupLike[] } {
  const added: GroupLike[] = [];
  const have = new Set(groups.map(g => g.name));
  roles.filter(r => r.isPreset && r.name).forEach(r => {
    if (have.has(r.name)) return;
    have.add(r.name);
    added.push({ name: r.name, permissions: [...(r.permissions || [])] });
  });
  return added.length ? { groups: [...groups, ...added], added } : { groups, added };
}

/** 分组三态初值：权限清单中的菜单点 → allow（fn/field 点不补，沿继承链下坠），
 *  使分组层（role_permsettings__group__<名>）的实际生效口径与对应预设角色一致 */
export function menuAllowSeed(permissions: string[]): Record<string, 'allow'> {
  const seed: Record<string, 'allow'> = {};
  (permissions || []).forEach(k => {
    if (typeof k === 'string' && k && !k.startsWith('fn:') && !k.startsWith('field:')) seed[k] = 'allow';
  });
  return seed;
}

/** 预设分组名集合（与预设角色一一对应） */
export function presetGroupNames(roles: RoleLike[]): string[] {
  return roles.filter(r => r.isPreset && r.name).map(r => r.name);
}

/** 账号管理页菜单点（供应商/采购商/加工厂三平台）：敏感页（建号/授权），
 *  预设一律取消勾选——三态层写 deny（分组编辑器「取消勾选」语义），legacy 权限清单剔除该页 */
export const ACCOUNT_MANAGE_MENU_KEYS = [
  'settings/account-manage', 'purchaser/settings/account-manage', 'factory/settings/account-manage',
];

/** 账号管理菜单点 deny 种子：新播种预设分组时叠加，保证三平台复选框均为未勾选 */
export function accountManageDenySeed(): Record<string, 'deny'> {
  const seed: Record<string, 'deny'> = {};
  ACCOUNT_MANAGE_MENU_KEYS.forEach(k => { seed[k] = 'deny'; });
  return seed;
}

/** 预设取消账号管理勾选的纯变换（存量一次性迁移用，调用方以哨兵保证只跑一次）：
 *  ① 预设角色键与预设分组键（__group__<名>）的三态层对账号管理菜单点写 deny；
 *  ② 预设分组权限清单、预设角色覆盖清单剔除账号管理菜单点；
 *  自定义角色/分组/覆盖一律不动。changed=false 表示无需落盘。 */
export function denyAccountManageInPresets(
  roles: RoleLike[],
  settings: Record<string, Record<string, string>>,
  groups: GroupLike[],
  overrides: { key: string; permissions: string[] }[],
): {
  settings: Record<string, Record<string, string>>;
  groups: GroupLike[];
  overrides: { key: string; permissions: string[] }[];
  changed: boolean;
} {
  const presetNames = new Set(roles.filter(r => r.isPreset && r.name).map(r => String(r.name)));
  const presetKeys = new Set(roles.filter(r => r.isPreset && r.key).map(r => String(r.key)));
  let changed = false;
  const nextSettings: Record<string, Record<string, string>> = { ...settings };
  const withDeny = (cur: Record<string, string> | undefined): Record<string, string> => {
    const s = { ...(cur || {}) };
    ACCOUNT_MANAGE_MENU_KEYS.forEach(k => { if (s[k] !== 'deny') { s[k] = 'deny'; changed = true; } });
    return s;
  };
  roles.filter(r => r.isPreset).forEach(r => {
    if (r.key) nextSettings[String(r.key)] = withDeny(nextSettings[String(r.key)]);
    if (r.name) nextSettings[`__group__${r.name}`] = withDeny(nextSettings[`__group__${r.name}`]);
  });
  const strip = (perms: string[] | undefined): string[] => (perms || []).filter(p => !ACCOUNT_MANAGE_MENU_KEYS.includes(p));
  const nextGroups = groups.map(g => {
    if (!presetNames.has(g.name)) return g;
    const perms = strip(g.permissions);
    if (perms.length !== (g.permissions || []).length) { changed = true; return { ...g, permissions: perms }; }
    return g;
  });
  const nextOverrides = overrides.map(o => {
    if (!presetKeys.has(o.key)) return o;
    const perms = strip(o.permissions);
    if (perms.length !== (o.permissions || []).length) { changed = true; return { ...o, permissions: perms }; }
    return o;
  });
  return { settings: nextSettings, groups: nextGroups, overrides: nextOverrides, changed };
}
