/**
 * 打印客户端 WebSocket 服务
 *
 * 协议消息（JSON）：
 *   客户端 → 服务端：
 *     { type: 'auth',           token: string }
 *     { type: 'register_printers', printers: PrinterInfo[], sharedNames?: string[] }
 *     { type: 'job_status',     jobId: string, status: PrintJobStatus, error?: string }
 *
 *   服务端 → 客户端：
 *     { type: 'auth_ok',        username: string }
 *     { type: 'auth_fail',      message: string }
 *     { type: 'print_job',      id, type, content, printerName, copies }
 *     { type: 'ping' }
 */
import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { updateJobStatus, PrintJob } from './print-job-store';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'factory-management-secret-key-2024';

// ============ 类型定义 ============

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  clientName?: string;   // 打印机归属的客户端电脑名（共享来源标识）
}

interface PrintClientMeta {
  ws: WebSocket;
  tenantId: string;       // username
  clientName: string;     // 客户端电脑名（os.hostname）
  printers: PrinterInfo[];      // 本机全量打印机（同租户网页打印下拉可见）
  sharedNames: string[];        // 手动添加的共享名单（仅对其他电脑的客户端可见）
  authenticated: boolean;
}

// ============ 存储 ============

/** 按租户分组的连接 */
const tenantConnections = new Map<string, Set<PrintClientMeta>>();

/** 按 WebSocket 实例索引的客户端元信息 */
const wsClientMap = new WeakMap<WebSocket, PrintClientMeta>();

// ============ 公开 API（供 print.routes.ts 调用） ============

/** 获取指定租户的在线打印机列表 */
export function getTenantPrinters(tenantId: string): PrinterInfo[] {
  const clients = tenantConnections.get(tenantId);
  if (!clients) return [];
  const printers: PrinterInfo[] = [];
  const seen = new Set<string>();
  for (const client of clients) {
    for (const p of client.printers) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        printers.push(p);
      }
    }
  }
  return printers;
}

/** 向指定租户的客户端发送打印任务，返回是否发送成功 */
export function sendPrintJob(tenantId: string, job: PrintJob): boolean {
  const clients = tenantConnections.get(tenantId);
  if (!clients || clients.size === 0) return false;

  // 共享打印路由：指定打印机时优先发给上报过该打印机的客户端（打印机在哪台电脑就由哪台执行）；
  // 未指定或未匹配时回退第一个在线客户端
  let client: PrintClientMeta | null = null;
  if (job.printerName) {
    for (const c of clients) {
      if (c.ws.readyState === WebSocket.OPEN && c.printers.some(p => p.name === job.printerName)) { client = c; break; }
    }
  }
  if (!client) {
    for (const c of clients) {
      if (c.ws.readyState === WebSocket.OPEN) { client = c; break; }
    }
  }
  if (!client) return false;

  // 打印机名校验：网页保存的选择可能是历史缓存（打印机已移除/换机），
  // Electron 对不存在的 deviceName 既不回调也不报错→任务永久挂起；
  // 转发前按执行客户端的实际上报名单替换为其默认打印机（无则留空由客户端走系统默认）
  let printerName = job.printerName;
  if (printerName && !client.printers.some(p => p.name === printerName)) {
    const fb = client.printers.find(p => p.isDefault) || client.printers[0];
    console.warn(`[print-ws] 打印机"${printerName}"不在客户端 ${client.clientName} 的名单中，替换为 ${fb ? `"${fb.name}"` : '客户端系统默认'}`);
    printerName = fb ? fb.name : '';
  }

  const msg = JSON.stringify({
    type: 'print_job',
    id: job.id,
    jobType: job.type,
    content: job.content,
    printerName,
    copies: job.copies,
  });

  client.ws.send(msg);
  return true;
}

/** 向执行打印任务的客户端发送取消指令 */
export function cancelPrintJob(tenantId: string, jobId: string): boolean {
  const clients = tenantConnections.get(tenantId);
  if (!clients || clients.size === 0) return false;
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify({ type: 'cancel_job', jobId }));
      return true;
    }
  }
  return false;
}

/** 向租户内全部在线客户端广播打印机快照（按接收方分离：自己的全量 + 其他电脑手动共享的） */
function snapshotFor(target: PrintClientMeta): PrinterInfo[] {
  const clients = tenantConnections.get(target.tenantId);
  if (!clients) return [];
  const out: PrinterInfo[] = [];
  const seen = new Set<string>();
  for (const c of clients) {
    // 本机自己的打印机全量可见；其他电脑仅手动共享的进入我的“共享打印机”区
    const list = c === target ? c.printers : c.printers.filter(p => c.sharedNames.includes(p.name));
    for (const p of list) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        out.push(p);
      }
    }
  }
  return out;
}

function broadcastPrintersSnapshot(tenantId: string) {
  const clients = tenantConnections.get(tenantId);
  if (!clients) return;
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify({ type: 'printers_snapshot', printers: snapshotFor(c) }));
    }
  }
}

