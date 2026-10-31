import { Router, Request, Response } from 'express';
import reconciliationService from '../../services/reconciliation.service';

const router = Router();

// 创建应收账单 (从发货单生成)
router.post('/bills/generate/:deliveryId', async (req: Request, res: Response) => {
  try {
    const deliveryId = Number(req.params.deliveryId);
    const operatorId = (req as any).userId || 1;
    const result = await reconciliationService.createReceivableBill(deliveryId, operatorId);
    res.json({ code: 200, data: result, message: '应收账单生成成功' });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 客户确认账单
router.post('/bills/confirm', async (req: Request, res: Response) => {
  try {
    const { customerId, billNo } = req.body;
    const result = await reconciliationService.customerConfirmBill(customerId, billNo);
    res.json({ code: 200, data: result });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 应收对账
router.post('/reconcile', async (req: Request, res: Response) => {
  try {
    const { billId, theirData } = req.body;
    const operatorId = (req as any).userId || 1;
    const result = await reconciliationService.reconcileReceivable(billId, theirData, operatorId);
    res.json({ code: 200, data: result });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 获取应收账单列表
router.get('/bills', async (req: Request, res: Response) => {
  try {
    const { customerId, status, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    const pool = (await import('../../database/init')).default;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (customerId) {
      whereClause += ' AND rb.customer_id = ?';
      params.push(customerId);
    }
    if (status) {
      whereClause += ' AND rb.reconciliation_status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND rb.bill_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND rb.bill_date <= ?';
      params.push(endDate);
    }

    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows]: any = await pool.execute(
      `SELECT rb.*, c.customer_name, c.customer_code
       FROM receivable_bills rb
       JOIN customers c ON rb.customer_id = c.id
       ${whereClause}
       ORDER BY rb.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );

    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM receivable_bills rb ${whereClause}`,
      params
    );

    res.json({
      code: 200,
      data: {
        list: rows,
        total: countRows[0].total,
        page: Number(page),
        pageSize: Number(pageSize),
      },
    });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取账单明细
router.get('/bills/:id/items', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const [rows]: any = await pool.execute(
      `SELECT * FROM receivable_bill_items WHERE bill_id = ?`,
      [req.params.id]
    );
    res.json({ code: 200, data: rows });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取对账记录
router.get('/records', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const { partyId, partyType } = req.query;

    let whereClause = "WHERE reconciliation_type = 'receivable'";
    const params: any[] = [];

    if (partyId) {
      whereClause += ' AND party_id = ?';
      params.push(partyId);
    }

    const [rows]: any = await pool.execute(
      `SELECT * FROM reconciliation_records ${whereClause} ORDER BY created_at DESC`,
      params
    );

    res.json({ code: 200, data: rows });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取客户账户概览
router.get('/account/:customerId', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const [rows]: any = await pool.execute(
      `SELECT ca.*, c.customer_name, c.customer_code
       FROM customer_accounts ca
       JOIN customers c ON ca.customer_id = c.id
       WHERE ca.customer_id = ?`,
      [req.params.customerId]
    );
    if (rows.length === 0) {
      res.json({ code: 200, data: { total_receivable: 0, total_received: 0, balance: 0 } });
      return;
    }
    res.json({ code: 200, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

export default router;
