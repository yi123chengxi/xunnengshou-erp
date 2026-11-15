/**
 * 会话身份自愈回归（主账号「突然所有权限都没了」事故护栏）。
 *
 * 事故形态：一份陈旧本地注册表把主账号行改写成 isSubAccount=true、parentAccount 指向
 * 不存在的历史幽灵账号（如 'admin'）。主账号登录后 resolvePerm 走子账号角色层（roles 空），
 * 供应商菜单全部被拒 → 菜单塌缩。
 * 契约：
 *  1) 被标为 sub 但父账号悬空、且被其他行当作父账号引用的行 = 污染行，reconcileSessionIdentity
 *     必须就地恢复为主账号并回写注册表；
 *  2) 登录时写入的 localStorage isSubAccount/parentAccount 快照必须与注册表行对齐，
 *     否则行修好了菜单仍塌缩；
 *  3) 身份一致时不得产生任何写入（避免无谓的上传/事件风暴）。
 */
import { reconcileSessionIdentity } from '../serverSync';

const setRegistry = (rows: any[]) => localStorage.setItem('registeredUsers', JSON.stringify(rows));
const registry = (): any[] => JSON.parse(localStorage.getItem('registeredUsers') || '[]');

describe('会话身份自愈', () => {
  beforeEach(() => { localStorage.clear(); });

  it('污染行（sub+悬空父+被引用）就地恢复为主账号，会话同步对齐', () => {
    localStorage.setItem('username', 'yichengxi60');
    localStorage.setItem('isSubAccount', 'true');
    localStorage.setItem('parentAccount', 'admin');
    setRegistry([
      { username: 'yichengxi60', isSubAccount: true, parentAccount: 'admin' },
      { username: 'liuxiaojin123', isSubAccount: true, parentAccount: 'yichengxi60', roles: ['销售管理'] },
    ]);

    expect(reconcileSessionIdentity()).toBe(true);

    const main = registry().find(u => u.username === 'yichengxi60');
    expect(main.isSubAccount).toBe(false);
    expect(main.parentAccount).toBe('');
    expect(localStorage.getItem('isSubAccount')).toBe('false');
    expect(localStorage.getItem('parentAccount')).toBe('');
    // 子账号行不受影响
    expect(registry().find(u => u.username === 'liuxiaojin123').parentAccount).toBe('yichengxi60');
  });

  it('行已修复但会话仍是旧快照（sub）→ 对齐为主账号', () => {
    localStorage.setItem('username', 'yichengxi60');
    localStorage.setItem('isSubAccount', 'true');
    localStorage.setItem('parentAccount', 'admin');
    setRegistry([
      { username: 'yichengxi60' },
      { username: 'sub1', isSubAccount: true, parentAccount: 'yichengxi60' },
    ]);

    expect(reconcileSessionIdentity()).toBe(true);
    expect(localStorage.getItem('isSubAccount')).toBe('false');
    expect(localStorage.getItem('parentAccount')).toBe('');
  });

  it('正常子账号会话：行与快照一致时不产生写入', () => {
    localStorage.setItem('username', 'sub1');
    localStorage.setItem('isSubAccount', 'true');
    localStorage.setItem('parentAccount', 'yichengxi60');
    const before = localStorage.getItem('registeredUsers');
    setRegistry([
      { username: 'yichengxi60' },
      { username: 'sub1', isSubAccount: true, parentAccount: 'yichengxi60' },
    ]);
    const snapshot = localStorage.getItem('registeredUsers');
    expect(snapshot).not.toBe(before); // 前置数据已写入

    expect(reconcileSessionIdentity()).toBe(false);
    expect(localStorage.getItem('registeredUsers')).toBe(snapshot);
    expect(localStorage.getItem('isSubAccount')).toBe('true');
  });

  it('父账号存在的 sub 行不被误判为污染（不被恢复成主账号）', () => {
    localStorage.setItem('username', 'mid1');
    localStorage.setItem('isSubAccount', 'true');
    localStorage.setItem('parentAccount', 'yichengxi60');
    setRegistry([
      { username: 'yichengxi60' },
      { username: 'mid1', isSubAccount: true, parentAccount: 'yichengxi60' },
      { username: 'sub1', isSubAccount: true, parentAccount: 'mid1' },
    ]);

    expect(reconcileSessionIdentity()).toBe(false);
    expect(registry().find(u => u.username === 'mid1').isSubAccount).toBe(true);
  });

  it('未登录时直接返回 false，不触碰存储', () => {
    setRegistry([{ username: 'yichengxi60', isSubAccount: true, parentAccount: 'admin' }]);
    expect(reconcileSessionIdentity()).toBe(false);
    expect(registry().find(u => u.username === 'yichengxi60').isSubAccount).toBe(true);
  });
});
