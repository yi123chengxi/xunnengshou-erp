/**
 * 账号个人三态覆写存储契约回归。
 *
 * 历史缺陷：覆写只存 registeredUsers 行内。该键是数百 KB 的整键 blob，
 * 配额紧张时 setItem 被配额守卫静默吞掉（不抛异常），而调用方无条件 message.success，
 * 表现为「权限改不了」；同时整键上传后要过服务端 _permTs 版本保护，跨端陈旧副本会回滚新写入。
 * 现契约：权威副本落独立小键 user_perm_overrides_<账号>，并继续镜像注册表供旧客户端读取；
 * 写入失败必须返回 false 让调用方如实报错。
 */
import {
  loadUserPermOverrides, saveUserPermOverrides, clearUserPermOverrides, userPermOverridesKey,
} from '../perm';

const U = 'qatestowner';

const setRegistry = (rows: any[]) => localStorage.setItem('registeredUsers', JSON.stringify(rows));

describe('账号个人三态覆写存储', () => {
  beforeEach(() => { localStorage.clear(); });

  it('保存后独立小键与注册表镜像同时生效，读取拿到刚写入的值', () => {
    setRegistry([{ username: U, roles: ['生产管理'], customPermissions: ['product/finished-product'] }]);
    const overrides = { 'product/finished-product': 'deny', 'fn:market/mold:create': 'allow' } as const;

    expect(saveUserPermOverrides(U, { ...overrides })).toBe(true);

    expect(JSON.parse(localStorage.getItem(userPermOverridesKey(U)) || 'null')).toEqual(overrides);
    const reg = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    expect(reg[0].permOverrides).toEqual(overrides);
    expect(Number(reg[0]._permTs) > 0).toBe(true);
    expect(loadUserPermOverrides(U)).toEqual(overrides);
  });

  it('兼容历史数据：只有注册表 permOverrides 时仍能读出（不写回，避免读操作产生写入）', () => {
    const legacy = { 'field:product/finished-product:price:view': 'deny' };
    setRegistry([{ username: U, permOverrides: legacy }]);

    expect(loadUserPermOverrides(U)).toEqual(legacy);
    expect(localStorage.getItem(userPermOverridesKey(U))).toBeNull();
  });

  it('独立小键优先于注册表镜像（防止陈旧注册表回灌旧覆写）', () => {
    setRegistry([{ username: U, permOverrides: { 'a/b': 'deny' } }]);
    localStorage.setItem(userPermOverridesKey(U), JSON.stringify({ 'a/b': 'allow' }));

    expect(loadUserPermOverrides(U)).toEqual({ 'a/b': 'allow' });
  });

  it('本地存储写不进去时返回 false，调用方据此报错而不是假报成功', () => {
    setRegistry([{ username: U }]);
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === userPermOverridesKey(U)) {
        // 模拟配额满：只记录小键写入失败，注册表镜像仍可写（旧实现正是这样被静默掩盖的）
        return;
      }
      native.call(this, k, v);
    };
    try {
      expect(saveUserPermOverrides(U, { 'a/b': 'deny' })).toBe(false);
    } finally {
      Storage.prototype.setItem = native;
    }
  });

  it('注册表里没有该账号时不再静默丢写入：独立小键仍是权威', () => {
    setRegistry([]);
    expect(saveUserPermOverrides('brandnewuser01', { 'a/b': 'allow' })).toBe(true);
    expect(loadUserPermOverrides('brandnewuser01')).toEqual({ 'a/b': 'allow' });
  });

  it('删除账号时清理独立键，避免同名新账号继承旧覆写', () => {
    setRegistry([{ username: U }]);
    saveUserPermOverrides(U, { 'a/b': 'deny' });
    clearUserPermOverrides(U);
    expect(localStorage.getItem(userPermOverridesKey(U))).toBeNull();
    expect(loadUserPermOverrides(U)).toEqual({});
  });
});
