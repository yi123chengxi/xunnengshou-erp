/**
 * 客户数据权威真表 API 客户端（customerApi）行为回归。
 *
 * 背景：四键（customers_/customer_archive_/credit_adjustments_/customer_pay_summary_）
 * 从全局键同步换轨为 /api/customer/* 服务端真表权威，本地退化为只读镜像缓存。
 * 本测试覆盖：镜像回灌防回环、hydratedOnce 删除守卫、paySummary map↔rows 与 updatedAt 取新、
 * 离线保留镜像 + 重试队列先补传再水合、跨租户 payload owner 解析（不申报删除）、首载补种幂等、
 * 跨租户共享读缓存与本地镜像兜底。
 */
type Api = typeof import('../customerApi');

const OWNER = 'sup1';
const CUST_KEY = `customers_${OWNER}`;
const ARCH_KEY = `customer_archive_${OWNER}`;
const CREDIT_KEY = `credit_adjustments_${OWNER}`;
const SUMMARY_KEY = `customer_pay_summary_${OWNER}`;

let api: Api;
let pushBodies: any[];
let callOrder: string[];
let snapshotData: any;
let sharedData: any;
let pushOk: boolean;
let sharedOk: boolean;

const emptySnapshot = () => ({ customers: [], archives: [], creditAdjustments: [], paySummary: [] });

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
  localStorage.setItem('username', OWNER);
  localStorage.setItem('token', 'test-token');
  pushBodies = [];
  callOrder = [];
  snapshotData = emptySnapshot();
  sharedData = { customers: [], creditAdjustments: [] };
  pushOk = true;
  sharedOk = true;
  (global as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes('/customer/push')) {
      callOrder.push('push');
      pushBodies.push(JSON.parse(init?.body || '{}'));
      if (!pushOk) return { ok: false, status: 500, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ code: 200, data: snapshotData, rejected: [] }) } as any;
    }
    if (u.includes('/customer/snapshot')) {
      callOrder.push('snapshot');
      return { ok: true, status: 200, json: async () => ({ code: 200, data: snapshotData }) } as any;
    }
    if (u.includes('/customer/shared')) {
      callOrder.push('shared');
      if (!sharedOk) return { ok: false, status: 500, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ code: 200, data: sharedData }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  };
  api = require('../customerApi');
});

afterEach(() => {
  localStorage.clear();
});

