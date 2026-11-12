// 订单行「不丢不重」单测：锁定本次「订单管理只剩一条订单」事故的两条回归不变量
// 1) 本地被写成空基（"[]"）时必须判定为「无数据」，否则拉取循环永久锁死，再也回不来服务端全量副本
// 2) 订单取号必须覆盖全量落盘数据，筛选/分页态下不得取到重号（MC 号是订单主键，重号即串改他单）
import { localDatasetHasRows } from '../serverSync';
import { nextOrderIdFrom, collectOrderIdsForAlloc } from '../orderOccupied';

const OWNER = 'order-integrity-owner';
const ORDER_KEY = `pageData_sales_order-manage_${OWNER}`;

describe('本地数据集是否有行（空基判定）', () => {
  it('键不存在 / 空串 / "[]" / "null" 均视为空基，必须回拉服务端副本', () => {
    expect(localDatasetHasRows(null)).toBe(false);
    expect(localDatasetHasRows('')).toBe(false);
    expect(localDatasetHasRows('[]')).toBe(false);
    expect(localDatasetHasRows('null')).toBe(false);
  });

  it('含至少一行的数组视为有数据', () => {
    expect(localDatasetHasRows('[{"id":"MC000001"}]')).toBe(true);
  });

  it('非数组对象保留原语义（有数据），空对象字符串不误判', () => {
    expect(localDatasetHasRows('{"a":1}')).toBe(true);
    expect(localDatasetHasRows('""')).toBe(false);
  });

  it('非法 JSON 回退按长度判定，不因解析异常误判为空基', () => {
    expect(localDatasetHasRows('{bad json')).toBe(true);
  });
});

describe('订单编号取号', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无历史订单时从 MC000001 起号，且仅识别 MC 号', () => {
    expect(nextOrderIdFrom([])).toBe('MC000001');
    expect(nextOrderIdFrom(['', 'SO20240101', undefined, null])).toBe('MC000001');
    expect(nextOrderIdFrom(['MC000007', 'MC000012', 'MC000003'])).toBe('MC000013');
  });

  it('取号包含全量落盘数据：列表被筛空时仍取到真实最大号 +1，不产生重号', () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify([
      { id: 'MC000001' }, { id: 'MC000002' }, { id: 'MC000030' },
    ]));
    // 模拟「筛选后列表只剩一条」与「列表完全筛空」两种取号现场
    expect(nextOrderIdFrom(collectOrderIdsForAlloc(OWNER, ['MC000002']))).toBe('MC000031');
    expect(nextOrderIdFrom(collectOrderIdsForAlloc(OWNER, []))).toBe('MC000031');
  });

  it('列表中出现落盘数据没有的更大号时以更大号为准', () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify([{ id: 'MC000005' }]));
    expect(nextOrderIdFrom(collectOrderIdsForAlloc(OWNER, ['MC000009']))).toBe('MC000010');
  });

  it('落盘数据损坏（非数组/非法 JSON）时不抛异常，退化为按列表取号', () => {
    localStorage.setItem(ORDER_KEY, 'not-json');
    expect(nextOrderIdFrom(collectOrderIdsForAlloc(OWNER, ['MC000004']))).toBe('MC000005');
    localStorage.setItem(ORDER_KEY, '{}');
    expect(nextOrderIdFrom(collectOrderIdsForAlloc(OWNER, []))).toBe('MC000001');
  });
});
