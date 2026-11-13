// 存储用量与配额的「公司（主账号）级口径」回归护栏：
// 顶栏「数据库空间」统计的是云端数据库用量，同一企业的主账号与子账号必须显示同一个数字。
// 历史缺陷：布局层把 localStorage.username（子账号自己的名字）当查询键，
// 而账本与服务端计数器都按 owner（主账号）记账，于是子账号查出接近 0 的用量与 2GB 配额。
export {}; // 无顶层 import 的文件在 isolatedModules 下必须显式成为模块

const CERT_CACHE_KEY = 'cert_status_cache';
const BASE_QUOTA_KB = 2 * 1024 * 1024;
const CERTIFIED_QUOTA_KB = 10 * 1024 * 1024;

/** 子账号会话：username=小易，归属主账号=易承鑫 */
const useSubAccountSession = () => {
  localStorage.setItem('username', '小易');
  localStorage.setItem('isSubAccount', 'true');
  localStorage.setItem('parentAccount', '易承鑫');
};

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
});

describe('用量/配额的公司级归属口径', () => {
  it('sessionDataOwner 把子账号归并到主账号', () => {
    useSubAccountSession();
    const { sessionDataOwner } = require('../storageQuota');
    expect(sessionDataOwner()).toBe('易承鑫');
  });

  it('主账号会话下 sessionDataOwner 就是自身（不会误并）', () => {
    localStorage.setItem('username', '易承鑫');
    localStorage.setItem('isSubAccount', 'false');
    const { sessionDataOwner } = require('../storageQuota');
    expect(sessionDataOwner()).toBe('易承鑫');
  });

  it('企业认证为公司级：按 owner 查配额主子同为 10GB，按子账号名查会退化成 2GB', () => {
    useSubAccountSession();
    // fetchCertStatus(getCertQueryUsername()) 只会以主账号名写认证缓存
    localStorage.setItem(CERT_CACHE_KEY, JSON.stringify({ 易承鑫: { status: 'certified', ts: Date.now() } }));
    const { getUserQuota, sessionDataOwner } = require('../storageQuota');
    expect(getUserQuota(sessionDataOwner())).toBe(CERTIFIED_QUOTA_KB);
    // 反证旧口径：以子账号自身查询拿不到公司认证结果，正是线上 2.00GB 的来源
    expect(getUserQuota('小易')).toBe(BASE_QUOTA_KB);
  });

  it('本地账本按 owner 记账：查子账号名得到 0，必须查主账号名', () => {
    useSubAccountSession();
    localStorage.setItem('purchaser_suppliers_易承鑫', JSON.stringify([{ id: 'S001', name: '诺莱德' }]));
    const { getLocalUsageKB, sessionDataOwner } = require('../storageQuota');
    expect(getLocalUsageKB(sessionDataOwner())).toBeGreaterThan(0);
    expect(getLocalUsageKB('小易')).toBe(0);
  });

  it('无认证记录时底座配额为 2GB（不会凭空给到 10GB）', () => {
    useSubAccountSession();
    const { getUserQuota } = require('../storageQuota');
    expect(getUserQuota('小易')).toBe(BASE_QUOTA_KB);
  });
});
