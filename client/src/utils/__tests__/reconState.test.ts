// 账单对账状态与可操作性单测：锁定「按钮判据 = 逻辑校验」这条不变量，
// 并覆盖已入账行金额锁定（批次2）与行状态自愈两条容易被订单重建破坏的规则
import {
  RECON_BOOKED, RECON_IN_FLIGHT, RECON_PENDING, reconStateOf, isBookedRow, isOrderDerived,
  orderStatusOkForRecon, canInitRecon, canConfirmBill, canWithdrawRecon,
  resolveBillAmountFields, deriveReconState,
} from '../reconState';

const bill = (over: Record<string, any> = {}): any => ({
  id: 'ORD-1', billSource: '订单', orderStatus: '已完成', reconResult: RECON_PENDING, totalAmount: 1000, ...over,
});

describe('状态归一', () => {
  it('空状态视为待对账', () => {
    expect(reconStateOf({})).toBe(RECON_PENDING);
    expect(reconStateOf({ reconResult: '  ' })).toBe(RECON_PENDING);
    expect(reconStateOf(bill({ reconResult: RECON_IN_FLIGHT }))).toBe(RECON_IN_FLIGHT);
  });

  it('三个终态都算已入账（旧实现只认按采方入账）', () => {
    RECON_BOOKED.forEach(st => expect(isBookedRow(bill({ reconResult: st }))).toBe(true));
    expect(isBookedRow(bill({ reconResult: RECON_IN_FLIGHT }))).toBe(false);
    expect(RECON_BOOKED).toContain('确认无误');
    expect(RECON_BOOKED).toContain('对账完成');
    expect(RECON_BOOKED).toContain('按采方入账');
  });

  it('仅 billSource=订单 的行受订单状态门槛约束', () => {
    expect(isOrderDerived(bill())).toBe(true);
    expect(isOrderDerived(bill({ billSource: '手工新增' }))).toBe(false);
    expect(isOrderDerived(bill({ billSource: '退货登记' }))).toBe(false);
  });
});

describe('订单状态门槛', () => {
  it('已发货与已完成同样放行（发货路径实际写入已完成）', () => {
    expect(orderStatusOkForRecon(bill({ orderStatus: '已发货' }))).toBe(true);
    expect(orderStatusOkForRecon(bill({ orderStatus: '已完成' }))).toBe(true);
  });

  it('未发货/已取消的订单来源账单不放行', () => {
    ['待发货', '已审核待发货', '待付款', '已取消', ''].forEach(st => {
      expect(orderStatusOkForRecon(bill({ orderStatus: st }))).toBe(false);
    });
  });

  it('非订单来源账单不受订单状态影响', () => {
    expect(orderStatusOkForRecon(bill({ billSource: '手工新增', orderStatus: '' }))).toBe(true);
  });
});

describe('按钮可见性', () => {
  it('待对账 + 订单已完成：可发起、可确认无误、不可撤回', () => {
    const r = bill();
    expect(canInitRecon(r)).toBe(true);
    expect(canConfirmBill(r)).toBe(true);
    expect(canWithdrawRecon(r)).toBe(false);
  });

  it('已发起对账后隐藏确认无误（用户要求：发起即不可本端单方确认）', () => {
    const r = bill({ reconResult: RECON_IN_FLIGHT });
    expect(canConfirmBill(r)).toBe(false);
    expect(canInitRecon(r)).toBe(false);
    expect(canWithdrawRecon(r)).toBe(true);
  });

  it('撤回后行退回待对账且订单已完成时仍可再次发起', () => {
    // 回归：旧渲染判据只认「已发货」，撤回后按钮永久隐藏
    const r = bill({ reconResult: RECON_PENDING, orderStatus: '已完成' });
    expect(canInitRecon(r)).toBe(true);
  });

  it('三个终态均不可再发起，且仅「确认无误」保留撤回入口', () => {
    expect(canInitRecon(bill({ reconResult: '对账完成' }))).toBe(false);
    expect(canInitRecon(bill({ reconResult: '确认无误' }))).toBe(false);
    expect(canInitRecon(bill({ reconResult: '按采方入账' }))).toBe(false);
    expect(canWithdrawRecon(bill({ reconResult: '确认无误' }))).toBe(true);
    expect(canWithdrawRecon(bill({ reconResult: '对账完成' }))).toBe(false);
    expect(canWithdrawRecon(bill({ reconResult: '按采方入账' }))).toBe(false);
  });

  it('行状态滞后但对账库仍有存活记录时放行撤回（自动发起未落库的兜底）', () => {
    const r = bill({ reconResult: RECON_PENDING });
    expect(canWithdrawRecon(r, true)).toBe(true);
    expect(canWithdrawRecon(bill({ reconResult: '对账完成' }), true)).toBe(false);
  });
});

