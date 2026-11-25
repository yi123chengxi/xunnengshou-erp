// 合作申请跨租户凭证单测：锁定「同一家公司注册多个账号」「公司名称互为子串」两类串号事故
// 根因：cooperation_applications 是全局共享键（服务端按 id 并集合并，keyOwner 返回 null），
// 所有租户浏览器都持有同一份记录，可见性/可审批性完全由前端判定。
// 旧判定用公司名称双向 includes + 无身份守卫，因此：
//   1) 同名多账号都会看到同一份申请，而且都能点同意；
//   2) 「XX 公司」与「XX 公司二分厂」互相认错目标供应商。
// 现判定一律以注册时生成并去重的 companyNo 等值为准，名称只在解析不到编号时兜底且只做全等。
import {
  noOfUser, noFromCompanyName, usernameFromNo, supplierNoOf, purchaserNoOf,
  amTargetSupplier, isTargetSupplierApp, appMatchesSupplierEntry,
  withCooperationCreds, migrateCooperationCreds, findUserByNoOrUniqueName,
  uniqueCompanyRootByName, uniqueUserByName, rootOfUsername,
} from '../cooperationCred';

const APPS_KEY = 'cooperation_applications';

// 甲贸易注册了两个账号（同公司名、不同编号），外加名称互为子串的二分厂
const USERS = [
  { username: 'p-supplier-1', companyName: '甲贸易有限公司', companyNo: 'A001' },
  { username: 'p-supplier-2', companyName: '甲贸易有限公司', companyNo: 'A002' },
  { username: 's-branch', companyName: '乙皮料公司二分厂', companyNo: 'B102' },
  { username: 's-main', companyName: '乙皮料公司', companyNo: 'B101' },
  { username: 'no-number', companyName: '丙百货商店' }, // 老账号：只有简称
];

const seed = (me: string) => {
  localStorage.clear();
  localStorage.setItem('username', me);
  localStorage.setItem('isSubAccount', 'false');
  localStorage.setItem('registeredUsers', JSON.stringify(USERS));
};

describe('公司编号解析', () => {
  beforeEach(() => seed('p-supplier-1'));

  it('老账号无 companyNo 时回退 companyShortName', () => {
    expect(noOfUser({ companyNo: 'A001' })).toBe('A001');
    expect(noOfUser({ companyShortName: 'C900' })).toBe('C900');
    expect(noOfUser({})).toBe('');
  });

  it('按公司名取编号遇到同名多账号必须返回空，不能 find-first 认错租户', () => {
    expect(noFromCompanyName('乙皮料公司')).toBe('B101');
    expect(noFromCompanyName('甲贸易有限公司')).toBe('');
    expect(noFromCompanyName('不存在的公司')).toBe('');
  });

  it('按编号取账号同样只在唯一命中时返回', () => {
    expect(usernameFromNo('B102')).toBe('s-branch');
    expect(usernameFromNo('')).toBe('');
    expect(usernameFromNo('ZZZZ')).toBe('');
  });
});

