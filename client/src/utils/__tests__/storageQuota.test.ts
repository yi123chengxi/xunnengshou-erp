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
