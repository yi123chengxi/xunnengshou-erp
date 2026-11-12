// 订单占用单测：锁定「占用判据 / 身份键归一 / 快照未落地不得回 0」三条不变量，
// 对应线上「订单占用有时有值有时没值」的漂移缺陷
import {
  isOccupyingOrder, isBalancePayOrder, ordersSnapshotLoaded, buildOrderOccupiedMap,
  createOccupiedAmountResolver, getOrderOccupiedList, syncOrderReserved,
} from '../orderOccupied';
import { productListKey } from '../dataStore';

const OWNER = 'occ-test-owner';
const ORDER_KEY = `pageData_sales_order-manage_${OWNER}`;

/** 播种：甲公司（u1，经历两次改名）两笔在途余额支付订单 + 路人乙的已发货/非余额/已取消各一笔 */
const seedOrders = (orders: any[]) => {
  localStorage.clear();
  localStorage.setItem('registeredUsers', JSON.stringify([
    { username: 'u1', companyName: '甲公司新名', companyShortName: '甲公司', companyNo: 'N1' },
  ]));
  localStorage.setItem('company_renames', JSON.stringify([
    { key: 'k1', username: 'u1', oldName: '甲公司旧名', newName: '中间甲公司', ts: 1000 },
    { key: 'k2', username: 'u1', oldName: '中间甲公司', newName: '甲公司新名', ts: 2000 },
  ]));
  localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
};

const OCCUPYING = [
  { id: 'A1', customerName: '甲公司旧名', orderStatus: '已审核待发货', payMethod: '余额支付', productAmount: 100, createTime: '2026-01-02 10:00:00', orderItems: JSON.stringify([{ productCode: 'P1', quantity: 2 }]) },
  { id: 'A2', customerName: '甲公司新名', orderStatus: '已审核待发货', payMethod: '余额支付', productAmount: 50, createTime: '2026-01-03 10:00:00', orderItems: JSON.stringify([{ productCode: 'P1', quantity: 3 }]) },
  { id: 'B1', customerName: '路人乙', orderStatus: '已发货', payMethod: '余额支付', productAmount: 999, createTime: '2026-01-04 10:00:00', orderItems: '[]' },
  { id: 'B2', customerName: '路人乙', orderStatus: '已审核待发货', payMethod: '微信支付', productAmount: 700, createTime: '2026-01-04 10:00:00', orderItems: '[]' },
  { id: 'C1', customerName: '路人乙', orderStatus: '已审核待发货', auditStatus: '已取消', payMethod: '余额支付', productAmount: 800, createTime: '2026-01-05 10:00:00', orderItems: '[]' },
];

beforeEach(() => seedOrders(OCCUPYING));

describe('占用态判据', () => {
  it('已发货/已完成/待付款/已取消/空状态均不占用', () => {
    ['已发货', '已完成', '待付款', '已取消', ''].forEach(st => {
      expect(isOccupyingOrder({ orderStatus: st })).toBe(false);
    });
  });

  it('取消订单只改 auditStatus 也必须停止占用（旧判据漏网导致额度被幽灵订单吃掉）', () => {
    expect(isOccupyingOrder({ orderStatus: '已审核待发货', auditStatus: '已取消' })).toBe(false);
  });

  it('在途状态占用', () => {
    ['已审核待发货', '已审核待生产', '已审核待财审', '待发货'].forEach(st => {
      expect(isOccupyingOrder({ orderStatus: st, auditStatus: '' })).toBe(true);
    });
  });

  it('余额支付识别兼容 payMethod 与订单标签两种写法', () => {
    expect(isBalancePayOrder({ payMethod: '余额支付' })).toBe(true);
    expect(isBalancePayOrder({ payMethod: ' 余额支付 ' })).toBe(true);
    expect(isBalancePayOrder({ orderTags: '余额支付,加急' })).toBe(true);
    expect(isBalancePayOrder({ payMethod: '微信支付' })).toBe(false);
    expect(isBalancePayOrder(null)).toBe(false);
  });
});

