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
