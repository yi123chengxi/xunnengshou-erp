import { Router, Request, Response } from 'express';
const router = Router();

// 获取客户列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../database/init')).default;
    const { page = 1, pageSize = 20, keyword } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (keyword) { whereClause += ' AND (customer_name LIKE ? OR customer_code LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }

    const [rows]: any = await pool.execute(
      `SELECT * FROM customers ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), offset]
    );
    const [countRows]: any = await pool.execute(
      `SELECT COUNT(*) as total FROM customers ${whereClause}`, params
    );

    res.json({ code: 200, data: { list: rows, total: countRows[0].total } });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 获取单个客户
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../database/init')).default;
    const [rows]: any = await pool.execute('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) { res.status(404).json({ code: 404, message: '客户不存在' }); return; }
    res.json({ code: 200, data: rows[0] });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

// 创建客户
router.post('/', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../database/init')).default;
    const { customer_name, contact_person, phone, email, address, credit_limit, remark } = req.body;
    const code = `CUST${Date.now().toString().slice(-6)}`;
    await pool.execute(
      `INSERT INTO customers (customer_code, customer_name, contact_person, phone, email, address, credit_limit, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, customer_name, contact_person, phone, email, address, credit_limit || 0, remark]
    );
    res.json({ code: 200, message: '创建成功' });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

export default router;
