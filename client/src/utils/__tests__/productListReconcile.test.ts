/**
 * 商品清单「服务端为主、本地只放缓存」对账回归护栏。
 * 核心不变量（对应线上故障「导入后刷新浏览器数据就没了」）：
 * 本机那份「刚导入但没赶上上传」的清单，绝不能被服务端的旧副本整键擦掉；
 * 服务端下发空副本时，也不能拿它覆盖有数据的本机。
 */
export {};

const KEY = 'pageData_basic-data_product-list_acme';

const mockState = {
  /** 服务端 dataset_store 里的那份（null = 服务端还没有这个键，GET 返回 404） */
  server: null as { json: string; updatedAt: number } | null,
  /** 本机可信主存（IndexedDB）副本 */
  idb: null as { json: string; updatedAt: number } | null,
  uploads: [] as { key: string; json: string }[],
  adopts: [] as { json: string; ts: number }[],
  serverOk: true,
  uploadOk: true,
};

jest.mock('../dataStore', () => ({
  productListKey: (owner: string) => `pageData_basic-data_product-list_${owner}`,
  saveDataset: jest.fn(),
  saveDatasetAt: jest.fn(),
  loadDataset: jest.fn(async () => mockState.idb),
  readFreshDataset: jest.fn(async () => (mockState.idb ? mockState.idb.json : null)),
  setMemProductList: jest.fn(),
  adoptProductList: jest.fn((_owner: string, json: string, ts: number) => {
    mockState.adopts.push({ json, ts });
    try { return JSON.parse(json); } catch { return []; }
  }),
}));

jest.mock('../serverSync', () => ({
  serverAvailable: jest.fn(async () => mockState.serverOk),
  fetchServerDataset: jest.fn(async () => mockState.server),
  flushDatasetUploadAsync: jest.fn(async (key: string, json: string) => {
    mockState.uploads.push({ key, json });
    return mockState.uploadOk;
  }),
  noteServerVersion: jest.fn(),
}));

jest.mock('../storageQuota', () => ({
  cacheDataset: jest.fn(() => true),
}));

type Reconcile = Awaited<ReturnType<typeof import('../productListSync').reconcileProductListWithServer>>;

let reconcile: (owner: string) => Promise<Reconcile>;
let resetReconcile: () => void;

const rows = (n: number, tag: string) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `${tag}-${i}`, key: `${tag}-${i}` })));

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
  mockState.server = null;
  mockState.idb = null;
  mockState.uploads = [];
  mockState.adopts = [];
  mockState.serverOk = true;
  mockState.uploadOk = true;
  const mod = require('../productListSync');
  reconcile = mod.reconcileProductListWithServer;
  resetReconcile = mod.resetProductListReconcile;
});

describe('商品清单挂载对账', () => {
  it('本机较新（上次上传没赶上）：补传本机，不采纳服务端旧副本', async () => {
    const now = Date.now();
    mockState.idb = { json: rows(120, 'imp'), updatedAt: now };
    localStorage.setItem(`${KEY}_ts`, String(now));
    mockState.server = { json: rows(3, 'old'), updatedAt: now - 10 * 60_000 };
    const res = await reconcile('acme');
    expect(res.status).toBe('uploaded');
    expect(mockState.uploads).toHaveLength(1);
    expect(JSON.parse(mockState.uploads[0].json)).toHaveLength(120);
    expect(mockState.adopts).toHaveLength(0);
  });

  it('服务端下发空副本时不得擦掉本机清单：改为把本机补传', async () => {
    const now = Date.now();
    mockState.idb = { json: rows(50, 'imp'), updatedAt: now - 60_000 };
    localStorage.setItem(`${KEY}_ts`, String(now - 60_000));
    // 服务端版本更新，但内容是一份异常空值
    mockState.server = { json: '[]', updatedAt: now };
    const res = await reconcile('acme');
    expect(res.status).toBe('uploaded');
    expect(mockState.adopts).toHaveLength(0);
  });

  it('服务端明显更新且行数不少于本机：采纳服务端副本（以服务端为主）', async () => {
    const now = Date.now();
    mockState.idb = { json: rows(3, 'local'), updatedAt: now - 20 * 60_000 };
    localStorage.setItem(`${KEY}_ts`, String(now - 20 * 60_000));
    mockState.server = { json: rows(9, 'server'), updatedAt: now };
    const res = await reconcile('acme');
    expect(res.status).toBe('server');
    expect((res as any).list).toHaveLength(9);
    expect(mockState.adopts).toHaveLength(1);
    expect(mockState.uploads).toHaveLength(0);
  });

  it('本机为空：直接采纳服务端副本，不回传空清单', async () => {
    mockState.idb = null;
    mockState.server = { json: rows(7, 'server'), updatedAt: Date.now() };
    const res = await reconcile('acme');
    expect(res.status).toBe('server');
    expect(mockState.uploads).toHaveLength(0);
  });

  it('服务端只新出少量（时钟偏差窗口内）却比本机行数少：不动本机数据', async () => {
    const now = Date.now();
    mockState.idb = { json: rows(20, 'imp'), updatedAt: now - 30_000 };
    localStorage.setItem(`${KEY}_ts`, String(now - 30_000));
    mockState.server = { json: rows(19, 'old'), updatedAt: now };
    const res = await reconcile('acme');
    // 偏差窗口内 + 服务端行数更少 → 先按「本机可能是没传上去的新清单」保数据，走补传
    expect(res.status).toBe('uploaded');
    expect(mockState.adopts).toHaveLength(0);
  });

  it('服务端尚无这份清单：用本机数据建档；本机也为空则什么都不做', async () => {
    const now = Date.now();
    mockState.idb = { json: rows(4, 'first'), updatedAt: now };
    localStorage.setItem(`${KEY}_ts`, String(now));
    mockState.server = null;
    expect((await reconcile('acme')).status).toBe('uploaded');
    expect(mockState.uploads).toHaveLength(1);

    resetReconcile();
    mockState.idb = null;
    mockState.uploads = [];
    localStorage.clear();
    expect((await reconcile('acme')).status).toBe('skip');
    expect(mockState.uploads).toHaveLength(0);
  });

  it('服务端不可用时完全跳过（离线不改本机、不排队上传）', async () => {
    mockState.serverOk = false;
    mockState.idb = { json: rows(6, 'local'), updatedAt: Date.now() };
    const res = await reconcile('acme');
    expect(res.status).toBe('skip');
    expect(mockState.uploads).toHaveLength(0);
    // 未标记已对账：服务端恢复后仍会回源一次（本机有行而服务端无档 → 上传建档）
    mockState.serverOk = true;
    expect((await reconcile('acme')).status).toBe('uploaded');
    expect(mockState.uploads).toHaveLength(1);
  });

  it('每个清单每次会话只对账一次', async () => {
    mockState.idb = { json: rows(2, 'local'), updatedAt: Date.now() };
    mockState.server = { json: rows(2, 'local'), updatedAt: Date.now() };
    await reconcile('acme');
    const calls = (require('../serverSync').fetchServerDataset as jest.Mock).mock.calls.length;
    await reconcile('acme');
    expect((require('../serverSync').fetchServerDataset as jest.Mock).mock.calls.length).toBe(calls);
  });
});
