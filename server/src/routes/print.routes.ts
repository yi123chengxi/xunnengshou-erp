/**
 * 打印任务 REST API
 *
 * POST /api/print/render       — 存储打印 HTML，返回可访问 URL（免鉴权）
 * GET  /api/print/render/:id   — 获取存储的打印 HTML（免鉴权）
 * POST /api/print/job          — 提交打印任务（需 JWT）
 * GET  /api/print/job/:id      — 查询任务状态（需 JWT）
 * GET  /api/print/printers     — 获取当前租户在线打印机列表（需 JWT）
 */
import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { verifyJWT, JWTPayload } from './auth.routes';
import { createJob, getJob } from '../ws/print-job-store';
import { sendPrintJob, getTenantPrinters, getTenantClientCount } from '../ws/print-ws';

const router = Router();

// ============ 打印 HTML 渲染存储（免鉴权，打印客户端加载用） ============
const renderStore = new Map<string, { html: string; createdAt: number }>();
// 每 10 分钟清理超过 30 分钟的条目
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of renderStore) { if (v.createdAt < cutoff) renderStore.delete(k); }
}, 10 * 60 * 1000).unref?.();

/**
 * POST /api/print/render
 * 免鉴权：接收打印 HTML 内容，存储并返回访问 URL（供打印客户端加载）
 */
router.post('/render', (req: Request, res: Response) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    res.status(400).json({ code: 400, message: 'html 不能为空' });
    return;
  }
  const id = uuidv4();
  renderStore.set(id, { html, createdAt: Date.now() });
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({ code: 0, data: { id, url: `${baseUrl}/api/print/render/${id}` } });
});

/**
 * GET /api/print/render/:id
 * 免鉴权：返回存储的打印 HTML（打印客户端通过此 URL 加载内容）
 */
router.get('/render/:id', (req: Request, res: Response) => {
  const entry = renderStore.get(req.params.id);
  if (!entry) {
    res.status(404).json({ code: 404, message: '打印内容已过期或不存在' });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(entry.html);
});

/**
 * GET /api/print/printers-public?owner=<租户名>
 * 免鉴权打印机列表查询（供 Web 页面下拉使用）：Web 端登录不签发 JWT，
 * 无法走 verifyJWT；按租户名返回打印客户端在线上报的打印机。
 */
router.get('/printers-public', (req: Request, res: Response) => {
  const owner = String(req.query.owner || '');
  const printers = owner ? getTenantPrinters(owner) : [];
  res.json({
    code: 0,
    data: { printers, clientCount: owner ? getTenantClientCount(owner) : 0 },
  });
});

// ============ 服务端本机打印机枚举（30s 缓存） ============
let localPrinterCache: { ts: number; printers: { name: string; isDefault: boolean }[] } | null = null;
function getLocalPrinters(): Promise<{ name: string; isDefault: boolean }[]> {
  if (localPrinterCache && Date.now() - localPrinterCache.ts < 30000) return Promise.resolve(localPrinterCache.printers);
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress'],
      { timeout: 8000, windowsHide: true }, (err, stdout) => {
        let list: { name: string; isDefault: boolean }[] = [];
        if (!err && stdout) {
          try {
            const j = JSON.parse(stdout);
            const arr = Array.isArray(j) ? j : [j];
            list = arr.map((x: any) => ({ name: String(x.Name || ''), isDefault: Boolean(x.Default) })).filter(x => x.name);
          } catch { /* 解析失败返回空列表 */ }
        }
        localPrinterCache = { ts: Date.now(), printers: list };
        resolve(list);
      });
  });
}

/**
 * GET /api/print/local-printers
 * 免鉴权：返回服务端所在电脑已安装的打印机列表（浏览器与服务端同机时的本地打印机来源；
 * 打印客户端未在线时的兜底）。
 */
router.get('/local-printers', (_req: Request, res: Response) => {
  getLocalPrinters().then(printers => {
    res.json({ code: 0, data: { printers, source: 'server' } });
  });
});

// 其余打印接口都需要 JWT 认证
router.use(verifyJWT);

/**
 * POST /api/print/job
 * 提交打印任务，通过 WebSocket 转发给租户的打印客户端
 */
router.post('/job', (req: Request, res: Response) => {
  const user = (req as any).user as JWTPayload;
  const { type, content, printerName, copies } = req.body;

  // 参数校验
  if (!type || !['url', 'pdf'].includes(type)) {
    res.status(400).json({ code: 400, message: 'type 必须为 url 或 pdf' });
    return;
  }
  if (!content || typeof content !== 'string') {
    res.status(400).json({ code: 400, message: 'content 不能为空' });
    return;
  }

  // 检查是否有在线客户端
  const clientCount = getTenantClientCount(user.username);
  if (clientCount === 0) {
    res.status(503).json({
      code: 503,
      message: '当前租户无在线打印客户端，请先启动打印客户端并登录',
    });
    return;
  }

  // 创建任务
  const job = createJob({
    tenantId: user.username,
    type,
    content,
    printerName,
    copies,
  });

  // 通过 WebSocket 下发
  const sent = sendPrintJob(user.username, job);
  if (!sent) {
    job.status = 'failed';
    job.error = 'WebSocket 发送失败';
    res.status(503).json({
      code: 503,
      message: '打印任务下发失败，客户端连接异常',
      taskId: job.id,
    });
    return;
  }

  res.json({
    code: 0,
    data: { taskId: job.id, status: 'pending' },
    message: '打印任务已提交',
  });
});

/**
 * GET /api/print/job/:id
 * 查询打印任务状态（仅能查询本租户的任务）
 */
router.get('/job/:id', (req: Request, res: Response) => {
  const user = (req as any).user as JWTPayload;
  const job = getJob(req.params.id);

  if (!job) {
    res.status(404).json({ code: 404, message: '任务不存在' });
    return;
  }

  // 租户隔离校验
  if (job.tenantId !== user.username) {
    res.status(403).json({ code: 403, message: '无权查看其他租户的打印任务' });
    return;
  }

  res.json({
    code: 0,
    data: {
      id: job.id,
      type: job.type,
      printerName: job.printerName,
      copies: job.copies,
      status: job.status,
      error: job.error || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
});

/**
 * GET /api/print/printers
 * 获取当前租户的在线打印机列表
 */
router.get('/printers', (req: Request, res: Response) => {
  const user = (req as any).user as JWTPayload;
  const printers = getTenantPrinters(user.username);
  res.json({
    code: 0,
    data: { printers, clientCount: getTenantClientCount(user.username) },
  });
});

export default router;