describe('订单快照落地状态', () => {
  it('键不存在=未加载，空数组=已加载（0 才是可信值）', () => {
    expect(ordersSnapshotLoaded(OWNER)).toBe(true);
    localStorage.removeItem(ORDER_KEY);
    expect(ordersSnapshotLoaded(OWNER)).toBe(false);
  });
});

describe('createOccupiedAmountResolver 身份键聚合', () => {
  it('同一主体新旧名称快照只计一次且合计正确', () => {
    const r = createOccupiedAmountResolver(OWNER);
    expect(r.loaded).toBe(true);
    expect(r.of('甲公司新名')).toBe(150);
    expect(r.of('甲公司旧名')).toBe(150);
    expect(r.of('甲公司')).toBe(150); // 简称同样命中
    expect(r.of('甲公司新名', '甲公司旧名')).toBe(150); // 多别名不得翻倍
  });

  it('未发货的非余额支付/已取消订单不计入', () => {
    expect(createOccupiedAmountResolver(OWNER).of('路人乙')).toBe(0);
  });

  it('快照未加载时 loaded=false，调用方据此拒绝渲染 0', () => {
    localStorage.removeItem(ORDER_KEY);
    const r = createOccupiedAmountResolver(OWNER);
    expect(r.loaded).toBe(false);
    expect(r.of('甲公司新名')).toBe(0);
  });

  it('名称不同源（含空白/未注册主体）也能按折叠名命中', () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify([{ id: 'D1', customerName: '  路人丙  ', orderStatus: '已审核待发货', payMethod: '余额支付', productAmount: 66 }]));
    const r = createOccupiedAmountResolver(OWNER);
    expect(r.of('路人丙')).toBe(66);
  });

  it('空名称/未知名称返回 0 不抛错', () => {
    const r = createOccupiedAmountResolver(OWNER);
    expect(r.of('')).toBe(0);
    expect(r.of(undefined)).toBe(0);
    expect(r.of('查无此主体')).toBe(0);
  });
});

describe('getOrderOccupiedList 明细与列表同源', () => {
  it('按改名链归集同一主体的全部占用订单，排除已发货/非余额/已取消', () => {
    const rows = getOrderOccupiedList(OWNER, '甲公司新名');
    expect(rows).toHaveLength(2);
    expect(rows.map(x => x.orderId).sort()).toEqual(['A1', 'A2']);
    expect(rows[0].orderId).toBe('A2'); // 按创建时间倒序
  });

  it('路人乙的已取消订单不得出现在明细里（旧实现列表有值、明细为空的根源）', () => {
    expect(getOrderOccupiedList(OWNER, '路人乙')).toHaveLength(0);
  });

  it('空客户名返回空列表', () => {
    expect(getOrderOccupiedList(OWNER, '')).toHaveLength(0);
  });
});

describe('buildOrderOccupiedMap 数量占用', () => {
  it('按商品编码汇总在途数量，排除指定订单', () => {
    expect(buildOrderOccupiedMap(OWNER)['P1']).toBe(5);
    expect(buildOrderOccupiedMap(OWNER, ['A1'])['P1']).toBe(3);
  });

  it('已取消订单不计入数量占用', () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify([
      { id: 'C1', orderStatus: '已审核待发货', auditStatus: '已取消', orderItems: JSON.stringify([{ productCode: 'P9', quantity: 7 }]) },
    ]));
    expect(buildOrderOccupiedMap(OWNER)['P9'] || 0).toBe(0);
  });
});

describe('syncOrderReserved 回写护栏', () => {
  it('快照未加载时禁止把占用字段全量清 0', () => {
    localStorage.setItem(productListKey(OWNER), JSON.stringify([{ productCode: 'P1', orderReserved: 5 }]));
    localStorage.removeItem(ORDER_KEY);
    syncOrderReserved(OWNER);
    expect(JSON.parse(localStorage.getItem(productListKey(OWNER)) || '[]')[0].orderReserved).toBe(5);
  });

  it('快照已加载时按汇总值回写', () => {
    localStorage.setItem(productListKey(OWNER), JSON.stringify([{ productCode: 'P1', orderReserved: 99 }]));
    syncOrderReserved(OWNER);
    expect(JSON.parse(localStorage.getItem(productListKey(OWNER)) || '[]')[0].orderReserved).toBe(5);
  });
});
