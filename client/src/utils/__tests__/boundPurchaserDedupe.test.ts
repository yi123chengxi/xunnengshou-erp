// 供应商侧客户列表（boundPurchasers_）同源重复行去重单测：
// 锁定「同一采购商在客户基础信息显示两行、且只有一个浏览器出现」的事故不变量
// 1) 带账号/编号的主条目优先，缺 purchaserUsername 的历史行被归并吸收；
// 2) 终止态单调：重复条目里的「已合作」不得覆盖「已解除」；
// 3) 被合并掉的旧行必须随上传申报 removedIds（服务端永不缩水键按 key || id 匹配，两列都要申报）；
// 4) 不同采购商账号不得因公司名相同被误并。
import { dedupeBoundPurchasers } from '../boundPurchaserDedupe';
import { takeRemovedIds } from '../shrinkRegistry';

const SUPPLIER = 'main-supplier';
const PURCHASER = 'purchaser-abcngx60';
const COMPANY = '瑞安市诺莱德鞋业有限公司';
const BOUND_KEY = `boundPurchasers_${SUPPLIER}`;

const seedUsers = (extra: any[] = []) => {
  localStorage.setItem('registeredUsers', JSON.stringify([
    { username: SUPPLIER, companyName: '温州某鞋业有限公司', companyNo: 'S001' },
    { username: PURCHASER, companyName: COMPANY, companyNo: '68509CIK' },
    ...extra,
  ]));
};

const readBound = () => JSON.parse(localStorage.getItem(BOUND_KEY) || '[]');

describe('供应商客户列表同源重复行去重', () => {
  beforeEach(() => {
    localStorage.clear();
    takeRemovedIds(BOUND_KEY); // 删除申报登记表是模块级内存，跨用例需手动清空
    localStorage.setItem('username', SUPPLIER);
    seedUsers();
  });

  it('审批写入的 BIND-<时间戳>（缺账号）与派生补入的 BIND-<账号后6位> 归并为一行', () => {
    localStorage.setItem(BOUND_KEY, JSON.stringify([
      {
        key: 'bp-1793602530880', id: 'BIND-1793602530880', purchaserName: COMPANY,
        purchaserContact: '林法燕', purchaserPhone: '13401018481', bindDate: '2026-01-05', status: 'approved',
      },
      {
        key: `bp-ps-${PURCHASER}`, id: `BIND-${PURCHASER.slice(-6)}`, purchaserName: COMPANY,
        purchaserUsername: PURCHASER, bindDate: '2026-02-11', status: 'approved',
      },
    ]));

    expect(dedupeBoundPurchasers(SUPPLIER)).toBe(true);
    const list = readBound();
    expect(list).toHaveLength(1);
    // 保留带采购商账号的主条目，并吸收另一行的联系人/电话与更早的合作起始日
    expect(list[0].purchaserUsername).toBe(PURCHASER);
    expect(list[0].id).toBe(`BIND-${PURCHASER.slice(-6)}`);
    expect(list[0].purchaserContact).toBe('林法燕');
    expect(list[0].purchaserPhone).toBe('13401018481');
    expect(list[0].bindDate).toBe('2026-01-05');
    // 被合并行的 key 与 id 都要申报，否则服务端并集会把旧行复活
    expect(takeRemovedIds(BOUND_KEY)?.sort()).toEqual(['BIND-1793602530880', 'bp-1793602530880']);
    // 幂等：第二遍不再产生变更
    expect(dedupeBoundPurchasers(SUPPLIER)).toBe(false);
  });

  it('重复条目里的「已合作」不得把已解除覆盖回已合作', () => {
    localStorage.setItem(BOUND_KEY, JSON.stringify([
      {
        key: 'bp-1', id: 'BIND-1', purchaserName: COMPANY, purchaserUsername: PURCHASER,
        bindDate: '2026-01-05', status: 'terminated', statusTs: 100, terminateAt: 200, terminateBy: 'supplier',
      },
      {
        key: 'bp-2', id: 'BIND-2', purchaserName: COMPANY, purchaserUsername: PURCHASER,
        bindDate: '2026-03-01', status: 'approved', statusTs: 300,
      },
    ]));

    expect(dedupeBoundPurchasers(SUPPLIER)).toBe(true);
    const list = readBound();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('terminated');
    expect(list[0].terminateAt).toBe(200);
    expect(list[0].terminateBy).toBe('supplier');
  });

  it('公司名相同但采购商账号不同的两条记录不得被误并', () => {
    seedUsers([{ username: 'purchaser-other', companyName: COMPANY, companyNo: '68509CIK' }]);
    localStorage.setItem(BOUND_KEY, JSON.stringify([
      { key: 'bp-1', id: 'BIND-1', purchaserName: COMPANY, purchaserUsername: PURCHASER, bindDate: '2026-01-05', status: 'approved' },
      { key: 'bp-2', id: 'BIND-2', purchaserName: COMPANY, purchaserUsername: 'purchaser-other', bindDate: '2026-01-06', status: 'approved' },
    ]));

    expect(dedupeBoundPurchasers(SUPPLIER)).toBe(false);
    expect(readBound()).toHaveLength(2);
    expect(takeRemovedIds(BOUND_KEY)).toBeUndefined();
  });
});
