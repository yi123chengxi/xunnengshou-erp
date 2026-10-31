import { Router, Request, Response } from 'express';
import reconciliationService from '../../services/reconciliation.service';

const router = Router();

// 创建应付账单 (从收货单生成)
router.post('/bills/generate/:receiptId', async (req: Request, res: Response) => {
  try {
    const receiptId = Number(req.params.receiptId);
    const operatorId = (req as any).userId || 1;
    const result = await reconciliationService.createPayableBill(receiptId, operatorId);
    res.json({ code: 200, data: result, message: '应付账单生成成功' });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 供应商确认账单
router.post('/bills/confirm', async (req: Request, res: Response) => {
  try {
    const { supplierId, billNo } = req.body;
    const result = await reconciliationService.supplierConfirmBill(supplierId, billNo);
    res.json({ code: 200, data: result });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 应付对账
router.post('/reconcile', async (req: Request, res: Response) => {
  try {
    const { billId, theirData } = req.body;
    const operatorId = (req as any).userId || 1;
    const result = await reconciliationService.reconcilePayable(billId, theirData, operatorId);
    res.json({ code: 200, data: result });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 获取应付账单列表
router.get('/bills', async (req: Request, res: Response) => {
  try {
    const { supplierId, status, startDate, endDate, page = 1, pageSize = 20 } = req.query;
    const pool = (await import('../../database/init')).default;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (supplierId) {
      whereClause += ' AND pb.supplier_id = ?';
      params.push(supplierId);
    }
    if (status) {
      whereClause += ' AND pb.reconciliation_status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND pb.bill_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND pb.bill_date <= ?';
      params.push(endDate);
    }

    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows]: any = await pool.execute(
      `SELECT pb.*, s.supplier_name, s.supplier_code
       FROM payable_bills pb
       JOIN suppliers s ON pb.supplier_id = s.id
       ${whereClause}
       ORDER BY pb.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );

    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM payable_bills pb ${whereClause}`,
      params
    );

    res.json({
      code: 200,
      data: { list: rows, total: countRows[0].total, page: Number(page), pageSize: Number(pageSize) },
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
      `SELECT * FROM payable_bill_items WHERE bill_id = ?`,
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
    const { partyId } = req.query;
    let whereClause = "WHERE reconciliation_type = 'payable'";
    const params: any[] = [];
    if (partyId) { whereClause += ' AND party_id = ?'; params.push(partyId); }
    const [rows]: any = await pool.execute(
      `SELECT * FROM reconciliation_records ${whereClause} ORDER BY created_at DESC`,
      params
    );
    res.json({ code: 200, data: rows });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取供应商账户概览
router.get('/account/:supplierId', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const [rows]: any = await pool.execute(
      `SELECT sa.*, s.supplier_name, s.supplier_code
       FROM supplier_accounts sa
       JOIN suppliers s ON sa.supplier_id = s.id
       WHERE sa.supplier_id = ?`,
      [req.params.supplierId]
    );
    if (rows.length === 0) {
      res.json({ code: 200, data: { total_payable: 0, total_paid: 0, balance: 0 } });
      return;
    }
    res.json({ code: 200, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

export default router;
