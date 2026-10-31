import { Router, Request, Response } from 'express';

const router = Router();

// 收款
router.post('/receive', async (req: Request, res: Response) => {
  try {
    const { customerId, amount, paymentMethod, paymentDate, billIds, remark } = req.body;
    const operatorId = (req as any).userId || 1;
    const pool = (await import('../../database/init')).default;

    // 生成收款单号
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [maxNo]: any = await pool.execute(
      `SELECT receipt_no FROM payment_received WHERE receipt_no LIKE 'RC${today}%' ORDER BY id DESC LIMIT 1`
    );
    const seq = maxNo.length > 0
      ? String(Number(maxNo[0].receipt_no.slice(-4)) + 1).padStart(4, '0')
      : '0001';
    const receiptNo = `RC${today}${seq}`;

    // 创建收款记录
    await pool.execute(
      `INSERT INTO payment_received 
       (receipt_no, customer_id, amount, payment_method, payment_date, bill_ids, operator_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptNo, customerId, amount, paymentMethod || 'bank_transfer', paymentDate, JSON.stringify(billIds || []), operatorId, remark]
    );

    // 更新客户账户
    await pool.execute(
      `UPDATE customer_accounts 
       SET total_received = total_received + ?, balance = balance - ?
       WHERE customer_id = ?`,
      [amount, amount, customerId]
    );

    // 更新关联账单
    if (billIds && billIds.length > 0) {
      for (const billId of billIds) {
        await pool.execute(
          `UPDATE receivable_bills 
           SET received_amount = received_amount + ?, 
               bill_status = CASE WHEN received_amount + ? >= amount THEN 'paid' ELSE 'partial' END
           WHERE id = ?`,
          [amount / billIds.length, amount / billIds.length, billId]
        );
      }
    }

    // 资金流水
    await pool.execute(
      `INSERT INTO cash_flow (flow_no, flow_type, category, amount, balance_after, ref_type, ref_no, flow_date, operator_id, remark)
       VALUES (?, 'income', 'customer_payment', ?, 
        (SELECT COALESCE(SUM(CASE WHEN flow_type='income' THEN amount ELSE -amount END),0) FROM (SELECT * FROM cash_flow) cf) + ?,
        'payment_received', ?, ?, ?, ?)`,
      [receiptNo, amount, amount, receiptNo, paymentDate, operatorId, remark]
    );

    res.json({ code: 200, data: { receiptNo, amount }, message: '收款成功' });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 付款
router.post('/pay', async (req: Request, res: Response) => {
  try {
    const { supplierId, amount, paymentMethod, paymentDate, billIds, remark } = req.body;
    const operatorId = (req as any).userId || 1;
    const pool = (await import('../../database/init')).default;

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [maxNo]: any = await pool.execute(
      `SELECT payment_no FROM payment_made WHERE payment_no LIKE 'PM${today}%' ORDER BY id DESC LIMIT 1`
    );
    const seq = maxNo.length > 0
      ? String(Number(maxNo[0].payment_no.slice(-4)) + 1).padStart(4, '0')
      : '0001';
    const paymentNo = `PM${today}${seq}`;

    await pool.execute(
      `INSERT INTO payment_made 
       (payment_no, supplier_id, amount, payment_method, payment_date, bill_ids, operator_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentNo, supplierId, amount, paymentMethod || 'bank_transfer', paymentDate, JSON.stringify(billIds || []), operatorId, remark]
    );

    await pool.execute(
      `UPDATE supplier_accounts 
       SET total_paid = total_paid + ?, balance = balance - ?
       WHERE supplier_id = ?`,
      [amount, amount, supplierId]
    );

    if (billIds && billIds.length > 0) {
      for (const billId of billIds) {
        await pool.execute(
          `UPDATE payable_bills 
           SET paid_amount = paid_amount + ?,
               bill_status = CASE WHEN paid_amount + ? >= amount THEN 'paid' ELSE 'partial' END
           WHERE id = ?`,
          [amount / billIds.length, amount / billIds.length, billId]
        );
      }
    }

    res.json({ code: 200, data: { paymentNo, amount }, message: '付款成功' });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 获取收款记录
router.get('/received', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const { customerId, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (customerId) { whereClause += ' AND pr.customer_id = ?'; params.push(customerId); }
    if (startDate) { whereClause += ' AND pr.payment_date >= ?'; params.push(startDate); }
    if (endDate) { whereClause += ' AND pr.payment_date <= ?'; params.push(endDate); }
    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows]: any = await pool.execute(
      `SELECT pr.*, c.customer_name FROM payment_received pr
       JOIN customers c ON pr.customer_id = c.id
       ${whereClause} ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM payment_received pr ${whereClause}`, params
    );
    res.json({ code: 200, data: { list: rows, total: countRows[0].total } });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取付款记录
router.get('/paid', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const { supplierId, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (supplierId) { whereClause += ' AND pm.supplier_id = ?'; params.push(supplierId); }
    if (startDate) { whereClause += ' AND pm.payment_date >= ?'; params.push(startDate); }
    if (endDate) { whereClause += ' AND pm.payment_date <= ?'; params.push(endDate); }
    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows]: any = await pool.execute(
      `SELECT pm.*, s.supplier_name FROM payment_made pm
       JOIN suppliers s ON pm.supplier_id = s.id
       ${whereClause} ORDER BY pm.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM payment_made pm ${whereClause}`, params
    );
    res.json({ code: 200, data: { list: rows, total: countRows[0].total } });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 资金流水
router.get('/cashflow', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const { flowType, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (flowType) { whereClause += ' AND cf.flow_type = ?'; params.push(flowType); }
    if (startDate) { whereClause += ' AND cf.flow_date >= ?'; params.push(startDate); }
    if (endDate) { whereClause += ' AND cf.flow_date <= ?'; params.push(endDate); }
    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows]: any = await pool.execute(
      `SELECT cf.*, u.real_name as operator_name FROM cash_flow cf
       LEFT JOIN users u ON cf.operator_id = u.id
       ${whereClause} ORDER BY cf.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM cash_flow cf ${whereClause}`, params
    );
    res.json({ code: 200, data: { list: rows, total: countRows[0].total } });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

export default router;
