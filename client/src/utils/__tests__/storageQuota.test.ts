// 配额写入失败留痕与告警单测（批次4.1 回归护栏）：
// 核心不变量是「写不进时绝不像成功一样静默」——必须留痕 + 对外告警，且不得抛出打挂页面。
export {}; // 无顶层 import 的文件在 isolatedModules 下必须显式成为模块

const REAL_SET_ITEM = Storage.prototype.setItem;

/** 模拟配额上限：value 超过 limit 字符的写入一律抛 QuotaExceededError，小值仍真实落盘 */
const stubQuotaFull = (limit: number) => {
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    if (String(value || '').length > limit) throw new Error('QuotaExceededError: simulated');
    return REAL_SET_ITEM.call(this, key, value);
  } as any;
  // 模块在加载时捕获原生 setItem 引用，必须重置模块注册表才能拿到打过桩的版本
  jest.resetModules();
};

afterEach(() => {
  Storage.prototype.setItem = REAL_SET_ITEM as any;
  localStorage.clear();
});

describe('safeSetItem 配额溢出', () => {
  it('写不进时返回 false，并留下可查记录与对外事件', () => {
    // 限额需大于留痕记录自身体积，否则无法区分「业务写入失败」与「留痕写入也失败」
    stubQuotaFull(1000);
    const { safeSetItem, getWriteFailures } = require('../storageQuota');
    const seen: any[] = [];
    window.addEventListener('storage-write-failed', ((e: any) => seen.push(e.detail)) as EventListener);
    const ok = safeSetItem('big_dataset', 'x'.repeat(3000));
    expect(ok).toBe(false);
    expect(localStorage.getItem('big_dataset')).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe('big_dataset');
    const logs = getWriteFailures();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(String(logs[logs.length - 1].key)).toBe('big_dataset');
  });

  it('小体量写入不受影响，且不产生失败留痕', () => {
    stubQuotaFull(1000);
    const { safeSetItem, getWriteFailures } = require('../storageQuota');
    expect(safeSetItem('small_dataset', 'y'.repeat(50))).toBe(true);
    expect(String(localStorage.getItem('small_dataset') || '').length).toBe(50);
    expect(getWriteFailures()).toEqual([]);
  });
});

describe('全局 setItem 防护补丁', () => {
  it('写不进时不抛异常（保持页面可用），但必须留痕', () => {
    stubQuotaFull(1000);
    const { installStorageQuotaGuard, getWriteFailures } = require('../storageQuota');
    installStorageQuotaGuard();
    let thrown = false;
    try {
      localStorage.setItem('guarded_dataset', 'z'.repeat(3000));
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    expect(localStorage.getItem('guarded_dataset')).toBeNull();
    expect(getWriteFailures().length).toBeGreaterThanOrEqual(1);
  });

  it('留痕键自身被保护，不被紧急清理删除', () => {
    stubQuotaFull(1000);
    const { installStorageQuotaGuard, emergencyFreeSpace, getWriteFailures } = require('../storageQuota');
    installStorageQuotaGuard();
    try { localStorage.setItem('guarded_dataset', 'z'.repeat(3000)); } catch { /* ignore */ }
    const before = getWriteFailures().length;
    expect(before).toBeGreaterThanOrEqual(1);
    emergencyFreeSpace();
    expect(getWriteFailures().length).toBeGreaterThanOrEqual(1);
  });
});

// 商品清单等大表「服务端为主、本地只放缓存」的核心不变量：
// 新值装不进缓存时必须连旧值一起作废——否则刷新后直读 localStorage 的页面会把
// 导入前的陈旧副本当最新数据，再经整键回写主存/服务端把刚导入的数据抹掉
describe('缓存失效语义（cacheDataset / invalidateDatasetCache）', () => {
  it('预算允许时正常写入缓存', () => {
    stubQuotaFull(100000);
    const { cacheDataset } = require('../storageQuota');
    expect(cacheDataset('pl', JSON.stringify([{ id: 1 }]))).toBe(true);
    expect(JSON.parse(String(localStorage.getItem('pl')))).toHaveLength(1);
  });

  it('新值装不下时作废陈旧副本（含版本戳），读取方一律回落到主存/服务端', () => {
    stubQuotaFull(1000);
    const { cacheDataset, invalidateDatasetCache } = require('../storageQuota');
    // 导入前：缓存里是旧清单
    expect(cacheDataset('pl', '["old-row"]')).toBe(true);
    localStorage.setItem('pl_ts', '111');
    // 导入后：大清单超配额，缓存写不进
    expect(cacheDataset('pl', 'x'.repeat(3000))).toBe(false);
    expect(localStorage.getItem('pl')).toBeNull();
    expect(localStorage.getItem('pl_ts')).toBeNull();
    // 幂等：对不存在的键再作废不报错
    invalidateDatasetCache('pl');
    expect(localStorage.getItem('pl')).toBeNull();
  });
});
