// 合作镜像数据「不丢不乱改」单测：锁定本次「供应商列表数量一会儿 2 条一会儿 1 条、已合作被改回已解除」事故的回归不变量
// 1) 陈旧副本隔离：非本账号的镜像键不参与本端拉取，内容可能是任意久以前的快照，
//    禁止用它裁决本公司合作关系的状态，也不得被回写/清理（否则一次页面加载就把对方最新操作改回旧状态）
// 2) 合法删除必须显式申报：两个镜像键已纳入服务端「永不缩水键」（未申报的缩水被并集保留），
//    因此同源去重与删除供应商都必须登记 removedIds，否则被合并/被删的行会在下次拉取时复活
import { reconcileCooperationPairs } from '../cooperationReconcile';
import { dedupePurchaserSuppliers } from '../cooperationDedupe';
import { takeRemovedIds, peekRemovedIds, declareShrink } from '../shrinkRegistry';

const ME = 'purchaser-a';
const SUPPLIER = 'supplier-b';
const MY_KEY = `purchaser_suppliers_${ME}`;
const THEIR_KEY = `boundPurchasers_${SUPPLIER}`;

describe('合作状态仲裁的陈旧副本隔离', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const seed = (theirStatus: string, extra: Record<string, any> = {}) => {
    localStorage.setItem('username', ME);
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: ME, companyName: '甲贸易有限公司', companyNo: '101' },
      { username: SUPPLIER, companyName: '乙皮料有限公司', companyNo: '102' },
    ]));
    // 本账号权威副本：已合作
    localStorage.setItem(MY_KEY, JSON.stringify([
      { id: 'S1', supplierName: '乙皮料有限公司', supplierUsername: SUPPLIER, cooperationStatus: 'approved', cooperationDate: '2026-11-01' },
    ]));
    // 本浏览器残留的「供应商账号」键（本机不拉取该键，属于陈旧快照）
    localStorage.setItem(THEIR_KEY, JSON.stringify([
      { id: 'B1', purchaserUsername: ME, purchaserName: '甲贸易有限公司', status: theirStatus, bindDate: '2026-11-01', ...extra },
    ]));
  };

  it('对方账号的陈旧「已解除」镜像不得把本端「已合作」改回已解除', () => {
    seed('terminated', { terminateAt: Date.now() - 3600_000 });
    reconcileCooperationPairs();
    const mine = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
    expect(mine[0].cooperationStatus).toBe('approved');
  });

  it('对方账号的键不被本端回写，也不产生上传删除申报', () => {
    seed('terminated', { terminateAt: Date.now() - 3600_000 });
    reconcileCooperationPairs();
    expect(JSON.parse(localStorage.getItem(THEIR_KEY) || '[]')[0].status).toBe('terminated');
    expect(takeRemovedIds(MY_KEY)).toBeUndefined();
    expect(takeRemovedIds(THEIR_KEY)).toBeUndefined();
  });

  it('本账号权威镜像为「解除中」时仍照常完成状态闭环（隔离只针对非本账号键）', () => {
    seed('approved');
    localStorage.setItem(MY_KEY, JSON.stringify([
      { id: 'S1', supplierName: '乙皮料有限公司', supplierUsername: SUPPLIER, cooperationStatus: 'terminating', cooperationDate: '2026-11-01', terminateAt: Date.now() },
    ]));
    reconcileCooperationPairs();
    // 权威侧（本端）状态参与仲裁并被回写到自身，不应抛异常或丢行
    const mine = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
    expect(mine).toHaveLength(1);
    expect(['terminating', 'terminated']).toContain(mine[0].cooperationStatus);
  });

  it('误混入 boundPurchasers 的供应商卡片：仅在属于本账号时才被清理并申报删除', () => {
    localStorage.setItem('username', SUPPLIER);
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: ME, companyName: '甲贸易有限公司' },
      { username: SUPPLIER, companyName: '乙皮料有限公司' },
    ]));
    // 本账号（供应商）的 boundPurchasers 里混进了一张形状错误的供应商卡片
    localStorage.setItem(THEIR_KEY, JSON.stringify([
      { id: 'BAD1', supplierUsername: SUPPLIER, supplierName: '乙皮料有限公司', cooperationStatus: 'approved' },
    ]));
    reconcileCooperationPairs();
    expect(JSON.parse(localStorage.getItem(THEIR_KEY) || '[]')).toHaveLength(0);
    expect(takeRemovedIds(THEIR_KEY)).toEqual(['BAD1']);
  });

  it('他人账号键里的误放条目不由本端清理（谁的数据谁负责）', () => {
    localStorage.setItem('username', ME);
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: ME, companyName: '甲贸易有限公司' },
      { username: SUPPLIER, companyName: '乙皮料有限公司' },
    ]));
    localStorage.setItem(THEIR_KEY, JSON.stringify([
      { id: 'BAD1', supplierUsername: SUPPLIER, supplierName: '乙皮料有限公司', cooperationStatus: 'approved' },
    ]));
    reconcileCooperationPairs();
    expect(JSON.parse(localStorage.getItem(THEIR_KEY) || '[]')).toHaveLength(1);
    expect(takeRemovedIds(THEIR_KEY)).toBeUndefined();
  });
});

describe('同源去重的显式删除申报', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('合并同源重复条目时登记被合并掉的旧 id，避免服务端并集让重复行复活', () => {
    localStorage.setItem('username', ME);
    localStorage.setItem('registeredUsers', JSON.stringify([
      { username: SUPPLIER, companyName: '乙皮料有限公司', companyNo: '102' },
    ]));
    localStorage.setItem(MY_KEY, JSON.stringify([
      { id: 'A', supplierName: '乙皮料有限公司', supplierUsername: SUPPLIER, cooperationStatus: 'approved', addedDate: '2026-01-01 10:00:00' },
      { id: 'B', supplierName: '乙皮料有限公司', supplierUsername: SUPPLIER, cooperationStatus: 'pending', addedDate: '2026-02-01 10:00:00' },
    ]));
    expect(dedupePurchaserSuppliers(ME)).toBe(true);
    expect(JSON.parse(localStorage.getItem(MY_KEY) || '[]')).toHaveLength(1);
    expect(takeRemovedIds(MY_KEY)).toEqual(['B']);
  });

  it('无重复时不改动数据、不产生申报', () => {
    localStorage.setItem('username', ME);
    localStorage.setItem(MY_KEY, JSON.stringify([{ id: 'A', supplierName: '乙皮料有限公司', cooperationStatus: 'approved' }]));
    expect(dedupePurchaserSuppliers(ME)).toBe(false);
    expect(takeRemovedIds(MY_KEY)).toBeUndefined();
  });
});

describe('删除申报登记表语义', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('peek 只拍快照不消费，take 才清空（入队/补传与上传消费的分工）', () => {
    declareShrink(MY_KEY, ['X']);
    expect(peekRemovedIds(MY_KEY)).toEqual(['X']);
    expect(peekRemovedIds(MY_KEY)).toEqual(['X']);
    expect(takeRemovedIds(MY_KEY)).toEqual(['X']);
    expect(takeRemovedIds(MY_KEY)).toBeUndefined();
  });

  it('同键多次申报去重合并，空数组不登记', () => {
    declareShrink(MY_KEY, ['X', 'Y']);
    declareShrink(MY_KEY, ['Y', 'Z']);
    declareShrink(MY_KEY, []);
    expect(takeRemovedIds(MY_KEY)).toEqual(['X', 'Y', 'Z']);
  });
});