/** 获取指定租户的在线客户端数量 */
export function getTenantClientCount(tenantId: string): number {
  return tenantConnections.get(tenantId)?.size || 0;
}

// ============ WebSocket 服务初始化 ============

export function initPrintWebSocket(server: HTTPServer) {
  const wss = new WebSocketServer({ noServer: true });

  // 手动处理 WebSocket 升级请求
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    if (pathname === '/ws/print') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // 心跳检测：每 30 秒 ping 一次
  setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    });
  }, 30_000);

  wss.on('connection', (ws: WebSocket, req: any) => {
    console.log('[print-ws] 新连接:', req.socket.remoteAddress);

    const meta: PrintClientMeta = {
      ws,
      tenantId: '',
      clientName: '',
      printers: [],
      sharedNames: [],
      authenticated: false,
    };
    wsClientMap.set(ws, meta);

    // 10 秒内必须完成认证，否则断开
    const authTimeout = setTimeout(() => {
      if (!meta.authenticated) {
        ws.send(JSON.stringify({ type: 'auth_fail', message: '认证超时' }));
        ws.close(4001, '认证超时');
      }
    }, 10_000);

    ws.on('message', (raw: any) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(4002, '无效 JSON');
        return;
      }

      switch (msg.type) {
        // ====== 认证 ======
        case 'auth': {
          if (meta.authenticated) return; // 已认证，忽略重复
          try {
            const payload = jwt.verify(String(msg.token || ''), JWT_SECRET) as { username: string; role: string };
            meta.tenantId = payload.username;
            meta.authenticated = true;
            clearTimeout(authTimeout);

            // 加入租户连接池
            if (!tenantConnections.has(meta.tenantId)) {
              tenantConnections.set(meta.tenantId, new Set());
            }
            tenantConnections.get(meta.tenantId)!.add(meta);

            console.log(`[print-ws] 认证成功: ${meta.tenantId}`);
            ws.send(JSON.stringify({ type: 'auth_ok', username: meta.tenantId }));
            // 新客户端上线：立即下发一次租户打印机快照（含其他电脑的共享打印机）
            broadcastPrintersSnapshot(meta.tenantId);
          } catch {
            ws.send(JSON.stringify({ type: 'auth_fail', message: '令牌无效' }));
            ws.close(4003, '令牌无效');
          }
          break;
        }

        // ====== 注册打印机列表 ======
        case 'register_printers': {
          if (!meta.authenticated) return;
          if (msg.clientName) meta.clientName = String(msg.clientName);
          if (Array.isArray(msg.printers)) {
            meta.printers = msg.printers.map((p: any) => ({
              name: String(p.name || ''),
              isDefault: Boolean(p.isDefault),
              clientName: meta.clientName,
            })).filter((p: PrinterInfo) => p.name);
            // 共享名单：旧版客户端不传 sharedNames（其上报列表即共享列表），回退为上报名单
            meta.sharedNames = Array.isArray(msg.sharedNames)
              ? msg.sharedNames.map(String)
              : meta.printers.map(p => p.name);
            console.log(`[print-ws] ${meta.tenantId}(${meta.clientName}) 注册 ${meta.printers.length} 台打印机（共享 ${meta.sharedNames.length} 台）`);
            // 打印机变化：广播最新快照给租户内全部客户端（共享列表实时刷新）
            broadcastPrintersSnapshot(meta.tenantId);
          }
          break;
        }

        // ====== 任务状态回传 ======
        case 'job_status': {
          if (!meta.authenticated) return;
          const { jobId, status, error } = msg;
          if (!jobId || !status) return;
          const job = updateJobStatus(jobId, status, error);
          if (job) {
            // 租户隔离校验：确保回传的任务属于该租户
            if (job.tenantId !== meta.tenantId) {
              console.warn(`[print-ws] 跨租户状态回传被拦截: ${meta.tenantId} → job ${jobId} (属于 ${job.tenantId})`);
              return;
            }
            console.log(`[print-ws] 任务 ${jobId} 状态: ${status}${error ? ` (${error})` : ''}`);
          }
          break;
        }

        // ====== 客户端 pong ======
        case 'pong': {
          // 心跳响应，无需处理
          break;
        }

        default:
          console.log('[print-ws] 未知消息类型:', msg.type);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (meta.authenticated && meta.tenantId) {
        const set = tenantConnections.get(meta.tenantId);
        if (set) {
          set.delete(meta);
          if (set.size === 0) tenantConnections.delete(meta.tenantId);
        }
        console.log(`[print-ws] 断开: ${meta.tenantId}`);
        // 客户端下线：广播最新快照，其余客户端的共享列表同步移除其打印机
        broadcastPrintersSnapshot(meta.tenantId);
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[print-ws] 连接错误:', err.message);
    });
  });

  console.log('[print-ws] WebSocket 服务已启动 (path: /ws/print)');
}
