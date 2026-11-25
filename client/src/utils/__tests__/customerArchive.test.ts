/**
 * 客户归档登记册（customerArchive）行为回归。
 *
 * 背景：删除墓碑的时间戳让位规则把终止事件（statusTs/terminateAt 刷新）误判为重新合作而永久让位，
 * 且 reconcile 镜像补全 / 45s 水合回灌两个写点不认墓碑，导致「删除客户仍复活」。
 * 归档语义不受任何状态时间戳干扰：命中即压制，解除仅两条显式出口（用户恢复 / 批准写点 unarchiveParty）。
 * 本测试覆盖：无让位压制、reconcile 补全跳过、水合写点过滤、恢复解除、墓碑迁移幂等、同名歧义防误伤、prune 双列申报。
 */
import {
  customerArchiveKey,
  loadCustomerArchives,
  appendCustomerArchive,
  archiveMatchesParty,
  archiveActiveForParty,
  pruneArchivedBound,
  filterArchivedBound,
  unarchiveParty,
  migrateTombsToArchive,
} from '../customerArchive';
import type { CustomerArchiveEntry } from '../customerArchive';
import { appendCustomerDelTomb, customerDelTombKey } from '../customerDelTomb';
import { reconcileCooperationPairs } from '../cooperationReconcile';
import { isSyncKey } from '../serverSync';

const OWNER = 'sup1';

/** 名称档判定依赖全库注册表：甲公司唯一、同名公司两家独立主体（歧义） */
const seedUsers = (): void => {
  localStorage.setItem('registeredUsers', JSON.stringify([
    { username: OWNER, companyNo: 'SUP00001', companyName: '本供应商' },
    { username: 'purA', companyNo: 'AAAA1111', companyName: '甲公司' },
    { username: 'purB', companyNo: 'BBBB2222', companyName: '乙公司' },
    { username: 'purC', companyNo: 'CCCC3333', companyName: '同名公司' },
    { username: 'purD', companyNo: 'DDDD4444', companyName: '同名公司' },
  ]));
};

const archiveOf = (over: Partial<CustomerArchiveEntry> = {}): CustomerArchiveEntry => ({
  id: 'ca-1', username: '', no: '', name: '', archivedAt: 1_700_000_000_000, archivedBy: '张三', origin: 'manual', ...over,
});