describe('申请记录归属判定（供应商侧）', () => {
  it('同名公司的两个账号只有被点名的那个编号能看见并可处理申请', () => {
    const app = {
      applicationId: 'COOP-1', purchaserUsername: 's-main', purchaserCompanyName: '乙皮料公司',
      targetSupplierName: '甲贸易有限公司', targetSupplierId: 'p-supplier-2', status: 'pending',
    };
    // 申请是按编号 A002 发起的，A001 账号看不到
    seed('p-supplier-1');
    expect(amTargetSupplier({ ...app, targetSupplierNo: 'A002' })).toBe(false);
    seed('p-supplier-2');
    expect(amTargetSupplier({ ...app, targetSupplierNo: 'A002' })).toBe(true);
  });

  it('无编号的历史记录：名称唯一命中才兜底，同名歧义时双方都不可见，绝不做子串匹配', () => {
    const legacy = { targetSupplierName: '甲贸易有限公司', purchaserCompanyName: '乙皮料公司' };
    seed('s-branch'); // 乙皮料公司二分厂：名称是「乙皮料公司」的子串，但不是本条记录的目标
    expect(amTargetSupplier(legacy)).toBe(false);
    // 甲贸易有限公司有两个相互独立的账号（A001/A002）→ 歧义，
    // 谁都不能认领这条无编号历史申请（否则同名新账号会点同意并把自己写进发起方目录）
    seed('p-supplier-1');
    expect(amTargetSupplier(legacy)).toBe(false);
    seed('p-supplier-2');
    expect(amTargetSupplier(legacy)).toBe(false);
    // 名称全库唯一且该主体无编号（老账号）时，名称档仍兜底放行
    const legacyNoNumber = { targetSupplierName: '丙百货商店' };
    seed('no-number');
    expect(amTargetSupplier(legacyNoNumber)).toBe(true);
    seed('s-main');
    expect(amTargetSupplier(legacyNoNumber)).toBe(false);
  });

  it('显式传参版按 owner/编号/名称逐级判定，供模块级函数复用', () => {
    const app = { targetSupplierNo: 'B101', targetSupplierName: '乙皮料公司', supplierUsername: 's-main' };
    expect(isTargetSupplierApp(app, { no: 'B102', company: '乙皮料公司二分厂' })).toBe(false);
    expect(isTargetSupplierApp(app, { no: 'B101', company: '乙皮料公司' })).toBe(true);
    expect(isTargetSupplierApp(app, { owner: 's-main' })).toBe(true);
    // 编号解析不到时不放行全部
    expect(isTargetSupplierApp({}, { no: 'B101', company: '乙皮料公司' })).toBe(false);
  });

  it('supplierNoOf 兼容账号/编号/条目名三种历史写法', () => {
    seed('p-supplier-1');
    expect(supplierNoOf({ supplierUsername: 's-main' })).toBe('B101');
    expect(supplierNoOf({ targetSupplierNo: 'B102' })).toBe('B102');
    expect(supplierNoOf({ targetSupplierName: '乙皮料公司' })).toBe('B101');
    expect(purchaserNoOf({ purchaserUsername: 's-main' })).toBe('B101');
    expect(purchaserNoOf({ purchaserCompanyName: '甲贸易有限公司' })).toBe('');
  });
});

describe('写入点补凭证', () => {
  beforeEach(() => seed('p-supplier-1'));

  it('只填空缺字段，不覆盖调用方已写好的编号', () => {
    const out: any = withCooperationCreds(
      { targetSupplierNo: 'B101', purchaserNo: 'A001', supplierUsername: 's-main' },
      { supplierNo: 'B102', purchaserNo: 'A002' }
    );
    expect(out.targetSupplierNo).toBe('B101');
    expect(out.purchaserNo).toBe('A001');
  });

  it('缺字段时按显式提示 > 账号 > 名称唯一命中依次推导', () => {
    const a: any = withCooperationCreds({ supplierUsername: 's-main', purchaserCompanyName: '乙皮料公司' });
    expect(a.targetSupplierNo).toBe('B101');
    expect(a.purchaserNo).toBe('B101');
    const b: any = withCooperationCreds({ targetSupplierName: '甲贸易有限公司' });
    expect(b.targetSupplierNo).toBe(''); // 同名歧义：宁缺毋滥
  });
});

describe('申请记录 ↔ 供应商条目 同一性判定', () => {
  beforeEach(() => seed('p-supplier-1'));

  it('编号等值优先，同名不同编号的两张卡片不会互相认错', () => {
    const entryA = { id: 'SP-1', supplierName: '乙皮料公司', supplierNo: 'B101' };
    const entryB = { id: 'SP-2', supplierName: '乙皮料公司', supplierNo: 'B102' };
    const app = { targetSupplierNo: 'B101', targetSupplierName: '乙皮料公司' };
    expect(appMatchesSupplierEntry(app, entryA)).toBe(true);
    expect(appMatchesSupplierEntry(app, entryB)).toBe(false);
  });

  it('条目没有编号时退回条目 id，再退回名称全等', () => {
    const entry = { id: 'SP-9', supplierName: '乙皮料公司' };
    expect(appMatchesSupplierEntry({ targetSupplierId: 'SP-9' }, entry)).toBe(true);
    expect(appMatchesSupplierEntry({ targetSupplierName: '乙皮料公司' }, entry)).toBe(true);
    expect(appMatchesSupplierEntry({ targetSupplierName: '乙皮料公司二分厂' }, entry)).toBe(false);
    expect(appMatchesSupplierEntry({}, entry)).toBe(false);
  });

  it('名称档遇同名两家公司时一律不认，不得把别人的申请归到本方卡片', () => {
    const entry = { id: 'SP-10', supplierName: '甲贸易有限公司' };
    expect(appMatchesSupplierEntry({ targetSupplierName: '甲贸易有限公司' }, entry)).toBe(false);
    // 编号存在时不受名称歧义影响
    expect(appMatchesSupplierEntry({ targetSupplierNo: 'A002' }, { ...entry, supplierNo: 'A002' })).toBe(true);
  });
});

