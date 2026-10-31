import { Router, Request, Response } from 'express';
const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  res.json({ code: 200, data: { message: 'dashboard data' } });
});

export default router;
