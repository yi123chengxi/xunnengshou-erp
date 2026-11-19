// 对账记录去重原语单测：锁定「同单号+双方名称的存活重复副本只保留最完整一条、
// 其余转墓碑」这条不变量。服务端并集只增不删，重复副本只能靠墓碑传播全端隐藏，
// 该原语是对账管理列表去重的唯一入口（挂载/查询/同步事件三处共用）。
import { dedupeLiveRecords, reconDupKey } from '../reconStore';

const rec = (over: Record<string, any> = {}): any => ({
  key: 'k1', docNo: '99151', supplierName: '甲公司', customerName: '乙公司',
  initiator: 'supplier', reconResult: 'pending', ...over,
});

describe('去重键', () => {
  it('单号+双方名称归一：大小写与首尾空格不影响', () => {
    expect(reconDupKey(rec())).toBe(reconDupKey(rec({ docNo: ' 99151 ', supplierName: '甲公司' })));
  });

  it('同号不同对手方不算重复（防误并手动录入）', () => {
    expect(reconDupKey(rec())).not.toBe(reconDupKey(rec({ customerName: '丙公司' })));
  });

  it('仅有 counterparty 快照时按发起方语义回退，与显式双方名称同键', () => {
    expect(reconDupKey(rec({ initiator: 'supplier', counterparty: '乙公司', customerName: undefined })))
      .toBe(reconDupKey(rec()));
  });
});

describe('存活记录去重', () => {
  it('重复副本只保留一条，其余转墓碑且指向保留键', () => {
    const { kept, tombs } = dedupeLiveRecords([rec(), rec({ key: 'k2' })]);
    expect(kept.filter((r: any) => !r.delisted)).toHaveLength(1);
    expect(tombs).toHaveLength(1);
    expect(tombs[0].delisted).toBe(true);
    expect(tombs[0].dedupOf).toBe(kept.find((r: any) => r.key === 'k1' || r.key === 'k2')!.key);
  });

  it('保留完整度更高的一条（有关联账单键优先）', () => {
    const { kept, tombs } = dedupeLiveRecords([rec(), rec({ key: 'k2', matchedBillKey: 'bill-1', details: [{ itemNo: 'a' }] })]);
    const live = kept.filter((r: any) => !r.delisted);
    expect(live[0].key).toBe('k2');
    expect(tombs[0].key).toBe('k1');
  });

  it('墓碑行不参与去重且原样保留在 kept', () => {
    const { kept, tombs } = dedupeLiveRecords([rec(), rec({ key: 'k2', delisted: true })]);
    expect(tombs).toHaveLength(0);
    expect(kept).toHaveLength(2);
  });

  it('无重复时零墓碑（幂等，不改动正常数据）', () => {
    const { kept, tombs } = dedupeLiveRecords([rec(), rec({ key: 'k2', docNo: '99152' })]);
    expect(tombs).toHaveLength(0);
    expect(kept).toHaveLength(2);
  });
});