describe('resolveBillAmountFields 金额锁定', () => {
  const derived = {
    totalCount: 10, productDetail: 'A×10', totalAmount: 1000, paidAmount: 300,
    items: [{ productCode: 'A', quantity: 10, price: 100 }],
  };

  it('未入账行一律跟随订单当前值', () => {
    const out = resolveBillAmountFields(bill({ totalAmount: 800 }), { ...derived, totalAmount: 1000 });
    expect(out.totalAmount).toBe(1000);
    expect(out.paidAmount).toBe(300);
    expect(out.items).toEqual(derived.items);
    expect(out._orderDiff).toBeUndefined();
  });

  it('已入账行锁定入账时金额，订单改数只挂差额标记', () => {
    RECON_BOOKED.forEach(st => {
      const out = resolveBillAmountFields(bill({ reconResult: st, totalAmount: 1000, paidAmount: 300, items: derived.items }), { ...derived, totalAmount: 1240 });
      expect(out.totalAmount).toBe(1000);
      expect(out._orderAmount).toBe(1240);
      expect(out._orderDiff).toBe(240);
    });
  });

  it('金额一致时不留差额标记（防止存储堆积脏标记）', () => {
    const out = resolveBillAmountFields(bill({ reconResult: '对账完成', totalAmount: 1000, items: derived.items }), derived);
    expect(out._orderDiff).toBeUndefined();
    expect(out._orderAmount).toBeUndefined();
  });

  it('已付金额不锁定：对账后新收款仍要体现在账单上', () => {
    const out = resolveBillAmountFields(bill({ reconResult: '确认无误', totalAmount: 1000, paidAmount: 50, items: derived.items }), { ...derived, paidAmount: 900 });
    expect(out.paidAmount).toBe(900);
    expect(out.totalAmount).toBe(1000);
  });

  it('锁定明细与汇总，不被订单拆分后的新明细覆盖', () => {
    const prev = bill({
      reconResult: '按采方入账', totalAmount: 1000, totalCount: 0, productDetail: '',
      items: [{ productCode: 'A', quantity: 4 }, { productCode: 'B', quantity: 6 }],
    });
    const out = resolveBillAmountFields(prev, { ...derived, totalCount: 99, productDetail: 'A×99' });
    expect(out.items).toEqual(prev.items);
    expect(out.totalCount).toBe(10);
    expect(out.productDetail).toBe('A×4，B×6');
  });

  it('终态行缺 items 时回退订单明细（不因锁定而丢明细）', () => {
    const out = resolveBillAmountFields(bill({ reconResult: '确认无误', totalAmount: 1000 }), derived);
    expect(out.items).toEqual(derived.items);
  });
});

describe('deriveReconState 行状态自愈', () => {
  it('待对账 + 存活记录 → 补回在途态', () => {
    const d = deriveReconState(bill({ reconResult: RECON_PENDING }), true);
    expect(d).toEqual({ reconResult: RECON_IN_FLIGHT, changed: true });
  });

  it('其余状态保持原样，避免把已入账行打回在途', () => {
    ['对账完成', '确认无误', '按采方入账', RECON_IN_FLIGHT].forEach(st => {
      const d = deriveReconState(bill({ reconResult: st }), true);
      expect(d.changed).toBe(false);
      expect(d.reconResult).toBe(st);
    });
  });

  it('无存活记录时不动（撤回后不得被自愈复活）', () => {
    const d = deriveReconState(bill({ reconResult: RECON_PENDING }), false);
    expect(d).toEqual({ reconResult: RECON_PENDING, changed: false });
  });
});
