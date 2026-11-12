/**
 * 账单对账状态与可操作性判定（纯函数，供页面渲染/写入点与单测共用）。
 *
 * 背景（批次2）：账单明细行是订单的派生视图，每次刷新都按订单全量重建。旧实现只在
 * reconResult === '按采方入账' 时冻结金额三列，导致「确认无误 / 对账完成」这类同样已达成
 * 合意的行会被订单侧改写（取消/反取消/缺货拆分/拆分合并/编辑弹窗回算）覆盖金额，
 * 而会计分录只在状态跃迁入终态时按当时金额写入，两者从此脱钩且无任何留痕。
 * 这里把「哪些状态属于已入账终态」「行金额该锁还是该跟订单走」「按钮是否可点」
 * 收敛成单一判据，页面侧不再各写一套。
 */

/** 已入账终态：金额/明细锁定为对账时的数字，不再被订单重建覆盖，也不允许重复发起/撤回 */
export const RECON_BOOKED: string[] = ['对账完成', '确认无误', '按采方入账'];

/** 在途：已发送至对方，允许撤回，但不允许再次发起或就地确认无误 */
export const RECON_IN_FLIGHT = '已发起对账';

/** 初始态 */
export const RECON_PENDING = '待对账';

/** 订单来源账单允许执行对账动作的订单状态（与 initReconCore / handleBillConfirm 的校验同源） */
export const RECON_OK_ORDER_STATUS: string[] = ['已发货', '已完成'];

export const reconStateOf = (row: any): string => String(row?.reconResult || '').trim() || RECON_PENDING;

/** 是否已入账终态行（金额必须锁定） */
export const isBookedRow = (row: any): boolean => RECON_BOOKED.includes(reconStateOf(row));

/** 账单是否派生自订单（订单侧改写才会冲击金额） */
export const isOrderDerived = (row: any): boolean => String(row?.billSource || '').trim() === '订单';

/**
 * 订单来源账单的状态门槛：发货后订单状态直达「已完成」（打单拣货发货即完成交易），
 * 旧渲染判据只认「已发货」，与逻辑校验（已发货/已完成）不同源，导致撤回后发起对账按钮永久隐藏。
 */
export const orderStatusOkForRecon = (row: any): boolean =>
  !isOrderDerived(row) || RECON_OK_ORDER_STATUS.includes(String(row?.orderStatus || '').trim());

/** 可发起对账：终态与在途都不允许，且订单状态需达标 */
export const canInitRecon = (row: any): boolean =>
  !isBookedRow(row) && reconStateOf(row) !== RECON_IN_FLIGHT && orderStatusOkForRecon(row);

/**
 * 可确认无误：与发起对账同源判据。
 * 已发起对账后不可再「确认无误」——对账请求已在对方手上，本端单方确认会造成双方状态分叉。
 */
export const canConfirmBill = (row: any): boolean => canInitRecon(row);

/**
 * 可撤回对账：行状态为在途/已确认，或行状态滞后但对账库仍有存活记录
 * （存活记录是"到底发没发出去"的真值源，用于兜底历史数据：发起只改内存未落库时行会退回待对账）。
 */
export const canWithdrawRecon = (row: any, hasAliveRecon = false): boolean => {
  const st = reconStateOf(row);
  if (st === RECON_IN_FLIGHT || st === '确认无误') return true;
  return !!hasAliveRecon && !RECON_BOOKED.includes(st);
};

/** 订单当前值（重建账单行时由订单算出），用于与已锁定行金额比对得出差额 */
export interface BillDerivedAmounts {
  totalCount: number;
  productDetail: string;
  totalAmount: number;
  paidAmount: number;
  items: any[];
}

export interface BillLockedFields extends BillDerivedAmounts {
  /** 仅终态行且与订单值存在差额时写入：订单当前金额 */
  _orderAmount?: number;
  /** 仅终态行且与订单值存在差额时写入：订单金额 − 账单锁定金额（元，两位小数） */
  _orderDiff?: number;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 重建账单行时的金额/明细归属裁决：
 * - 未入账行：一律跟随订单当前值（保持既有行为，发货/拆单等正常流转能实时反映）；
 * - 已入账行：锁定账单自身入账时的商品总额与明细（对账标的），
 *   订单值与其不一致时只挂差额标记（_orderAmount/_orderDiff）供列表提示，绝不改写已入账金额；
 * - 已付金额始终跟随订单：收款是独立于对账争议的事实事件，冻结会让发货后新收款不再体现在账单上。
 * 差额为 0 时清空标记，避免存储里堆积无意义字段。
 */
export const resolveBillAmountFields = (prev: any, derived: BillDerivedAmounts): BillLockedFields => {
  if (!isBookedRow(prev)) {
    return { ...derived };
  }
  const lockedAmount = Number(prev.totalAmount) || 0;
  const orderAmount = Number(derived.totalAmount) || 0;
  const diff = round2(orderAmount - lockedAmount);
  const lockedItems = Array.isArray(prev.items) ? prev.items : derived.items;
  const out: BillLockedFields = {
    items: lockedItems,
    totalAmount: lockedAmount,
    paidAmount: Number(derived.paidAmount) || 0,
    totalCount: Number(prev.totalCount) || lockedItems.reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0),
    productDetail: prev.productDetail
      || (lockedItems.length ? lockedItems.map((it: any) => `${it.productCode || ''}×${Number(it.quantity) || 0}`).join('，') : derived.productDetail),
  };
  if (Math.abs(diff) >= 0.005) { out._orderAmount = orderAmount; out._orderDiff = diff; }
  return out;
};

/** 行状态与对账库存活记录的一致性自愈结果 */
export const deriveReconState = (row: any, hasAliveRecon: boolean): { reconResult: string; changed: boolean } => {
  const st = reconStateOf(row);
  // 发起只写了内存未落库（或落库被旧端覆盖）时，行会退回待对账而对账记录仍存活 → 补回在途态
  if (hasAliveRecon && st === RECON_PENDING) return { reconResult: RECON_IN_FLIGHT, changed: true };
  return { reconResult: st, changed: false };
};
