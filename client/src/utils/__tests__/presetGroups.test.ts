/**
 * 预设分组契约回归：分组（部门）与角色管理的预设角色一一对应。
 * 新增子账号窗口移除「权限角色」后，分组是子账号唯一的预设权限载体。
 */
import { withPresetGroups, menuAllowSeed, presetGroupNames, accountManageDenySeed, denyAccountManageInPresets, ACCOUNT_MANAGE_MENU_KEYS } from '../presetGroups';

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

describe('预设取消账号管理勾选', () => {
  it('deny 种子覆盖三平台菜单点', () => {
    expect(accountManageDenySeed()).toEqual({
      'settings/account-manage': 'deny',
      'purchaser/settings/account-manage': 'deny',
      'factory/settings/account-manage': 'deny',
    });
  });

  it('预设角色/分组三态写 deny，权限清单剔除该页；自定义一律不动', () => {
    const settings = {
      'role-all': { 'settings/account-manage': 'allow', 'product/finished-product': 'allow' },
      '__group__全部权限': { 'settings/account-manage': 'allow' },
      'custom-x': { 'settings/account-manage': 'allow' },
      '__group__自定义组': { 'settings/account-manage': 'allow' },
    };
    const groups = [
      { name: '全部权限', permissions: ['settings/account-manage', 'product/finished-product'] },
      { name: '自定义组', permissions: ['settings/account-manage'] },
    ];
    const overrides = [
      { key: 'role-all', permissions: ['settings/account-manage', 'sales/order-manage'] },
      { key: 'custom-x', permissions: ['settings/account-manage'] },
    ];
    const patch = denyAccountManageInPresets(ROLES, settings, groups, overrides);
    expect(patch.changed).toBe(true);
    ACCOUNT_MANAGE_MENU_KEYS.forEach(k => {
      expect(patch.settings['role-all'][k]).toBe('deny');
      expect(patch.settings['__group__全部权限'][k]).toBe('deny');
      expect(patch.settings['__group__生产管理'][k]).toBe('deny');
    });
    expect(patch.settings['role-all']['product/finished-product']).toBe('allow');
    expect(patch.settings['custom-x']['settings/account-manage']).toBe('allow');
    expect(patch.settings['__group__自定义组']['settings/account-manage']).toBe('allow');
    expect(patch.groups[0].permissions).toEqual(['product/finished-product']);
    expect(patch.groups[1].permissions).toEqual(['settings/account-manage']);
    expect(patch.overrides[0].permissions).toEqual(['sales/order-manage']);
    expect(patch.overrides[1].permissions).toEqual(['settings/account-manage']);
  });

  it('幂等：已全部 deny/剔除后再跑 changed=false', () => {
    const first = denyAccountManageInPresets(ROLES, {}, [{ name: '全部权限', permissions: ['settings/account-manage'] }], []);
    const second = denyAccountManageInPresets(ROLES, first.settings, first.groups, first.overrides);
    expect(second.changed).toBe(false);
  });
});
