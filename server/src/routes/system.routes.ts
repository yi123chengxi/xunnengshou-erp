/**
 * 系统基础设施统计（开发者后台用）：应用服务磁盘 + 数据库空间
 * - 应用盘：Linux/ macOS 走 df -B1 取所在分区总量/已用/可用；其他平台返回 null（前端占位显示）
 * - MySQL：占用 = information_schema 表空间（data+index）聚合；数据库盘总量读环境变量
 *   DB_DISK_TOTAL_GB（订购的云盘容量，缺省 20），剩余 = 总量 - 占用
 * - SQLite：占用 = 数据库文件体积；总量/剩余与应用盘同源（同一台机器）
 * 仅返回容量聚合数字，不含路径/租户等明细（与 /sync/usage-all 运营接口同风险口径）
 */
import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import pool from '../database/init';
import { STORE_DRIVER } from '../database/store';

const router = Router();

interface DiskStat { totalBytes: number; usedBytes: number; freeBytes: number; mount: string; }

/** df -B1 -P <target>：Filesystem 1B-blocks Used Available Use% Mounted-on */
function dfStat(target: string): Promise<DiskStat | null> {
  return new Promise(resolve => {
    if (process.platform !== 'linux' && process.platform !== 'darwin') { resolve(null); return; }
    execFile('df', ['-B1', '-P', target], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      const line = stdout.split('\n')[1];
      if (!line) { resolve(null); return; }
      const p = line.split(/\s+/);
      const total = Number(p[1]); const used = Number(p[2]); const free = Number(p[3]);
      if (!total) { resolve(null); return; }
      resolve({ totalBytes: total, usedBytes: used, freeBytes: free, mount: p.slice(5).join(' ') || '/' });
    });
  });
}

router.get('/infra-stats', async (_req: Request, res: Response) => {
  const app = await dfStat(process.cwd());
  let db: any = null;
  try {
    if (STORE_DRIVER === 'mysql') {
      const schema = process.env.DB_NAME || 'xinnengshu';
      const [rows] = await pool.execute(
        'SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes FROM information_schema.TABLES WHERE table_schema = ?',
        [schema]
      );
      const usedBytes = Number((rows as any[])[0]?.bytes) || 0;
      // 数据库盘订购容量缺省 20GB（可以环境变量 DB_DISK_TOTAL_GB 覆盖）
      const totalBytes = Math.round((Number(process.env.DB_DISK_TOTAL_GB) || 20) * 1024 * 1024 * 1024);
      db = {
        driver: 'mysql', schema, usedBytes, totalBytes,
        freeBytes: Math.max(0, totalBytes - usedBytes),
        diskTotalConfigured: !!process.env.DB_DISK_TOTAL_GB,
      };
    } else {
      const dbFile = path.resolve(process.cwd(), 'data/factory.db');
      const usedBytes = fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0;
      db = {
        driver: 'sqlite', usedBytes,
        totalBytes: app?.totalBytes || 0,
        freeBytes: app?.freeBytes || 0,
        diskTotalConfigured: false,
      };
    }
  } catch { db = null; }
  res.json({ code: 0, data: { app, db, generatedAt: new Date().toISOString() } });
});

export default router;
