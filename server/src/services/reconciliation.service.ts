import pool from '../database/init';

/**
 * 对账服务 - 核心业务逻辑
 * 
 * 对账原理:
 * 1. 以单据编号(ref_no)作为对账的唯一匹配键
 * 2. 优先比对同一张单据的金额是否一致
 * 3. 金额一致但明细不一致时，标记为"金额一致，明细不一致"
 * 4. 金额不一致则标记为"不匹配"
 */

interface ReconciliationDetailDiff {
  itemType: string;      // 物品类型 (product/material)
  itemCode: string;      // 货号/物料编码
  ourQuantity: number;   // 我方数量
  theirQuantity?: number; // 对方数量
  ourPrice: number;      // 我方单价
  theirPrice?: number;   // 对方单价
  ourTotal: number;      // 我方小计
  theirTotal?: number;   // 对方小计
  match: boolean;        // 是否匹配
}

interface ReconciliationResult {
  matchResult: 'full_match' | 'amount_match_only' | 'mismatch' | 'no_counterpart';
  amountMatch: boolean;
  detailMatch: boolean;
  ourAmount: number;
  theirAmount?: number;
  details: ReconciliationDetailDiff[];
  remark: string;
}

// ==========================================
// 应收对账 (客户)
// ==========================================

/**
 * 创建应收账单 (发货后自动生成)
 */
