/**
 * 客户删除墓碑（customerDelTomb）行为回归。
 *
 * 背景：供应商删除「已绑定采购商」客户后，loadBoundPurchasersFromStorage 的两条派生兜底
 * （已批准合作申请补行 / 采购商侧供应商目录反向扫描补行）会按合作痕迹把已删行补回，
 * 再经回写 + setItem 钩子上传真表，表现为「删除客户会复活」（且跨设备持久复活）。
 * 墓碑层让「这个主体是本端主动删的」在刷新与他端派生之后依然可判定，
 * 同时不阻断删除后重新建立的合作（来源时间戳晚于删除时间即让位）。
 */
import {
  customerDelTombKey,
  loadCustomerDelTombs,
  appendCustomerDelTomb,
  tombMatchesParty,
  tombActiveForParty,
  pruneTombstonedBound,
} from '../customerDelTomb';
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

const tombOf = (over: Partial<{ id: string; username: string; no: string; name: string; deletedAt: number }> = {}) => ({
  id: 'cdt-1', username: '', no: '', name: '', deletedAt: 1_700_000_000_000, ...over,
});

describe('customerDelTomb 客户删除墓碑', () => {
  beforeEach(() => { localStorage.clear(); seedUsers(); });

  it('登记后本地可读回，且键纳入跨端同步白名单（_ts 版本键不参与同步）', () => {
    appendCustomerDelTomb(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    const tombs = loadCustomerDelTombs(OWNER);
    expect(tombs.length).toBe(1);
    expect(tombs[0].username).toBe('purA');
    expect(tombs[0].no).toBe('AAAA1111');
    expect(tombs[0].deletedAt).toBeGreaterThan(0);
    expect(Number(localStorage.getItem(`${customerDelTombKey(OWNER)}_ts`))).toBeGreaterThan(0);
    expect(isSyncKey(customerDelTombKey(OWNER))).toBe(true);
    expect(isSyncKey(`${customerDelTombKey(OWNER)}_ts`)).toBe(false);
    // 归属隔离：他账号的墓碑读不到
    expect(loadCustomerDelTombs('sup2')).toEqual([]);
  });

  it('凭证三档：账号等值 > 编号等值 > 名称全等且全库唯一', () => {
    // 账号等值：名称不同也认（改名不影响删除事实）
    expect(tombMatchesParty(tombOf({ username: 'purA' }), { purchaserUsername: 'purA', purchaserName: '甲公司改名后' })).toBe(true);
    // 编号等值：墓碑只留编号、行只留账号时按注册表解析编号命中
    expect(tombMatchesParty(tombOf({ no: 'AAAA1111' }), { purchaserUsername: 'purA' })).toBe(true);
    // 名称档：全库唯一主体命中才放行
    expect(tombMatchesParty(tombOf({ name: '甲公司' }), { purchaserName: '甲公司' })).toBe(true);
    expect(tombMatchesParty(tombOf({ name: '乙公司' }), { purchaserName: '甲公司' })).toBe(false);
  });

  it('同名两家独立公司不互相误杀：双方有账号/编号且不等即不认，名称歧义也不认', () => {
    const t = tombOf({ username: 'purC', no: 'CCCC3333', name: '同名公司' });
    expect(tombMatchesParty(t, { purchaserUsername: 'purD', purchaserNo: 'DDDD4444', purchaserName: '同名公司' })).toBe(false);
    // 双方均无凭证只剩名称：全库同名多主体 → 歧义不认
    expect(tombMatchesParty(tombOf({ name: '同名公司' }), { purchaserName: '同名公司' })).toBe(false);
    // 调用方传入的歧义表/编号表与全库解析同口径
    expect(tombMatchesParty(tombOf({ name: '甲公司' }), { purchaserName: '甲公司' }, { ambiguous: new Set(['甲公司']) })).toBe(false);
    expect(tombMatchesParty(tombOf({ no: 'AAAA1111' }), { purchaserUsername: 'purX' }, { noByUn: new Map([['purX', 'AAAA1111']]) })).toBe(true);
  });

  it('时效让位：来源时间戳晚于删除时间视为重新合作，缺失时间戳按历史痕迹活跃', () => {
    const tombs = [tombOf({ username: 'purA', deletedAt: 1_700_000_000_000 })];
    const row = { purchaserUsername: 'purA' };
    expect(tombActiveForParty(tombs, row, 1_699_999_999_000)).toBe(true);
    expect(tombActiveForParty(tombs, row, 1_700_000_000_000)).toBe(true);
    expect(tombActiveForParty(tombs, row, 1_700_000_001_000)).toBe(false);
    expect(tombActiveForParty(tombs, row, 0)).toBe(true);
    expect(tombActiveForParty(tombs, row, undefined)).toBe(true);
    expect(tombActiveForParty([], row, 0)).toBe(false);
  });

  it('加载期剪枝剔除复活回流行，removedKeys 含 key 与 id 双列供真表删除', () => {
    const tombs = [tombOf({ username: 'purA', no: 'AAAA1111', name: '甲公司', deletedAt: Date.parse('2026/10/01') })];
    const bound = [
      { key: 'bp-app-1', id: 'BIND-aaa111', purchaserUsername: 'purA', purchaserName: '甲公司', bindDate: '2026-09-01' },
      // 删除后重新建立的合作：bindDate 晚于 deletedAt，必须保留
      { key: 'bp-ps-purA', id: 'BIND-aaa222', purchaserUsername: 'purA', purchaserName: '甲公司', bindDate: '2026-11-01' },
      { key: 'bp-ps-purB', id: 'BIND-bbb111', purchaserUsername: 'purB', purchaserName: '乙公司', bindDate: '2026-09-01' },
    ];
    const res = pruneTombstonedBound(bound, tombs);
    expect(res.list.map((r: any) => r.key)).toEqual(['bp-ps-purA', 'bp-ps-purB']);
    expect(res.removedKeys.sort()).toEqual(['BIND-aaa111', 'bp-app-1']);
    // 无墓碑时原样返回，不产生删除申报
    expect(pruneTombstonedBound(bound, [])).toEqual({ list: bound, removedKeys: [] });
  });

  it('同日先删除后重新合作不被误剪：statusTs 优先，日粒度 bindDate 的已合作行让位', () => {
    const now = Date.now();
    const d = new Date(now);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tombs = [tombOf({ username: 'purA', deletedAt: now - 3_600_000 })];
    const bound = [
      // 重新合作写点刷新了 statusTs（晚于删除）
      { key: 'k1', id: 'i1', purchaserUsername: 'purA', status: 'approved', bindDate: today, statusTs: now },
      // 链接/邀约确认路径只刷新 bindDate（日粒度）且无 statusTs：同日已合作行让位
      { key: 'k2', id: 'i2', purchaserUsername: 'purA', status: 'approved', bindDate: today },
      // 派生复活回流行：已解除且无 statusTs → 必须剪掉
      { key: 'k3', id: 'i3', purchaserUsername: 'purA', status: 'terminated', bindDate: today },
    ];
    const res = pruneTombstonedBound(bound, tombs);
    expect(res.list.map((r: any) => r.key)).toEqual(['k1', 'k2']);
    expect(res.removedKeys.sort()).toEqual(['i3', 'k3']);
  });

  it('同一主体重复删除只刷新 deletedAt，不堆叠墓碑行（删除→重新合作→再删除不失效）', () => {
    appendCustomerDelTomb(OWNER, { username: 'purA', no: 'AAAA1111', name: '甲公司' });
    // 模拟中间那次重新合作之后的旧墓碑时刻
    const key = customerDelTombKey(OWNER);
    const stale = JSON.parse(localStorage.getItem(key) || '[]');
    stale[0].deletedAt = Date.now() - 100_000;
    localStorage.setItem(key, JSON.stringify(stale));
    appendCustomerDelTomb(OWNER, { username: 'purA', name: '甲公司新名' });
    const tombs = loadCustomerDelTombs(OWNER);
    expect(tombs.length).toBe(1);
    expect(tombs[0].deletedAt).toBeGreaterThan(Date.now() - 5_000);
    expect(tombs[0].name).toBe('甲公司新名');
    expect(tombs[0].no).toBe('AAAA1111');
  });

  it('空凭证不登记；损坏/无删除时间的存量行读回时过滤', () => {
    appendCustomerDelTomb(OWNER, {});
    expect(loadCustomerDelTombs(OWNER)).toEqual([]);
    const key = customerDelTombKey(OWNER);
    localStorage.setItem(key, '{not json');
    expect(loadCustomerDelTombs(OWNER)).toEqual([]);
    localStorage.setItem(key, JSON.stringify([null, { id: 'x', deletedAt: 0 }, tombOf({ username: 'purB' })]));
    expect(loadCustomerDelTombs(OWNER).map(t => t.username)).toEqual(['purB']);
  });
});