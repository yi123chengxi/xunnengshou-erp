/**
 * 系统基础设施统计（开发者后台用）：应用服务磁盘 + 数据库空间
 * - 应用盘：Linux/ macOS 走 df -B1 取所在分区总量/已用/可用；其他平台返回 null（前端占位显示）
 * - MySQL：占用 = information_schema 表空间（data+index）聚合；数据库盘总量读环境变量
 *   DB_DISK_TOTAL_GB（订购的云盘容量，缺省 20），剩余 = 总量 - 占用
 * - 数据库盘真实占用（含 binlog/操作系统等表空间之外的部分）MySQL 自身查不到，且数据库服务器
 *   是独立内网机器、应用侧无法代跑 df，故由数据库机 cron 每分钟 POST /disk-report 上报 df 结果
 *   （x-disk-token 校验，令牌读环境变量 DISK_REPORT_TOKEN）；15 分钟内的上报优先于估算口径
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

/** 数据库机 cron 上报落盘文件（重启不丢最近一次上报） */
const DISK_REPORT_FILE = path.resolve(process.cwd(), 'data/disk-report.json');
/** 上报新鲜度阈值：cron 每分钟一次，超过 15 分钟视为链路断了，回退估算口径 */
const DISK_REPORT_FRESH_MS = 15 * 60 * 1000;

function readDiskReport(): any | null {
  try {
    if (!fs.existsSync(DISK_REPORT_FILE)) return null;
    const r = JSON.parse(fs.readFileSync(DISK_REPORT_FILE, 'utf8'));
    if (!r || !Number(r.totalBytes) || Date.now() - Number(r.reportedAt) > DISK_REPORT_FRESH_MS) return null;
    return r;
  } catch { return null; }
}

/** 数据库机 df 上报入口：令牌校验（DISK_REPORT_TOKEN），只存最新一份，供 infra-stats 展示真实磁盘占用 */
router.post('/disk-report', (req: Request, res: Response) => {
  const token = String(process.env.DISK_REPORT_TOKEN || '');
  if (!token) { res.status(503).json({ code: 1, message: '服务端未配置 DISK_REPORT_TOKEN' }); return; }
  if (String(req.get('x-disk-token') || '') !== token) { res.status(401).json({ code: 1, message: 'token 不正确' }); return; }
  const b = req.body || {};
  const totalBytes = Number(b.totalBytes); const usedBytes = Number(b.usedBytes); const freeBytes = Number(b.freeBytes);
  if (!totalBytes || usedBytes < 0 || freeBytes < 0) { res.status(400).json({ code: 1, message: '参数不合法' }); return; }
  const rec = {
    totalBytes, usedBytes, freeBytes,
    mount: String(b.mount || '/').slice(0, 64),
    host: String(b.host || '').slice(0, 64),
    reportedAt: Date.now(),
  };
  try {
    const dir = path.dirname(DISK_REPORT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DISK_REPORT_FILE, JSON.stringify(rec));
    res.json({ code: 0 });
  } catch {
    res.status(500).json({ code: 1, message: '上报落盘失败' });
  }
});

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
      const report = readDiskReport();
      if (report) {
        // 数据库机 df 实测优先：usedBytes/totalBytes/freeBytes 全部换成磁盘真实值，
        // 表空间聚合降级为 tableBytes 附带的参考值（前端副行展示）
        db = {
          driver: 'mysql', schema,
          usedBytes: Number(report.usedBytes), totalBytes: Number(report.totalBytes), freeBytes: Number(report.freeBytes),
          tableBytes: usedBytes,
          diskTotalConfigured: true,
          source: 'disk-report', reportedAt: Number(report.reportedAt), mount: report.mount, host: report.host,
        };
      } else {
        db = {
          driver: 'mysql', schema, usedBytes, totalBytes,
          freeBytes: Math.max(0, totalBytes - usedBytes),
          tableBytes: usedBytes,
          diskTotalConfigured: !!process.env.DB_DISK_TOTAL_GB,
          source: 'estimate',
        };
      }
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
