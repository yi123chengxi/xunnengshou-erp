import { Router, Request, Response } from 'express';
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../database/init')).default;
    const [rows]: any = await pool.execute('SELECT * FROM suppliers ORDER BY id DESC');
    res.json({ code: 200, data: rows });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../database/init')).default;
    const { supplier_name, contact_person, phone, email, address, remark } = req.body;
    const code = `SUPP${Date.now().toString().slice(-6)}`;
    await pool.execute(
      `INSERT INTO suppliers (supplier_code, supplier_name, contact_person, phone, email, address, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, supplier_name, contact_person, phone, email, address, remark]
    );
    res.json({ code: 200, message: '创建成功' });
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message });
  }
});

export default router;
