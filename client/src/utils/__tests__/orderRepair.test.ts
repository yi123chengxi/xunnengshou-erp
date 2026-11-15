import { repairOrderBucket } from '../orderRepair';

describe('orderRepair.repairOrderBucket', () => {
  it('完全重复行（同 key）去重并申报移除', () => {
    const rows = [
      { key: 'k1', id: 'MC000001', createTime: '2026-11-12 17:58:18' },
      { key: 'k1', id: 'MC000001', createTime: '2026-11-12 17:58:18' },
      { key: 'k2', id: 'MC000002', createTime: '2026-11-12 19:47:53' },
    ];
    const rep = repairOrderBucket(rows);
    expect(rep.rows).toHaveLength(2);
    expect(rep.removedKeys).toEqual(['k1']);
    expect(rep.renumbered).toEqual([]);
  });

  it('编号撞号：最近更新者保留编号，其余改派空闲号', () => {
    const rows = [
      { key: 'k-old', id: 'MC000002', createTime: '2026-11-07 16:23:42' },
      { key: 'k-mid', id: 'MC000002', createTime: '2026-11-12 19:47:53' },
      { key: 'k-new', id: 'MC000002', createTime: '2026-11-15 13:00:06' },
      { key: 'k-10', id: 'MC000010', createTime: '2026-11-12 13:55:31' },
    ];
    const rep = repairOrderBucket(rows);
    expect(rep.rows).toHaveLength(4);
    const byKey = new Map(rep.rows.map(r => [r.key, r.id]));
    expect(byKey.get('k-new')).toBe('MC000002'); // 最近更新保留原号
    expect(byKey.get('k-mid')).toBe('MC000011');
    expect(byKey.get('k-old')).toBe('MC000012');
    expect(rep.renumbered).toHaveLength(2);
  });

  it('拆分派生号 MC000006-1 不参与撞号重编号', () => {
    const rows = [
      { key: 'k6', id: 'MC000006', createTime: '2026-11-11 15:32:14' },
      { key: 'k61', id: 'MC000006-1', createTime: '2026-11-11 15:38:53' },
    ];
    const rep = repairOrderBucket(rows);
    expect(rep.renumbered).toEqual([]);
    expect(rep.rows.map(r => r.id)).toEqual(['MC000006', 'MC000006-1']);
  });

  it('空输入与无重复输入原样返回', () => {
    expect(repairOrderBucket([]).rows).toEqual([]);
    const rows = [{ key: 'a', id: 'MC000001' }, { key: 'b', id: 'MC000002' }];
    const rep = repairOrderBucket(rows);
    expect(rep.rows).toHaveLength(2);
    expect(rep.removedKeys).toEqual([]);
    expect(rep.renumbered).toEqual([]);
  });
});
