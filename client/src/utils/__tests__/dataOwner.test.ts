import {
  accountRootOf,
  readOwnerFromToken,
  getSessionOwner,
  tenantMembersOf,
  mergeStrandedTenantDataset,
} from '../dataOwner';
import { declareShrink, takeRemovedIds } from '../shrinkRegistry';

/** 造一个只用于读取声明的 JWT（不校验签名） */
const fakeToken = (payload: Record<string, any>): string => {
  const part = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${part}.sig`;
};

const USERS = [
  { username: 'boss', isSubAccount: false },
  { username: 'sub1', isSubAccount: true, parentAccount: 'boss' },
  { username: 'sub2', isSubAccount: true, parentAccount: 'sub1' },
  { username: 'other', isSubAccount: false },
];

const setSession = (username: string, extra?: { isSubAccount?: boolean; parentAccount?: string; token?: string }) => {
  localStorage.clear();
  localStorage.setItem('username', username);
  localStorage.setItem('registeredUsers', JSON.stringify(USERS));
  if (extra?.isSubAccount) localStorage.setItem('isSubAccount', 'true');
  if (extra?.parentAccount) localStorage.setItem('parentAccount', extra.parentAccount);
  if (extra?.token) localStorage.setItem('token', extra.token);
};

describe('dataOwner', () => {
  it('accountRootOf 沿 parentAccount 链追溯到主账号', () => {
    expect(accountRootOf(USERS, 'sub2')).toBe('boss');
    expect(accountRootOf(USERS, 'other')).toBe('other');
  });

  it('readOwnerFromToken 只认与当前账号一致的令牌', () => {
    const token = fakeToken({ username: 'sub1', owner: 'boss' });
    expect(readOwnerFromToken(token, 'sub1')).toBe('boss');
    expect(readOwnerFromToken(token, 'sub2')).toBe('');
  });

  it('getSessionOwner 优先用令牌 owner（子账号归主账号）', () => {
    setSession('sub1', { isSubAccount: true, token: fakeToken({ username: 'sub1', owner: 'boss' }) });
    expect(getSessionOwner()).toBe('boss');
  });

  it('parentAccount 缺失时用令牌 owner 兜底，不再退化成本人', () => {
    // 历史缺陷：新设备首次登录被当成主账号，parentAccount 为空 → 数据写进自己的桶
    setSession('sub1', { token: fakeToken({ username: 'sub1', owner: 'boss' }) });
    expect(getSessionOwner()).toBe('boss');
  });

  it('主账号仍归自己', () => {
    setSession('boss', { token: fakeToken({ username: 'boss', owner: 'boss' }) });
    expect(getSessionOwner()).toBe('boss');
  });

  it('令牌属于其他账号（切换账号后残留）时不采信', () => {
    setSession('other', { token: fakeToken({ username: 'sub1', owner: 'boss' }) });
    expect(getSessionOwner()).toBe('other');
  });

  it('刷新启动窗口：令牌无 owner 声明且注册表未拉取时，回落到 localStorage.parentAccount', () => {
    // 复现「报销数据刷新后丢失、归属校正后又自动出现」根因：
    // F5 后 serverConfirmedOwner 被重置、/auth/me 未返回、registeredUsers 未拉取，
    // 子账号若退化成本人就会读写 reimbursement_<子账号> 错桶；parentAccount 兜底可避免。
    localStorage.clear();
    localStorage.setItem('username', 'sub1');
    localStorage.setItem('isSubAccount', 'true');
    localStorage.setItem('parentAccount', 'boss');
    localStorage.setItem('token', fakeToken({ username: 'sub1' })); // 无 owner 声明
    // 故意不写 registeredUsers：accountRootOf 无法解析，只能靠 parentAccount 兜底
    expect(getSessionOwner()).toBe('boss');
  });

  it('tenantMembersOf 返回主账号名下全部成员（错桶修复遍历来源键用）', () => {
    setSession('boss', { token: fakeToken({ username: 'boss', owner: 'boss' }) });
    const members = tenantMembersOf('boss').sort();
    expect(members).toEqual(['boss', 'sub1', 'sub2']);
    expect(tenantMembersOf('other')).toEqual(['other']);
    expect(tenantMembersOf('')).toEqual([]);
  });

  it('mergeStrandedTenantDataset 把子账号独立键并回主桶并清空来源', () => {
    setSession('boss', { token: fakeToken({ username: 'boss', owner: 'boss' }) });
    localStorage.setItem('reimbursement_boss', JSON.stringify([{ key: 'a', status: 'approved' }]));
    localStorage.setItem('reimbursement_sub1', JSON.stringify([{ key: 'a', status: 'pending_review' }, { key: 'b' }]));
    localStorage.setItem('reimbursement_other', JSON.stringify([{ key: 'c' }])); // 其他企业：不许动
    const flushed: string[] = [];
    const shrunk: string[] = [];
    const ok = mergeStrandedTenantDataset('reimbursement_boss', 'reimbursement_', {
      safeSetItem: (k, v) => localStorage.setItem(k, v),
      declareShrink: (k, ids) => shrunk.push(`${k}:${ids.join(',')}`),
      flush: (k) => flushed.push(k),
    });
    expect(ok).toBe(true);
    const merged = JSON.parse(localStorage.getItem('reimbursement_boss') || '[]');
    // 主桶已有的行优先（子账号里的旧状态副本丢弃），只补主桶没有的行
    expect(merged).toEqual([{ key: 'a', status: 'approved' }, { key: 'b' }]);
    expect(JSON.parse(localStorage.getItem('reimbursement_sub1') || '"x"')).toEqual([]);
    expect(JSON.parse(localStorage.getItem('reimbursement_other') || '[]')).toEqual([{ key: 'c' }]);
    expect(shrunk[0]).toBe('reimbursement_sub1:a,b');
    expect(flushed).toContain('reimbursement_boss');
  });

  it('mergeStrandedTenantDataset 不把主桶已删除的行（墓碑）从错桶并回', () => {
    // 删除复活链路之一：用户在主桶删了 b，上传成功后申报已消费，
    // 而子账号错桶里仍持有 b 的陈旧副本，归并时不得把已删行重新塞回主桶
    setSession('boss', { token: fakeToken({ username: 'boss', owner: 'boss' }) });
    localStorage.setItem('reimbursement_boss', JSON.stringify([{ key: 'a' }]));
    localStorage.setItem('reimbursement_sub1', JSON.stringify([{ key: 'b' }]));
    declareShrink('reimbursement_boss', ['b']);
    takeRemovedIds('reimbursement_boss');
    const flushed: string[] = [];
    mergeStrandedTenantDataset('reimbursement_boss', 'reimbursement_', {
      safeSetItem: (k, v) => localStorage.setItem(k, v),
      declareShrink: () => undefined,
      flush: (k) => flushed.push(k),
    });
    expect(JSON.parse(localStorage.getItem('reimbursement_boss') || '[]')).toEqual([{ key: 'a' }]);
    expect(flushed).not.toContain('reimbursement_boss');
  });

  it('mergeStrandedTenantDataset 幂等：来源已清空后不再重复迁移', () => {
    setSession('boss', { token: fakeToken({ username: 'boss', owner: 'boss' }) });
    localStorage.setItem('reimbursement_boss', JSON.stringify([{ key: 'a' }]));
    localStorage.setItem('reimbursement_sub1', '[]');
    expect(mergeStrandedTenantDataset('reimbursement_boss', 'reimbursement_', {
      safeSetItem: () => undefined,
      declareShrink: () => undefined,
      flush: () => undefined,
    })).toBe(false);
  });

  // ===== 跨公司脏隶属守卫（两家公司订单串号的结构根因）=====

  it('accountRootOf 拒绝跨公司脏链：双方各自带不同 companyNo 时自成租户', () => {
    const users = [
      { username: 'laiku', isSubAccount: false, companyNo: 'XW27L2R1' },
      // 陈旧本地注册表把另一家公司的主账号登记成本公司子账号
      { username: 'nuolai', isSubAccount: true, parentAccount: 'laiku', companyNo: '68S09CIK' },
    ];
    expect(accountRootOf(users, 'nuolai')).toBe('nuolai');
    expect(accountRootOf(users, 'laiku')).toBe('laiku');
  });

  it('accountRootOf 兼容不带编号的历史子账号（仍归主账号桶）', () => {
    const users = [
      { username: 'laiku', isSubAccount: false, companyNo: 'XW27L2R1' },
      { username: 'chen', isSubAccount: true, parentAccount: 'laiku' },
    ];
    expect(accountRootOf(users, 'chen')).toBe('laiku');
  });

  it('tenantMembersOf 不把带不同 companyNo 的别家账号算作本企业成员', () => {
    localStorage.clear();
    localStorage.setItem('username', 'laiku');
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: 'laiku', isSubAccount: false, companyNo: 'XW27L2R1' },
      { username: 'chen', isSubAccount: true, parentAccount: 'laiku' },
      { username: 'nuolai', isSubAccount: true, parentAccount: 'laiku', companyNo: '68S09CIK' },
    ]));
    expect(tenantMembersOf('laiku').sort()).toEqual(['chen', 'laiku']);
  });

  it('脏隶属不再把别家公司桶当错桶并走并排空', () => {
    localStorage.clear();
    localStorage.setItem('username', 'laiku');
    localStorage.setItem('token', fakeToken({ username: 'laiku', owner: 'laiku' }));
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: 'laiku', isSubAccount: false, companyNo: 'XW27L2R1' },
      { username: 'nuolai', isSubAccount: true, parentAccount: 'laiku', companyNo: '68S09CIK' },
    ]));
    localStorage.setItem('pageData_sales_order-manage_laiku', JSON.stringify([{ id: 'MC000001' }]));
    localStorage.setItem('pageData_sales_order-manage_nuolai', JSON.stringify([{ id: 'MC000009' }]));
    const flushed: string[] = [];
    const shrunk: string[] = [];
    const ok = mergeStrandedTenantDataset('pageData_sales_order-manage_laiku', 'pageData_sales_order-manage_', {
      safeSetItem: (k, v) => localStorage.setItem(k, v),
      declareShrink: (k, ids) => shrunk.push(`${k}:${ids.join(',')}`),
      flush: (k) => flushed.push(k),
    });
    expect(ok).toBe(false);
    expect(shrunk).toEqual([]);
    expect(JSON.parse(localStorage.getItem('pageData_sales_order-manage_nuolai') || '[]')).toEqual([{ id: 'MC000009' }]);
    expect(JSON.parse(localStorage.getItem('pageData_sales_order-manage_laiku') || '[]')).toEqual([{ id: 'MC000001' }]);
  });

  it('getSessionOwner 自愈回写全局会话字段（旧页面读法不再命中别家桶）', () => {
    localStorage.clear();
    localStorage.setItem('username', 'chen');
    // 上一家公司登录残留的全局字段：不自愈回写时，页面级 getDataOwner 会把 chen 当主账号
    localStorage.setItem('isSubAccount', 'false');
    localStorage.setItem('parentAccount', '');
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: 'laiku', isSubAccount: false, companyNo: 'XW27L2R1' },
      { username: 'chen', isSubAccount: true, parentAccount: 'laiku' },
    ]));
    expect(getSessionOwner()).toBe('laiku');
    expect(localStorage.getItem('isSubAccount')).toBe('true');
    expect(localStorage.getItem('parentAccount')).toBe('laiku');
  });
});
