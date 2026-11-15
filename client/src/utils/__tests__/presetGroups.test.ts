/**
 * 预设分组契约回归：分组（部门）与角色管理的预设角色一一对应。
 * 新增子账号窗口移除「权限角色」后，分组是子账号唯一的预设权限载体。
 */
import { withPresetGroups, menuAllowSeed, presetGroupNames } from '../presetGroups';

const ROLES = [
  { key: 'role-all', name: '全部权限', isPreset: true, permissions: ['product/finished-product', 'fn:product/finished-product:create'] },
  { key: 'role-production', name: '生产管理', isPreset: true, permissions: ['product/semi-finished', 'field:product/semi-finished:price:edit'] },
  { key: 'custom-x', name: '自定义角色', isPreset: false, permissions: ['product/raw-material'] },
];

describe('预设分组', () => {
  it('缺失的预设角色补同名同权限分组，自定义角色不补', () => {
    const { groups, added } = withPresetGroups([], ROLES);
    expect(added.map(g => g.name)).toEqual(['全部权限', '生产管理']);
    expect(groups).toEqual([
      { name: '全部权限', permissions: ['product/finished-product', 'fn:product/finished-product:create'] },
      { name: '生产管理', permissions: ['product/semi-finished', 'field:product/semi-finished:price:edit'] },
    ]);
  });

  it('幂等：已有同名分组不重复补，也不覆盖其已编辑的权限', () => {
    const existing = [{ name: '生产管理', permissions: ['only/mine'] }];
    const first = withPresetGroups(existing, ROLES);
    expect(first.added.map(g => g.name)).toEqual(['全部权限']);
    const second = withPresetGroups(first.groups, ROLES);
    expect(second.added).toEqual([]);
    expect(second.groups.find(g => g.name === '生产管理')!.permissions).toEqual(['only/mine']);
  });

  it('三态初值只补菜单点为 allow，fn/field 点沿继承链', () => {
    expect(menuAllowSeed(['product/finished-product', 'fn:product/finished-product:create', 'field:x:y:edit']))
      .toEqual({ 'product/finished-product': 'allow' });
  });

  it('预设分组名只含预设角色', () => {
    expect(presetGroupNames(ROLES)).toEqual(['全部权限', '生产管理']);
  });
});
