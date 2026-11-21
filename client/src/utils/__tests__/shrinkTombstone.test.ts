/**
 * 持久删除墓碑（shrinkRegistry）行为回归。
 *
 * 背景：「永不缩水键」的服务端合并只做「incoming 并集 + 仅按申报 removedIds 删行」，
 * 而删除申报原本只是内存一次性状态——上传成功即消费、刷新即丢。任何一份仍含该行的
 * 陈旧副本（服务端他端并集回灌、IndexedDB 主存、查询回源并集、错桶归并）都能把已删的
 * 银行账户/账单行永久复活（用户反馈：删了银行账户，刷新又出现）。
 * 墓碑层让「这一行是本端主动删的」这个事实在刷新之后依然可判定，并且只在行真实重新
 * 出现时作废，既压幽灵回流又不锁死合法重建。
 */
import {
  declareShrink,
  takeRemovedIds,
  peekRemovedIds,
  removedIdsFor,
  removedIdSet,
  tombstoneIds,
  recordTombstones,
  pruneTombstonesByRows,
  isRowRemoved,
  rowPrimaryId,
  rowIdentities,
} from '../shrinkRegistry';

const TOMB_KEY = 'shrink_tombstones_v1';

/** 直接改写墓碑时刻，用于模拟 TTL 过期（不依赖 fake timers 的实现细节） */
const ageTombstone = (key: string, id: string, ageMs: number): void => {
  const tombs = JSON.parse(localStorage.getItem(TOMB_KEY) || '{}');
  tombs[key][id] = Date.now() - ageMs;
  localStorage.setItem(TOMB_KEY, JSON.stringify(tombs));
};

describe('shrinkRegistry 持久删除墓碑', () => {
  beforeEach(() => localStorage.clear());

  it('上传成功消费掉一次性申报后，删除事实仍然可判定（刷新不复活）', () => {
    const key = 'pageData_finance_bank-account_tomb1';
    declareShrink(key, ['ba-1', 'BA-1001']);
    // 入队快照只读不消费
    expect(peekRemovedIds(key)).toEqual(['ba-1', 'BA-1001']);
    // 上传成功：一次性申报被消费（等价于「刷新后内存全空」的最坏情况）
    expect(takeRemovedIds(key)).toEqual(['ba-1', 'BA-1001']);
    expect(peekRemovedIds(key)).toBeUndefined();
    // 墓碑仍在，所有「并回」路径据此剪枝
    expect(tombstoneIds(key).sort()).toEqual(['BA-1001', 'ba-1']);
    expect(removedIdSet(key).has('ba-1')).toBe(true);
  });

  it('只按主键（key 优先）判定已删，同号不同账户不被误伤', () => {
    const key = 'pageData_finance_bank-account_tomb2';
    // 银行账户：key 是行主键，id 是用户填写的账户编号（可重复）
    const deleted = { key: 'ba-1', id: 'BA-1001', name: '测试4' };
    const sameNumber = { key: 'ba-2', id: 'BA-1001', name: '利息' };
    // 申报覆盖 key 与 id 双值（与页面删除处的申报口径一致），判定仍只看主键
    declareShrink(key, [rowPrimaryId(deleted), String(deleted.id)]);
    takeRemovedIds(key);
    expect(isRowRemoved(key, deleted)).toBe(true);
    expect(isRowRemoved(key, sameNumber)).toBe(false);
  });

  it('行重新出现在待写清单时作废墓碑，合法重建不被压制', () => {
    const key = 'pageData_sales_order-manage_tomb3';
    recordTombstones(key, ['o-1']);
    // 重建的同号行仍在本地清单里（含只带 id 的旧副本形态）
    pruneTombstonesByRows(key, [{ id: 'o-1', status: 'pending' }]);
    expect(tombstoneIds(key)).toEqual([]);
    expect(removedIdSet(key).size).toBe(0);
  });

  it('待上传清单里的行不会随墓碑一起申报删除', () => {
    const key = 'pageData_finance_bank-account_tomb4';
    declareShrink(key, ['ba-9']);
    // 墓碑只压制「并回」，不得反向删掉本地真实存在的其他行
    pruneTombstonesByRows(key, [{ key: 'ba-1', id: 'BA-1001' }, { key: 'ba-9', id: 'BA-9999' }]);
    expect(tombstoneIds(key)).toEqual([]);
    takeRemovedIds(key);
  });

  it('墓碑过期即失效并就地剪枝', () => {
    const key = 'pageData_customer_bill-detail_tomb5';
    declareShrink(key, ['bill-1']);
    takeRemovedIds(key);
    ageTombstone(key, 'bill-1', 8 * 24 * 3600 * 1000); // 超过 7 天 TTL
    expect(tombstoneIds(key)).toEqual([]);
    const tombs = JSON.parse(localStorage.getItem(TOMB_KEY) || '{}');
    expect(Object.keys(tombs[key]).length).toBe(0);
  });

  it('removedIdsFor = 未消费申报 ∪ 有效墓碑（去重）', () => {
    const key = 'pageData_finance_bank-account_tomb6';
    declareShrink(key, ['ba-1']);
    recordTombstones(key, ['ba-1', 'ba-2']);
    expect(removedIdsFor(key).sort()).toEqual(['ba-1', 'ba-2']);
  });

  it('行身份包含 key 与 id，供双值合并判定使用', () => {
    expect(rowIdentities({ key: 'ba-1', id: 'BA-1001' }).sort()).toEqual(['BA-1001', 'ba-1']);
    expect(rowIdentities({ key: 'ba-1' })).toEqual(['ba-1']);
    expect(rowPrimaryId({ key: '', id: 'BA-1001' })).toBe('BA-1001');
  });
});