describe('customerApi 客户数据权威真表客户端', () => {
  it('键判定与归属：四前缀命中，子账号归父账号', () => {
    expect(api.isCustomerKey(CUST_KEY)).toBe(true);
    expect(api.isCustomerKey(ARCH_KEY)).toBe(true);
    expect(api.isCustomerKey(CREDIT_KEY)).toBe(true);
    expect(api.isCustomerKey(SUMMARY_KEY)).toBe(true);
    expect(api.isCustomerKey('boundPurchasers_sup1')).toBe(false);
    expect(api.isCustomerKey('supplier_pay_summary_sup1')).toBe(false);
    expect(api.customerOwner()).toBe(OWNER);
    localStorage.setItem('isSubAccount', 'true');
    localStorage.setItem('parentAccount', 'parentSup');
    expect(api.customerOwner()).toBe('parentSup');
  });

  it('镜像回灌防回环：水合落地后同值 setItem 不触发推送', async () => {
    snapshotData = { ...emptySnapshot(), customers: [{ id: 'c1', name: '甲公司' }] };
    expect(await api.hydrateCustomer()).toBe(true);
    expect(JSON.parse(localStorage.getItem(CUST_KEY) || '[]')).toEqual([{ id: 'c1', name: '甲公司' }]);
    // 页面加载收敛把镜像原值写回（lastValue 命中）→ 不得再推送
    api.scheduleCustomerUpload(CUST_KEY, localStorage.getItem(CUST_KEY) || '');
    await api.flushCustomerUpload(CUST_KEY);
    expect(pushBodies.length).toBe(0);
  });

  it('hydratedOnce 删除守卫：未水合不申报删除，水合后按键集 diff 申报', async () => {
    // 新设备首次写入（从未水合）：removedKeys 必须为空，杜绝空表擦除服务端
    localStorage.setItem(CUST_KEY, JSON.stringify([{ id: 'a' }]));
    api.scheduleCustomerUpload(CUST_KEY, localStorage.getItem(CUST_KEY) || '');
    await api.flushCustomerUpload(CUST_KEY);
    expect(pushBodies.length).toBe(1);
    expect(pushBodies[0].customers.owner).toBe(OWNER);
    expect(pushBodies[0].customers.removedKeys).toEqual([]);
    // 推送响应回灌快照 [a,b] → hydratedOnce；此后删除 b 须显式申报
    snapshotData = { ...emptySnapshot(), customers: [{ id: 'a' }, { id: 'b' }] };
    await api.hydrateCustomer();
    localStorage.setItem(CUST_KEY, JSON.stringify([{ id: 'a' }]));
    api.scheduleCustomerUpload(CUST_KEY, localStorage.getItem(CUST_KEY) || '');
    await api.flushCustomerUpload(CUST_KEY);
    expect(pushBodies.length).toBe(2);
    expect(pushBodies[1].customers.removedKeys).toEqual(['b']);
  });

  it('paySummary 特化：push map→rows（key=主体名），水合按 updatedAt 取新者', async () => {
    // 本地刚重算的新鲜值（updatedAt 更新）不得被服务端陈旧快照覆盖
    const fresh = { purchaseTotal: 200, receivedTotal: 0, receivedCount: 0, updatedAt: '2026-02-02T00:00:00.000Z' };
    localStorage.setItem(SUMMARY_KEY, JSON.stringify({ '甲公司': fresh }));
    snapshotData = {
      ...emptySnapshot(),
      paySummary: [{ key: '甲公司', purchaseTotal: 100, receivedTotal: 0, receivedCount: 0, updatedAt: '2026-01-01T00:00:00.000Z' }],
    };
    await api.hydrateCustomer();
    const map = JSON.parse(localStorage.getItem(SUMMARY_KEY) || '{}');
    expect(map['甲公司'].purchaseTotal).toBe(200);
    // 服务端更新值则采纳
    snapshotData = {
      ...emptySnapshot(),
      paySummary: [{ key: '甲公司', purchaseTotal: 300, receivedTotal: 0, receivedCount: 0, updatedAt: '2026-03-03T00:00:00.000Z' }],
    };
    await api.hydrateCustomer(true);
    expect(JSON.parse(localStorage.getItem(SUMMARY_KEY) || '{}')['甲公司'].purchaseTotal).toBe(300);
    // push：对象映射拆行，key=主体名，owner=本人
    const next = { '乙公司': { purchaseTotal: 50, receivedTotal: 0, receivedCount: 0, updatedAt: '2026-04-04T00:00:00.000Z' } };
    localStorage.setItem(SUMMARY_KEY, JSON.stringify(next));
    api.scheduleCustomerUpload(SUMMARY_KEY, localStorage.getItem(SUMMARY_KEY) || '');
    await api.flushCustomerUpload(SUMMARY_KEY);
    const seg = pushBodies[pushBodies.length - 1].paySummary;
    expect(seg.owner).toBe(OWNER);
    expect(seg.rows).toEqual([{ key: '乙公司', ...next['乙公司'] }]);
  });

  it('离线可写后补传：推送失败保留镜像进重试队列，水合前先补传再拉快照', async () => {
    pushOk = false;
    localStorage.setItem(CREDIT_KEY, JSON.stringify([{ id: 'adj1', amount: 100 }]));
    api.scheduleCustomerUpload(CREDIT_KEY, localStorage.getItem(CREDIT_KEY) || '');
    await api.flushCustomerUpload(CREDIT_KEY);
    // 失败：本地镜像保留（离线可写），不抛错
    expect(JSON.parse(localStorage.getItem(CREDIT_KEY) || '[]')).toEqual([{ id: 'adj1', amount: 100 }]);
    // 恢复联网：hydrate 必须先补传失败写入，再拉快照（防旧快照覆盖本地新写）
    pushOk = true;
    snapshotData = { ...emptySnapshot(), creditAdjustments: [{ id: 'adj1', amount: 100 }] };
    callOrder = [];
    expect(await api.hydrateCustomer()).toBe(true);
    expect(callOrder).toEqual(['push', 'snapshot']);
    expect(pushBodies[pushBodies.length - 1].creditAdjustments.rows).toEqual([{ id: 'adj1', amount: 100 }]);
  });

  it('快照失败保留镜像：服务端不可达时本地缓存不作权威覆写', async () => {
    localStorage.setItem(CUST_KEY, JSON.stringify([{ id: 'local1' }]));
    (global as any).fetch = async () => { throw new Error('offline'); };
    expect(await api.hydrateCustomer()).toBe(false);
    expect(JSON.parse(localStorage.getItem(CUST_KEY) || '[]')).toEqual([{ id: 'local1' }]);
  });

  it('跨租户代写：payload owner 按键前缀解析，跨租户段永不申报删除', async () => {
    // 先水合本人快照（hydratedOnce=true），验证跨租户段仍不申报 diff 删除
    await api.hydrateCustomer();
    localStorage.setItem('customers_otherSup', JSON.stringify([{ id: 'x1', type: '合作客户' }]));
    api.scheduleCustomerUpload('customers_otherSup', localStorage.getItem('customers_otherSup') || '');
    await api.flushCustomerUpload('customers_otherSup');
    expect(pushBodies[pushBodies.length - 1].customers.owner).toBe('otherSup');
    expect(pushBodies[pushBodies.length - 1].customers.removedKeys).toEqual([]);
    localStorage.setItem('customer_archive_otherSup', JSON.stringify([]));
    api.scheduleCustomerUpload('customer_archive_otherSup', '[]');
    await api.flushCustomerUpload('customer_archive_otherSup');
    expect(pushBodies[pushBodies.length - 1].archives.owner).toBe('otherSup');
    expect(pushBodies[pushBodies.length - 1].archives.removedKeys).toEqual([]);
  });

  it('首载补种：本地四键现值 upsert-only 推送，全部成功才落哨兵且幂等', async () => {
    localStorage.setItem(CUST_KEY, JSON.stringify([{ id: 'seed-c' }]));
    localStorage.setItem(CREDIT_KEY, JSON.stringify([{ id: 'seed-a' }]));
    snapshotData = { ...emptySnapshot(), customers: [{ id: 'seed-c' }], creditAdjustments: [{ id: 'seed-a' }] };
    api.installCustomerSync();
    // 启动异步链：补种两键推送 + 水合（微任务逐轮排空）
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(pushBodies.length).toBe(2);
    // 补种段不申报删除（seed=true）
    pushBodies.forEach((b) => {
      const seg = b.customers || b.creditAdjustments;
      expect(seg.removedKeys).toEqual([]);
    });
    expect(localStorage.getItem(`cust_api_seeded_${OWNER}`)).toBeTruthy();
    // 幂等：可见性恢复再次触发 ensureSeeded，哨兵已落 → 不再补种推送
    const before = pushBodies.length;
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(pushBodies.length).toBe(before);
  });

  it('跨租户共享读：成功入内存缓存（peek 同步读），失败回退本地镜像', async () => {
    sharedData = { customers: [{ id: 'sc1', name: '甲公司', credit: 500 }], creditAdjustments: [{ id: 'sa1', amount: 100 }] };
    const got = await api.fetchCustomerShared('otherSup');
    expect(got.customers).toEqual(sharedData.customers);
    expect(api.peekCustomerShared('otherSup').creditAdjustments).toEqual(sharedData.creditAdjustments);
    // 服务端不可达：回退本机镜像（同浏览器场景对方镜像可能存在）
    sharedOk = false;
    localStorage.setItem('customers_thirdSup', JSON.stringify([{ id: 'mc1' }]));
    localStorage.setItem('credit_adjustments_thirdSup', JSON.stringify([{ id: 'ma1' }]));
    const fb = await api.fetchCustomerShared('thirdSup');
    expect(fb.customers).toEqual([{ id: 'mc1' }]);
    expect(fb.creditAdjustments).toEqual([{ id: 'ma1' }]);
    expect(api.peekCustomerShared('thirdSup').customers).toEqual([{ id: 'mc1' }]);
  });
});

export {};