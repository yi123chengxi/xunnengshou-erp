import { Router, Request, Response } from 'express';
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = (await import('../database/init')).default;
    const [rows]: any = await pool.execute('SELECT * FROM products ORDER BY id DESC');
    res.json({ code: 200, data: rows });
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

export default router;