describe('customerArchive 客户归档登记册', () => {
  beforeEach(() => { localStorage.clear(); seedUsers(); });

  it('登记后本地可读回，键纳入跨端同步白名单；迁移哨兵键不参与同步', () => {
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司', archivedBy: '张三' });
    const list = loadCustomerArchives(OWNER);
    expect(list.length).toBe(1);
    expect(list[0].username).toBe('purA');
    expect(list[0].archivedAt).toBeGreaterThan(0);
    expect(list[0].archivedBy).toBe('张三');
    expect(Number(localStorage.getItem(`${customerArchiveKey(OWNER)}_ts`))).toBeGreaterThan(0);
    expect(isSyncKey(customerArchiveKey(OWNER))).toBe(true);
    expect(isSyncKey(`${customerArchiveKey(OWNER)}_ts`)).toBe(false);
    // 哨兵键故意避开同步前缀：跨端覆盖会误跳过迁移
    expect(isSyncKey(`cust_arch_migrated_${OWNER}`)).toBe(false);
    // 归属隔离：他账号的归档读不到
    expect(loadCustomerArchives('sup2')).toEqual([]);
  });

  it('① 无时间戳让位：statusTs/terminateAt 晚于 archivedAt 的终止事件回写不解除归档', () => {
    const archives = [archiveOf({ username: 'purA', no: 'AAAA1111', name: '甲公司', archivedAt: 1_700_000_000_000 })];
    // 终止完成 / reconcile 状态回写刷新的时间戳全部晚于归档时刻——都不是重新合作
    const row = { purchaserUsername: 'purA', status: 'terminated', statusTs: 1_700_000_999_000, terminateAt: 1_700_000_999_000 };
    expect(archiveActiveForParty(archives, row)).toBe(true);
    const bound = [
      { key: 'k1', id: 'i1', purchaserUsername: 'purA', status: 'terminated', statusTs: Date.now(), terminateAt: Date.now() },
      { key: 'k2', id: 'i2', purchaserUsername: 'purA', status: 'approved', bindDate: '2099-01-01', statusTs: Date.now() },
      { key: 'k3', id: 'i3', purchaserUsername: 'purB', purchaserName: '乙公司' },
    ];
    const res = pruneArchivedBound(bound, archives);
    expect(res.list.map((r: any) => r.key)).toEqual(['k3']);
    expect(archiveActiveForParty([], row)).toBe(false);
  });

  it('② reconcile 镜像补全跳过供应商侧已归档的公司对（不补 bound 行）', () => {
    // 采购商浏览器视角：本端 purchaser_suppliers_purA 权威已合作，供应商 bound 镜像缺行
    localStorage.setItem('username', 'purA');
    localStorage.setItem('isSubAccount', 'false');
    localStorage.setItem('purchaser_suppliers_purA', JSON.stringify([
      { id: 'SP-1', supplierUsername: OWNER, supplierName: '本供应商', supplierNo: 'SUP00001', cooperationStatus: 'approved', cooperationDate: '2026-09-01' },
    ]));
    localStorage.setItem('boundPurchasers_' + OWNER, '[]');
    // 对照组：无归档时补全确实会发生（证明压制来自归档而非其他守卫）
    reconcileCooperationPairs();
    const without = JSON.parse(localStorage.getItem('boundPurchasers_' + OWNER) || '[]');
    expect(without.length).toBe(1);
    expect(without[0].purchaserUsername).toBe('purA');
    // 供应商侧已归档该采购商：补全必须跳过
    localStorage.setItem('boundPurchasers_' + OWNER, '[]');
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    reconcileCooperationPairs();
    expect(JSON.parse(localStorage.getItem('boundPurchasers_' + OWNER) || '[]')).toEqual([]);
  });

  it('② reconcile 状态回写键回写前再滤归档行（回流 bound 行不落盘）', () => {
    // 本端供应商视角：bound 镜像里残留已归档主体的回流终止行，状态回写触发键变更
    localStorage.setItem('username', OWNER);
    localStorage.setItem('isSubAccount', 'false');
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    localStorage.setItem('boundPurchasers_' + OWNER, JSON.stringify([
      { key: 'k1', id: 'i1', purchaserUsername: 'purA', purchaserName: '甲公司', status: 'approved', bindDate: '2026-09-01' },
      { key: 'k2', id: 'i2', purchaserUsername: 'purB', purchaserName: '乙公司', status: 'approved', bindDate: '2026-09-01' },
    ]));
    // 采购商侧镜像已终止 → 状态仲裁触发本端 bound 键回写（changed），回写前必须再滤归档行
    localStorage.setItem('purchaser_suppliers_purA', JSON.stringify([
      { id: 'SP-1', supplierUsername: OWNER, supplierName: '本供应商', cooperationStatus: 'terminated', statusTs: Date.parse('2026-10-01'), terminateAt: Date.parse('2026-10-01'), cooperationDate: '2026-09-01' },
    ]));
    localStorage.setItem('purchaser_suppliers_purB', JSON.stringify([
      { id: 'SP-2', supplierUsername: OWNER, supplierName: '本供应商', cooperationStatus: 'terminated', statusTs: Date.parse('2026-10-01'), terminateAt: Date.parse('2026-10-01'), cooperationDate: '2026-09-01' },
    ]));
    reconcileCooperationPairs();
    const after = JSON.parse(localStorage.getItem('boundPurchasers_' + OWNER) || '[]');
    expect(after.map((r: any) => r.purchaserUsername)).toEqual(['purB']);
  });

  it('③ 水合写点过滤：filterArchivedBound 按目标 owner 归档册剔除 bound 行', () => {
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    const bound = [
      { key: 'k1', id: 'i1', purchaserUsername: 'purA', purchaserName: '甲公司' },
      { key: 'k2', id: 'i2', purchaserUsername: 'purB', purchaserName: '乙公司' },
    ];
    expect(filterArchivedBound(bound, OWNER).map((r: any) => r.key)).toEqual(['k2']);
    // 他账号归档册不影响本 owner；无归档原样返回
    expect(filterArchivedBound(bound, 'sup2')).toEqual(bound);
    expect(filterArchivedBound(bound, OWNER)).not.toBe(bound);
  });

  it('④ 恢复解除：unarchiveParty 按 id 精确 / 凭证三档匹配移除，未命中返回 false', () => {
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司', snapshot: { boundRow: { key: 'k1' } } });
    const entry = loadCustomerArchives(OWNER)[0];
    // 未命中主体不动归档册
    expect(unarchiveParty(OWNER, { username: 'purB' })).toBe(false);
    expect(loadCustomerArchives(OWNER).length).toBe(1);
    // 按 id 精确解除（恢复按钮路径）
    expect(unarchiveParty(OWNER, { id: entry.id })).toBe(true);
    expect(loadCustomerArchives(OWNER)).toEqual([]);
    // 按凭证解除（批准写点路径：只带账号/编号/名称）
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    expect(unarchiveParty(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' })).toBe(true);
    expect(loadCustomerArchives(OWNER)).toEqual([]);
    expect(unarchiveParty(OWNER, { username: 'purA' })).toBe(false);
  });

  it('⑤ 墓碑迁移：首载转归档、幂等不重复、晚到墓碑再迁移、已有归档不堆叠', () => {
    appendCustomerDelTomb(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    const tomb = JSON.parse(localStorage.getItem(customerDelTombKey(OWNER)) || '[]')[0];
    migrateTombsToArchive(OWNER);
    let list = loadCustomerArchives(OWNER);
    expect(list.length).toBe(1);
    expect(list[0].origin).toBe('delete-migrate');
    expect(list[0].username).toBe('purA');
    expect(list[0].archivedAt).toBe(Number(tomb.deletedAt));
    // 幂等：重复迁移不堆叠
    migrateTombsToArchive(OWNER);
    expect(loadCustomerArchives(OWNER).length).toBe(1);
    // 晚到墓碑（他端同步新增）：指纹变化再次迁移，只增不减
    appendCustomerDelTomb(OWNER, { username: 'purB', no: 'BBBB2222', name: '乙公司' });
    migrateTombsToArchive(OWNER);
    list = loadCustomerArchives(OWNER);
    expect(list.length).toBe(2);
    expect(list.map(a => a.username).sort()).toEqual(['purA', 'purB']);
    // 已有同主体手动归档：迁移不重复登记
    localStorage.clear(); seedUsers();
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    appendCustomerDelTomb(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    migrateTombsToArchive(OWNER);
    expect(loadCustomerArchives(OWNER).length).toBe(1);
    expect(loadCustomerArchives(OWNER)[0].origin).toBe('manual');
  });

  it('⑥ 凭证三档与同名歧义：账号 > 编号 > 名称唯一，同名两家不互相误伤', () => {
    // 账号等值：改名不影响归档事实
    expect(archiveMatchesParty(archiveOf({ username: 'purA' }), { purchaserUsername: 'purA', purchaserName: '甲公司改名后' })).toBe(true);
    // 编号等值：归档只留编号、行只留账号时按注册表解析命中
    expect(archiveMatchesParty(archiveOf({ no: 'AAAA1111' }), { purchaserUsername: 'purA' })).toBe(true);
    // 名称档：全库唯一主体命中才放行
    expect(archiveMatchesParty(archiveOf({ name: '甲公司' }), { purchaserName: '甲公司' })).toBe(true);
    expect(archiveMatchesParty(archiveOf({ name: '乙公司' }), { purchaserName: '甲公司' })).toBe(false);
    // 同名两家独立公司：双方有凭证且不等即不认
    const a = archiveOf({ username: 'purC', no: 'CCCC3333', name: '同名公司' });
    expect(archiveMatchesParty(a, { purchaserUsername: 'purD', purchaserNo: 'DDDD4444', purchaserName: '同名公司' })).toBe(false);
    // 双方均无凭证只剩名称：全库同名多主体 → 歧义不认
    expect(archiveMatchesParty(archiveOf({ name: '同名公司' }), { purchaserName: '同名公司' })).toBe(false);
    // 调用方上下文与全库解析同口径
    expect(archiveMatchesParty(archiveOf({ name: '甲公司' }), { purchaserName: '甲公司' }, { ambiguous: new Set(['甲公司']) })).toBe(false);
    expect(archiveMatchesParty(archiveOf({ no: 'AAAA1111' }), { purchaserUsername: 'purX' }, { noByUn: new Map([['purX', 'AAAA1111']]) })).toBe(true);
  });

  it('⑦ prune 双列 removedKeys（key + id）供真表删除；无归档不产生申报', () => {
    const archives = [archiveOf({ username: 'purA', no: 'AAAA1111', name: '甲公司' })];
    const bound = [
      { key: 'bp-app-1', id: 'BIND-aaa111', purchaserUsername: 'purA', purchaserName: '甲公司' },
      { key: 'bp-ps-purB', id: 'BIND-bbb111', purchaserUsername: 'purB', purchaserName: '乙公司' },
    ];
    const res = pruneArchivedBound(bound, archives);
    expect(res.list.map((r: any) => r.key)).toEqual(['bp-ps-purB']);
    expect(res.removedKeys.sort()).toEqual(['BIND-aaa111', 'bp-app-1']);
    expect(pruneArchivedBound(bound, [])).toEqual({ list: bound, removedKeys: [] });
  });

  it('同一主体重复归档只刷新 archivedAt 并合并快照；空凭证不登记；损坏存量行过滤', () => {
    appendCustomerArchive(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司', snapshot: { boundRow: { key: 'k1' } } });
    const key = customerArchiveKey(OWNER);
    const stale = JSON.parse(localStorage.getItem(key) || '[]');
    stale[0].archivedAt = Date.now() - 100_000;
    localStorage.setItem(key, JSON.stringify(stale));
    appendCustomerArchive(OWNER, { username: 'purA', name: '甲公司新名', snapshot: { directProfile: { id: 'CUST-1' } } });
    const list = loadCustomerArchives(OWNER);
    expect(list.length).toBe(1);
    expect(list[0].archivedAt).toBeGreaterThan(Date.now() - 5_000);
    expect(list[0].name).toBe('甲公司新名');
    expect(list[0].no).toBe('AAAA1111');
    expect(list[0].snapshot?.boundRow).toEqual({ key: 'k1' });
    expect(list[0].snapshot?.directProfile).toEqual({ id: 'CUST-1' });
    // 空凭证不登记
    appendCustomerArchive(OWNER, {});
    expect(loadCustomerArchives(OWNER).length).toBe(1);
    // 损坏 / 无归档时间的存量行读回时过滤
    localStorage.setItem(key, '{not json');
    expect(loadCustomerArchives(OWNER)).toEqual([]);
    localStorage.setItem(key, JSON.stringify([null, { id: 'x', archivedAt: 0 }, archiveOf({ username: 'purB' })]));
    expect(loadCustomerArchives(OWNER).map(a => a.username)).toEqual(['purB']);
  });
});