describe('档案回填时的账号定位', () => {
  beforeEach(() => seed('p-supplier-1'));

  it('编号唯一命中优先于名称，同名两账号能分清到底是哪一家', () => {
    expect(findUserByNoOrUniqueName('A002', '甲贸易有限公司')?.username).toBe('p-supplier-2');
    expect(findUserByNoOrUniqueName('A001', '甲贸易有限公司')?.username).toBe('p-supplier-1');
  });

  it('无编号且同名多账号时返回 null，不得 find-first 把别家银行账户当成本方供应商的', () => {
    expect(findUserByNoOrUniqueName('', '甲贸易有限公司')).toBeNull();
  });

  it('名称唯一命中时正常返回，编号不存在则退回名称档', () => {
    expect(findUserByNoOrUniqueName('', '乙皮料公司')?.username).toBe('s-main');
    expect(findUserByNoOrUniqueName('ZZZZ', '乙皮料公司')?.username).toBe('s-main');
  });

  it('编号与名称都拿不到时返回 null', () => {
    expect(findUserByNoOrUniqueName('', '')).toBeNull();
    expect(findUserByNoOrUniqueName(undefined, undefined)).toBeNull();
  });
});

describe('名称唯一主体解析（写入侧替代 find-first）', () => {
  it('同名两家独立公司返回空，主/子账号同主体不算歧义', () => {
    seed('p-supplier-1');
    expect(uniqueCompanyRootByName('甲贸易有限公司')).toBe('');
    expect(uniqueUserByName('甲贸易有限公司')).toBeNull();
    expect(uniqueCompanyRootByName('乙皮料公司')).toBe('s-main');
    expect(uniqueUserByName('乙皮料公司')?.username).toBe('s-main');
    expect(uniqueCompanyRootByName('不存在的公司')).toBe('');
    // 子账号继承主账号公司名：同一主体，不得判为歧义
    localStorage.setItem('registeredUsers', JSON.stringify([
      ...USERS,
      { username: 's-main-sub', companyName: '乙皮料公司', companyNo: 'B101', isSubAccount: true, parentAccount: 's-main' },
    ]));
    expect(uniqueCompanyRootByName('乙皮料公司')).toBe('s-main');
    expect(rootOfUsername('s-main-sub')).toBe('s-main');
  });
});

describe('存量数据补凭证', () => {
  it('按账号/条目编号/名称唯一命中三种来源补齐，解析不到的保持为空', () => {
    seed('p-supplier-1');
    localStorage.setItem('purchaser_suppliers_s-main', JSON.stringify([
      { id: 'SP-7', supplierNo: 'A002', supplierName: '甲贸易有限公司' },
    ]));
    localStorage.setItem(APPS_KEY, JSON.stringify([
      { applicationId: 'X1', supplierUsername: 's-branch', purchaserUsername: 's-main' },
      { applicationId: 'X2', targetSupplierId: 'SP-7', purchaserUsername: 's-main' },
      { applicationId: 'X3', targetSupplierName: '乙皮料公司' },
      { applicationId: 'X4', targetSupplierName: '甲贸易有限公司' }, // 同名歧义，补不出
    ]));
    migrateCooperationCreds();
    migrateCooperationCreds(); // 幂等：第二次不应重复改动或报错
    const apps = JSON.parse(localStorage.getItem(APPS_KEY) || '[]');
    expect(apps[0].targetSupplierNo).toBe('B102');
    expect(apps[0].purchaserNo).toBe('B101');
    expect(apps[1].targetSupplierNo).toBe('A002');
    expect(apps[2].targetSupplierNo).toBe('B101');
    expect(apps[3].targetSupplierNo).toBeUndefined();
  });

  it('已有编号的记录不被覆盖', () => {
    seed('p-supplier-1');
    localStorage.setItem(APPS_KEY, JSON.stringify([
      { applicationId: 'X1', targetSupplierNo: 'A001', supplierUsername: 's-branch' },
    ]));
    migrateCooperationCreds();
    const apps = JSON.parse(localStorage.getItem(APPS_KEY) || '[]');
    expect(apps[0].targetSupplierNo).toBe('A001');
  });
});
