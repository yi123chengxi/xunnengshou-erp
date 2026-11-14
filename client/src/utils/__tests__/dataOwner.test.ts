import {
  accountRootOf,
  readOwnerFromToken,
  getSessionOwner,
  tenantMembersOf,
  mergeStrandedTenantDataset,
} from '../dataOwner';

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
});