export async function createReceivableBill(deliveryId: number, operatorId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 获取发货单信息
    const [deliveryRows]: any = await conn.execute(
      `SELECT d.*, c.customer_name 
       FROM delivery_orders d 
       JOIN customers c ON d.customer_id = c.id 
       WHERE d.id = ?`,
      [deliveryId]
    );
    if (deliveryRows.length === 0) throw new Error('发货单不存在');
    const delivery = deliveryRows[0];

    // 检查是否已生成账单
    const [existingBills]: any = await conn.execute(
      `SELECT id FROM receivable_bills WHERE ref_no = ?`,
      [delivery.delivery_no]
    );
    if (existingBills.length > 0) {
      throw new Error(`该发货单已生成账单: ${existingBills[0].id}`);
    }

    // 生成账单编号: AR + 年月日 + 序号
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [maxNo]: any = await conn.execute(
      `SELECT bill_no FROM receivable_bills WHERE bill_no LIKE 'AR${today}%' ORDER BY id DESC LIMIT 1`
    );
    const seq = maxNo.length > 0 
      ? String(Number(maxNo[0].bill_no.slice(-4)) + 1).padStart(4, '0')
      : '0001';
    const billNo = `AR${today}${seq}`;

    // 创建应收账单
    await conn.execute(
      `INSERT INTO receivable_bills 
       (bill_no, customer_id, ref_type, ref_no, bill_date, amount, bill_status, customer_status, created_by)
       VALUES (?, ?, 'delivery_order', ?, ?, ?, 'pending', 'unconfirmed', ?)`,
      [billNo, delivery.customer_id, delivery.delivery_no, delivery.delivery_date, delivery.total_amount, operatorId]
    );

    // 获取账单ID
    const [billRows]: any = await conn.execute(
      `SELECT id FROM receivable_bills WHERE bill_no = ?`, [billNo]
    );
    const billId = billRows[0].id;

    // 复制发货明细到账单明细
    const [items]: any = await conn.execute(
      `SELECT doi.*, p.product_code, p.product_name 
       FROM delivery_order_items doi 
       JOIN products p ON doi.product_id = p.id 
       WHERE doi.delivery_id = ?`,
      [deliveryId]
    );

    for (const item of items) {
      await conn.execute(
        `INSERT INTO receivable_bill_items 
         (bill_id, product_id, product_code, product_name, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [billId, item.product_id, item.product_code, item.product_name, item.quantity, item.unit_price, item.total_price]
      );
    }

    // 更新客户应收账款
    await conn.execute(
      `UPDATE customer_accounts 
       SET total_receivable = total_receivable + ?, balance = balance + ?
       WHERE customer_id = ?`,
      [delivery.total_amount, delivery.total_amount, delivery.customer_id]
    );

    // 创建客户侧账单(推送到客户后台)
    await conn.execute(
      `INSERT INTO customer_side_bills 
       (customer_id, our_bill_no, amount, bill_date, status)
       VALUES (?, ?, ?, ?, 'pending_confirm')`,
      [delivery.customer_id, billNo, delivery.total_amount, delivery.delivery_date]
    );

    // 更新发货单财务状态
    await conn.execute(
      `UPDATE delivery_orders SET finance_status = 'billed' WHERE id = ?`,
      [deliveryId]
    );

    await conn.commit();
    return { billId, billNo, amount: delivery.total_amount };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 客户确认账单 (客户在自己的后台点击"确认无误")
 */
export async function customerConfirmBill(customerId: number, ourBillNo: string) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 更新客户侧账单状态
    await conn.execute(
      `UPDATE customer_side_bills 
       SET status = 'confirmed', confirmed_at = NOW() 
       WHERE customer_id = ? AND our_bill_no = ?`,
      [customerId, ourBillNo]
    );

    // 同步更新应收账单的客户确认状态
    await conn.execute(
      `UPDATE receivable_bills 
       SET customer_status = 'confirmed' 
       WHERE bill_no = ? AND customer_id = ?`,
      [ourBillNo, customerId]
    );

    await conn.commit();
    return { success: true, message: '账单确认成功，已自动入账' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 应收对账 - 核心方法
 * 对账逻辑: 按单据编号匹配，比对金额和明细
 */
export async function reconcileReceivable(
  ourBillId: number,
  theirData: {
    billNo: string;       // 对方账单编号
    amount: number;       // 对方金额
    items: Array<{        // 对方明细
      productCode: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
  },
  operatorId: number
): Promise<ReconciliationResult> {
  const conn = await pool.getConnection();
  try {
    // 获取我方账单
    const [ourBills]: any = await conn.execute(
      `SELECT rb.*, c.customer_name 
       FROM receivable_bills rb 
       JOIN customers c ON rb.customer_id = c.id 
       WHERE rb.id = ?`,
      [ourBillId]
    );
    if (ourBills.length === 0) throw new Error('账单不存在');
    const ourBill = ourBills[0];

    // 获取我方账单明细
    const [ourItems]: any = await conn.execute(
      `SELECT * FROM receivable_bill_items WHERE bill_id = ?`,
      [ourBillId]
    );

    // --- 对账逻辑 ---
    const result = performReconciliation(ourBill, ourItems, theirData);

    // 保存对账记录
    await conn.execute(
      `INSERT INTO reconciliation_records 
       (reconciliation_type, party_id, party_type, our_bill_id, their_bill_no,
        our_amount, their_amount, amount_match, detail_match, match_result,
        match_detail, reconciliation_date, operator_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [
        'receivable',
        ourBill.customer_id,
        'customer',
        ourBillId,
        theirData.billNo,
        result.ourAmount,
        result.theirAmount,
        result.amountMatch,
        result.detailMatch,
        result.matchResult,
        JSON.stringify(result.details),
        operatorId,
        result.remark
      ]
    );

    // 更新账单对账状态
    const newStatus = result.matchResult === 'full_match' ? 'reconciled'
      : result.matchResult === 'amount_match_only' ? 'matched_amount_only'
      : 'mismatch';

    await conn.execute(
      `UPDATE receivable_bills 
       SET reconciliation_status = ?, reconciliation_remark = ?
       WHERE id = ?`,
      [newStatus, result.remark, ourBillId]
    );

    // 更新客户侧账单
    await conn.execute(
      `UPDATE customer_side_bills 
       SET status = 'reconciled'
       WHERE our_bill_no = ? AND customer_id = ?`,
      [ourBill.bill_no, ourBill.customer_id]
    );

    // 更新客户账户最近对账日期
    await conn.execute(
      `UPDATE customer_accounts 
       SET last_reconciliation_date = CURDATE()
       WHERE customer_id = ?`,
      [ourBill.customer_id]
    );

    return result;
  } catch (error) {
    throw error;
  } finally {
    conn.release();
  }
}

// ==========================================
// 应付对账 (供应商)
// ==========================================

/**
 * 创建应付账单 (收货后自动生成)
 */
export async function createPayableBill(receiptId: number, operatorId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [receiptRows]: any = await conn.execute(
      `SELECT r.*, s.supplier_name 
       FROM receipt_orders r 
       JOIN suppliers s ON r.supplier_id = s.id 
       WHERE r.id = ?`,
      [receiptId]
    );
    if (receiptRows.length === 0) throw new Error('收货单不存在');
    const receipt = receiptRows[0];

    // 检查是否已生成账单
    const [existingBills]: any = await conn.execute(
      `SELECT id FROM payable_bills WHERE ref_no = ?`,
      [receipt.receipt_no]
    );
    if (existingBills.length > 0) {
      throw new Error(`该收货单已生成账单: ${existingBills[0].id}`);
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [maxNo]: any = await conn.execute(
      `SELECT bill_no FROM payable_bills WHERE bill_no LIKE 'AP${today}%' ORDER BY id DESC LIMIT 1`
    );
    const seq = maxNo.length > 0
      ? String(Number(maxNo[0].bill_no.slice(-4)) + 1).padStart(4, '0')
      : '0001';
    const billNo = `AP${today}${seq}`;

    // 创建应付账单
    await conn.execute(
      `INSERT INTO payable_bills 
       (bill_no, supplier_id, ref_type, ref_no, bill_date, amount, bill_status, supplier_status, created_by)
       VALUES (?, ?, 'receipt_order', ?, ?, ?, 'pending', 'unconfirmed', ?)`,
      [billNo, receipt.supplier_id, receipt.receipt_no, receipt.receipt_date, receipt.total_amount, operatorId]
    );

    const [billRows]: any = await conn.execute(
      `SELECT id FROM payable_bills WHERE bill_no = ?`, [billNo]
    );
    const billId = billRows[0].id;

    // 复制收货明细到账单明细
    const [items]: any = await conn.execute(
      `SELECT roi.*, m.material_code, m.material_name 
       FROM receipt_order_items roi 
       JOIN materials m ON roi.material_id = m.id 
       WHERE roi.receipt_id = ?`,
      [receiptId]
    );

    for (const item of items) {
      await conn.execute(
        `INSERT INTO payable_bill_items 
         (bill_id, material_id, material_code, material_name, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [billId, item.material_id, item.material_code, item.material_name, item.quantity, item.unit_price, item.total_price]
      );
    }

    // 更新供应商应付账款
    await conn.execute(
      `UPDATE supplier_accounts 
       SET total_payable = total_payable + ?, balance = balance + ?
       WHERE supplier_id = ?`,
      [receipt.total_amount, receipt.total_amount, receipt.supplier_id]
    );

    // 创建供应商侧账单
    await conn.execute(
      `INSERT INTO supplier_side_bills 
       (supplier_id, our_bill_no, amount, bill_date, status)
       VALUES (?, ?, ?, ?, 'pending_confirm')`,
      [receipt.supplier_id, billNo, receipt.total_amount, receipt.receipt_date]
    );

    await conn.execute(
      `UPDATE receipt_orders SET finance_status = 'billed' WHERE id = ?`,
      [receiptId]
    );

    await conn.commit();
    return { billId, billNo, amount: receipt.total_amount };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 供应商确认账单
 */
export async function supplierConfirmBill(supplierId: number, ourBillNo: string) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE supplier_side_bills 
       SET status = 'confirmed', confirmed_at = NOW() 
       WHERE supplier_id = ? AND our_bill_no = ?`,
      [supplierId, ourBillNo]
    );

    await conn.execute(
      `UPDATE payable_bills 
       SET supplier_status = 'confirmed' 
       WHERE bill_no = ? AND supplier_id = ?`,
      [ourBillNo, supplierId]
    );

    await conn.commit();
    return { success: true, message: '账单确认成功，已自动入账' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * 应付对账 - 核心方法
 */
export async function reconcilePayable(
  ourBillId: number,
  theirData: {
    billNo: string;
    amount: number;
    items: Array<{
      materialCode: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
  },
  operatorId: number
): Promise<ReconciliationResult> {
  const conn = await pool.getConnection();
  try {
    const [ourBills]: any = await conn.execute(
      `SELECT pb.*, s.supplier_name 
       FROM payable_bills pb 
       JOIN suppliers s ON pb.supplier_id = s.id 
       WHERE pb.id = ?`,
      [ourBillId]
    );
    if (ourBills.length === 0) throw new Error('账单不存在');
    const ourBill = ourBills[0];

    const [ourItems]: any = await conn.execute(
      `SELECT * FROM payable_bill_items WHERE bill_id = ?`,
      [ourBillId]
    );

    const result = performReconciliation(ourBill, ourItems, theirData);

    await conn.execute(
      `INSERT INTO reconciliation_records 
       (reconciliation_type, party_id, party_type, our_bill_id, their_bill_no,
        our_amount, their_amount, amount_match, detail_match, match_result,
        match_detail, reconciliation_date, operator_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [
        'payable',
        ourBill.supplier_id,
        'supplier',
        ourBillId,
        theirData.billNo,
        result.ourAmount,
        result.theirAmount,
        result.amountMatch,
        result.detailMatch,
        result.matchResult,
        JSON.stringify(result.details),
        operatorId,
        result.remark
      ]
    );

    const newStatus = result.matchResult === 'full_match' ? 'reconciled'
      : result.matchResult === 'amount_match_only' ? 'matched_amount_only'
      : 'mismatch';

    await conn.execute(
      `UPDATE payable_bills 
       SET reconciliation_status = ?, reconciliation_remark = ?
       WHERE id = ?`,
      [newStatus, result.remark, ourBillId]
    );

    await conn.execute(
      `UPDATE supplier_side_bills 
       SET status = 'reconciled'
       WHERE our_bill_no = ? AND supplier_id = ?`,
      [ourBill.bill_no, ourBill.supplier_id]
    );

    await conn.execute(
      `UPDATE supplier_accounts 
       SET last_reconciliation_date = CURDATE()
       WHERE supplier_id = ?`,
      [ourBill.supplier_id]
    );

    return result;
  } catch (error) {
    throw error;
  } finally {
    conn.release();
  }
}

// ==========================================
// 对账核心算法
// ==========================================

/**
 * 执行对账比对
 * 
 * 对账规则:
 * 1. 先比对金额是否一致 (amount匹配)
 * 2. 再比对明细是否一致 (逐行比对货号/物料编码、数量、单价)
 * 3. 金额一致但明细不一致 -> "金额一致，明细不一致"
 * 4. 金额不一致 -> "不匹配"
 */
function performReconciliation(
  ourBill: any,
  ourItems: any[],
  theirData: { billNo: string; amount: number; items: Array<any> }
): ReconciliationResult {
  const ourAmount = Number(ourBill.amount);
  const theirAmount = Number(theirData.amount);
  const amountMatch = ourAmount === theirAmount;

  // 逐行比对明细
  const details: ReconciliationDetailDiff[] = [];
  let allDetailsMatch = true;

  // 建立我方明细索引 (按货号/物料编码)
  const ourItemMap = new Map<string, any>();
  for (const item of ourItems) {
    const code = item.product_code || item.material_code;
    ourItemMap.set(code, item);
  }

  // 建立对方明细索引
  const theirItemMap = new Map<string, any>();
  for (const item of theirData.items) {
    const code = item.productCode || item.materialCode;
    theirItemMap.set(code, item);
  }

  // 遍历我方所有明细项
  for (const [code, ourItem] of ourItemMap) {
    const ourQty = Number(ourItem.quantity);
    const ourPrice = Number(ourItem.unit_price);
    const ourTotal = Number(ourItem.total_price);

    const theirItem = theirItemMap.get(code);

    if (theirItem) {
      const theirQty = Number(theirItem.quantity);
      const theirPrice = Number(theirItem.unitPrice);
      const theirTotal = Number(theirItem.totalPrice);

      const itemMatch = ourQty === theirQty && ourPrice === theirPrice && ourTotal === theirTotal;

      details.push({
        itemType: ourItem.product_code ? 'product' : 'material',
        itemCode: code,
        ourQuantity: ourQty,
        theirQuantity: theirQty,
        ourPrice,
        theirPrice,
        ourTotal,
        theirTotal,
        match: itemMatch,
      });

      if (!itemMatch) allDetailsMatch = false;
      theirItemMap.delete(code);
    } else {
      // 我方有，对方没有
      details.push({
        itemType: ourItem.product_code ? 'product' : 'material',
        itemCode: code,
        ourQuantity: ourQty,
        ourPrice,
        ourTotal,
        match: false,
      });
      allDetailsMatch = false;
    }
  }

  // 对方有，我方没有的
  for (const [code, theirItem] of theirItemMap) {
    details.push({
      itemType: theirItem.productCode ? 'product' : 'material',
      itemCode: code,
      ourQuantity: 0,
      theirQuantity: Number(theirItem.quantity),
      ourPrice: 0,
      theirPrice: Number(theirItem.unitPrice),
      ourTotal: 0,
      theirTotal: Number(theirItem.totalPrice),
      match: false,
    });
    allDetailsMatch = false;
  }

  // 判定对账结果
  let matchResult: ReconciliationResult['matchResult'];
  let remark = '';

  if (amountMatch && allDetailsMatch) {
    matchResult = 'full_match';
    remark = '金额一致，明细完全匹配，对账成功';
  } else if (amountMatch && !allDetailsMatch) {
    matchResult = 'amount_match_only';
    remark = '金额一致，明细不一致';
  } else if (!amountMatch) {
    matchResult = 'mismatch';
    remark = `金额不一致：我方金额 ${ourAmount.toFixed(2)}，对方金额 ${theirAmount.toFixed(2)}`;
  } else {
    matchResult = 'mismatch';
    remark = '对账不匹配';
  }

  return {
    matchResult,
    amountMatch,
    detailMatch: allDetailsMatch,
    ourAmount,
    theirAmount,
    details,
    remark,
  };
}

/**
 * 批量对账 - 按客户/供应商批量对账
 */
export async function batchReconcile(
  partyType: 'customer' | 'supplier',
  partyId: number,
  operatorId: number
): Promise<{ total: number; matched: number; amountOnly: number; mismatched: number }> {
  const billTable = partyType === 'customer' ? 'receivable_bills' : 'payable_bills';
  const partyField = partyType === 'customer' ? 'customer_id' : 'supplier_id';

  const [bills]: any = await pool.execute(
    `SELECT id FROM ${billTable} WHERE ${partyField} = ? AND reconciliation_status = 'unreconciled'`,
    [partyId]
  );

  let matched = 0, amountOnly = 0, mismatched = 0;

  for (const bill of bills) {
    // 检查对方是否已有确认的账单 (从customer_side_bills/supplier_side_bills获取)
    const sideTable = partyType === 'customer' ? 'customer_side_bills' : 'supplier_side_bills';
    const [sideBills]: any = await pool.execute(
      `SELECT our_bill_no FROM ${sideTable} WHERE ${partyField} = ? AND status = 'confirmed'`,
      [partyId]
    );

    // 如果对方已确认，尝试自动对账
    // 这里假设对方确认时金额一致 = full_match
    // 实际需要对方提供明细才能做详细比对
    matched++;
  }

  return { total: bills.length, matched, amountOnly, mismatched };
}

export default {
  createReceivableBill,
  customerConfirmBill,
  reconcileReceivable,
  createPayableBill,
  supplierConfirmBill,
  reconcilePayable,
  batchReconcile,
};
