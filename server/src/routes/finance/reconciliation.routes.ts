import { Router, Request, Response } from 'express';
import reconciliationService from '../../services/reconciliation.service';

const router = Router();

// 批量对账
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { partyType, partyId } = req.body;
    const operatorId = (req as any).userId || 1;
    const result = await reconciliationService.batchReconcile(partyType, partyId, operatorId);
    res.json({ code: 200, data: result });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

// 获取对账记录详情
router.get('/records/:id', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const [rows]: any = await pool.execute(
      `SELECT rr.*, 
        CASE WHEN rr.party_type = 'customer' THEN c.customer_name ELSE s.supplier_name END as party_name
       FROM reconciliation_records rr
       LEFT JOIN customers c ON rr.party_type = 'customer' AND rr.party_id = c.id
       LEFT JOIN suppliers s ON rr.party_type = 'supplier' AND rr.party_id = s.id
       WHERE rr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ code: 404, message: '对账记录不存在' });
      return;
    }
    res.json({ code: 200, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取所有对账记录
router.get('/records', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;
    const { partyType, partyId, matchResult, startDate, endDate, page = 1, pageSize = 20 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (partyType) { whereClause += ' AND rr.party_type = ?'; params.push(partyType); }
    if (partyId) { whereClause += ' AND rr.party_id = ?'; params.push(partyId); }
    if (matchResult) { whereClause += ' AND rr.match_result = ?'; params.push(matchResult); }
    if (startDate) { whereClause += ' AND rr.reconciliation_date >= ?'; params.push(startDate); }
    if (endDate) { whereClause += ' AND rr.reconciliation_date <= ?'; params.push(endDate); }

    const offset = (Number(page) - 1) * Number(pageSize);

    const [rows]: any = await pool.execute(
      `SELECT rr.*, 
        CASE WHEN rr.party_type = 'customer' THEN c.customer_name ELSE s.supplier_name END as party_name
       FROM reconciliation_records rr
       LEFT JOIN customers c ON rr.party_type = 'customer' AND rr.party_id = c.id
       LEFT JOIN suppliers s ON rr.party_type = 'supplier' AND rr.party_id = s.id
       ${whereClause}
       ORDER BY rr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );

    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM reconciliation_records rr ${whereClause}`,
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

// 对账统计概览
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../../database/init')).default;

    // 应收对账统计
    const [receivableStats]: any = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reconciliation_status = 'reconciled' THEN 1 ELSE 0 END) as matched,
        SUM(CASE WHEN reconciliation_status = 'matched_amount_only' THEN 1 ELSE 0 END) as amount_only,
        SUM(CASE WHEN reconciliation_status = 'mismatch' THEN 1 ELSE 0 END) as mismatched,
        SUM(CASE WHEN reconciliation_status = 'unreconciled' THEN 1 ELSE 0 END) as unreconciled
       FROM receivable_bills`
    );

    // 应付对账统计
    const [payableStats]: any = await pool.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN reconciliation_status = 'reconciled' THEN 1 ELSE 0 END) as matched,
        SUM(CASE WHEN reconciliation_status = 'matched_amount_only' THEN 1 ELSE 0 END) as amount_only,
        SUM(CASE WHEN reconciliation_status = 'mismatch' THEN 1 ELSE 0 END) as mismatched,
        SUM(CASE WHEN reconciliation_status = 'unreconciled' THEN 1 ELSE 0 END) as unreconciled
       FROM payable_bills`
    );

    // 应收账款总额
    const [totalReceivable]: any = await pool.execute(
      `SELECT SUM(balance) as total FROM customer_accounts`
    );

    // 应付账款总额
    const [totalPayable]: any = await pool.execute(
      `SELECT SUM(balance) as total FROM supplier_accounts`
    );

    res.json({
      code: 200,
      data: {
        receivable: {
          stats: receivableStats[0],
          totalAmount: totalReceivable[0].total || 0,
        },
        payable: {
          stats: payableStats[0],
          totalAmount: totalPayable[0].total || 0,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

export default router;
