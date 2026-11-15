/**
 * 删除墓碑剪枝回归护栏：锁定「账号管理里删除的账号必须从本地注册表消失」这条契约。
 * 历史缺陷：注册表拉取是只增不改的行级合并，已删账号行永远无法经 pull 从本地消失，
 * 陈旧副本一经上传又把它 union 回服务端——表现为删除后负责人设置下拉仍能看到该账号。
 * 修复后：服务端记墓碑 sys_deleted_users={username:删除时刻}，pruneTombstonedUsers
 * 拉取墓碑并剪掉本地命中且 _createTs 不晚于删除时刻的行；同名重建（_createTs 更晚）放行。
 */
import { pruneTombstonedUsers } from '../serverSync';

const registry = (): any[] => JSON.parse(localStorage.getItem('registeredUsers') || '[]');

let ledgerResponse: { json: string; updatedAt: number } | null = null;

beforeAll(() => {
  (global as any).fetch = async (url: string) => {
    if (String(url).includes('/health')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
    }
    if (String(url).includes('key=sys_deleted_users')) {
      if (!ledgerResponse) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as any;
      return { ok: true, status: 200, json: async () => ({ key: 'sys_deleted_users', ...ledgerResponse }) } as any;
    }
    return { ok: false, status: 404, json: async () => ({}) } as any;
  };
});

describe('删除墓碑剪枝', () => {
  beforeEach(() => {
    localStorage.clear();
    ledgerResponse = null;
  });

  it('剪掉命中墓碑且 _createTs 不晚于删除时刻的陈旧行', async () => {
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: 'main0001', isSubAccount: false },
      { username: 'yichengxi1234', isSubAccount: true, parentAccount: 'main0001', _createTs: 1000 },
    ]));
    ledgerResponse = { json: JSON.stringify({ yichengxi1234: 2000 }), updatedAt: 3000 };
    const pruned = await pruneTombstonedUsers();
    expect(pruned).toBe(1);
    expect(registry().map(u => u.username)).toEqual(['main0001']);
  });

  it('同名重建（_createTs 晚于删除时刻）放行不剪', async () => {
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: 'yichengxi1234', isSubAccount: true, parentAccount: 'main0001', _createTs: 5000 },
    ]));
    ledgerResponse = { json: JSON.stringify({ yichengxi1234: 2000 }), updatedAt: 3000 };
    const pruned = await pruneTombstonedUsers();
    expect(pruned).toBe(0);
    expect(registry().map(u => u.username)).toEqual(['yichengxi1234']);
  });

  it('服务端无墓碑（404）时不做任何写入', async () => {
    const before = JSON.stringify([
      { username: 'main0001', isSubAccount: false },
      { username: 'yichengxi1234', isSubAccount: true, parentAccount: 'main0001', _createTs: 1000 },
    ]);
    localStorage.setItem('registeredUsers', before);
    const pruned = await pruneTombstonedUsers();
    expect(pruned).toBe(0);
    expect(localStorage.getItem('registeredUsers')).toBe(before);
  });

  it('本地行未命中墓碑时保持原样（不误剪他人账号）', async () => {
    const before = JSON.stringify([
      { username: 'main0001', isSubAccount: false },
      { username: 'someone99', isSubAccount: true, parentAccount: 'main0001', _createTs: 1000 },
    ]);
    localStorage.setItem('registeredUsers', before);
    ledgerResponse = { json: JSON.stringify({ yichengxi1234: 2000 }), updatedAt: 3000 };
    const pruned = await pruneTombstonedUsers();
    expect(pruned).toBe(0);
    expect(localStorage.getItem('registeredUsers')).toBe(before);
  });
});
