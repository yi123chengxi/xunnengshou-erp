/**
 * 讯能手 ERP 本地打印客户端 — Electron 主进程
 *
 * 职责：
 *   1. 创建窗口（登录 → 主界面）
 *   2. 调用服务器 /api/auth/login 获取 JWT
 *   3. 连接 WebSocket，上报打印机列表，监听打印任务
 *   4. 静默打印（URL 或 PDF）
 *   5. 系统托盘 + 断线自动重连
 */
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import WebSocket from 'ws';
import { v4 as uuid } from 'uuid';

// ============ 本地文件日志 ============
// 运行日志全量落盘到「文档/讯能手打印日志」，按天一个文件；仅保留最近 3 天，超期自动删除
const LOG_RETENTION_DAYS = 3;
let logDirCache = '';
let logDateKey = '';

function logDir(): string {
  if (!logDirCache) logDirCache = path.join(app.getPath('documents'), '讯能手打印日志');
  return logDirCache;
}

function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 按文件名日期清理超过保留天数的日志（跨天写新文件时顺带执行）
function purgeOldLogs() {
  try {
    const dir = logDir();
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      const m = /^print-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (!m) continue;
      const t = new Date(`${m[1]}T00:00:00`).getTime();
      if (!Number.isNaN(t) && (now - t) / 86_400_000 > LOG_RETENTION_DAYS) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* 清理失败不影响主流程 */ }
}

function writeLog(level: string, text: string) {
  try {
    const now = new Date();
    const key = dateKey(now);
    if (key !== logDateKey) {
      fs.mkdirSync(logDir(), { recursive: true });
      logDateKey = key;
      purgeOldLogs();
    }
    const p = (n: number) => String(n).padStart(2, '0');
    const ts = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    fs.appendFileSync(path.join(logDir(), `print-${key}.log`), `[${ts}] [${level}] ${text}\n`);
  } catch { /* 写盘失败静默忽略，绝不影响打印主流程 */ }
}

// 包装 console 四方法：现有 console.* 调用零改动全量入日志文件
function fmtArgs(args: any[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
const origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
console.log = (...args: any[]) => { writeLog('INFO', fmtArgs(args)); origConsole.log(...args); };
console.info = (...args: any[]) => { writeLog('INFO', fmtArgs(args)); origConsole.info(...args); };
console.warn = (...args: any[]) => { writeLog('WARN', fmtArgs(args)); origConsole.warn(...args); };
console.error = (...args: any[]) => { writeLog('ERROR', fmtArgs(args)); origConsole.error(...args); };

// 闪退兜底：未捕获异常 / 未处理拒绝也落盘，避免崩溃无迹可查
process.on('uncaughtException', (err: Error) => writeLog('FATAL', `uncaughtException: ${err?.stack || err}`));
process.on('unhandledRejection', (reason: any) => writeLog('FATAL', `unhandledRejection: ${reason?.stack || reason}`));

// ============ 状态 ============
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ws: WebSocket | null = null;
let jwtToken = '';
let serverUrl = '';

// 内置生产服务器地址：登录页不再询问服务器地址，由后端统一持有
// 用域名 + HTTPS（而非旧 ECS 公网 IP + 明文 HTTP）：IP 变动即全量失效，且明文通道会被浏览器/路由拦截
const DEFAULT_SERVER_URL = 'https://www.xns114.com';
let username = '';
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30_000;
let isAuthenticated = false;

// 打印任务日志（最近 100 条，推送给渲染进程显示）
interface JobLog {
  id: string;
  time: string;
  jobType: string;
  printerName: string;
  status: 'pending' | 'printing' | 'completed' | 'failed';
  error?: string;
}
const jobLogs: JobLog[] = [];

// 待取消的任务 ID 集合（前端发起取消时加入，handlePrintJob 检查后移除）
const cancelledJobs = new Set<string>();

// 服务端推送的租户打印机快照（含归属电脑名，共享打印用）
let sharedSnapshot: any[] = [];

// 自动更新：新版本是否已下载完成（供“立即安装”判断）
let updateDownloaded = false;

// 本机标记为共享的打印机（UI 手动添加；空数组 = 不共享任何打印机）
let sharedFilter: string[] = [];

function pushLog(log: JobLog) {
  writeLog('JOB', `任务 ${log.id} → ${log.status}（打印机: ${log.printerName}）${log.error ? ` 错误: ${log.error}` : ''}`);
  jobLogs.unshift(log);
  if (jobLogs.length > 100) jobLogs.pop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('job-log', log);
  }
}

// 从任务日志中彻底移除某条记录（手动取消的任务不保留残行）
function removeJobLog(jobId: string) {
  const idx = jobLogs.findIndex(l => l.id === jobId);
  if (idx >= 0) jobLogs.splice(idx, 1);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('job-log-remove', jobId);
  }
}

// ============ 自动更新 ============

function sendUpdateEvent(payload: any) {
  console.log(`[update] ${payload?.type}${payload?.version ? ` v${payload.version}` : ''}${payload?.message ? ` ${payload.message}` : ''}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-event', payload);
  }
}

/** 检查更新：更新源为登录服务器的 /downloads/ 目录（与网页首页下载入口同源，存放 latest.yml + 安装包） */
function checkForUpdate() {
  const base = (serverUrl || '').replace(/\/+$/, '');
  if (!base) {
    sendUpdateEvent({ type: 'error', message: '尚未登录，无法确定更新源' });
    return;
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: `${base}/downloads/` });
    autoUpdater.checkForUpdates().catch((e: any) => sendUpdateEvent({ type: 'error', message: e?.message || '检查更新失败' }));
  } catch (e: any) {
    sendUpdateEvent({ type: 'error', message: e?.message || '检查更新失败' });
  }
}

function setupAutoUpdate() {
  autoUpdater.autoDownload = true;          // 发现新版本后台静默下载
  autoUpdater.autoInstallOnAppQuit = true;  // 退出时自动安装（兑底）

  autoUpdater.on('checking-for-update', () => sendUpdateEvent({ type: 'checking' }));
  autoUpdater.on('update-available', (info: any) => sendUpdateEvent({ type: 'available', version: info?.version || '' }));
  autoUpdater.on('update-not-available', () => sendUpdateEvent({ type: 'not-available' }));
  autoUpdater.on('download-progress', (p: any) => sendUpdateEvent({ type: 'progress', percent: Math.round(Number(p?.percent) || 0) }));
  autoUpdater.on('update-downloaded', (info: any) => {
    updateDownloaded = true;
    sendUpdateEvent({ type: 'downloaded', version: info?.version || '' });
  });
  autoUpdater.on('error', (err: Error) => sendUpdateEvent({ type: 'error', message: err?.message || '更新失败' }));

  // 每 4 小时定期检查一次
  setInterval(() => { if (isAuthenticated) checkForUpdate(); }, 4 * 60 * 60 * 1000);
}

// ============ 窗口创建 ============

// 应用图标：32x32 蓝底白色打印机字形 PNG（base64 内嵌，无外部文件依赖），托盘与窗口共用
const APP_ICON_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAW0lEQVR42mNgGGxAzqvuPy3xgFlM0CED6gB6W47hiCHjAGLBqAOGhwOoDQbEAUFHpMB4+DiAkrQy6oDh4YAhlw2HtgNG64JRB4w6YFA6YFj1DQZf12zAO6cDBQC0dLC3jZdVAQAAAABJRU5ErkJggg==';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    title: '讯能手打印客户端',
    icon: nativeImage.createFromDataURL(APP_ICON_DATAURL),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  // 渲染进程控制台日志转发落盘（level: 0 verbose / 1 info / 2 warning / 3 error）
  mainWindow.webContents.on('console-message', (_e: any, level: number, message: string, line: number, sourceId: string) => {
    writeLog('RENDER', `[L${level}] ${message}（${sourceId}:${line}）`);
  });

  // 关闭窗口 → 最小化到托盘
  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============ 系统托盘 ============
function createTray() {
  // 内嵌蓝底打印机图标：Windows 托盘对空图标不渲染（此前 createEmpty 导致托盘无图标）
  const icon = nativeImage.createFromDataURL(APP_ICON_DATAURL);
  tray = new Tray(icon);
  tray.setToolTip('讯能手打印客户端');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => mainWindow?.show(),
    },
    {
      label: '切换账户',
      click: () => {
        // 登出当前账户并通知渲染进程显示登录页
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (ws) { ws.close(); ws = null; }
        jwtToken = ''; username = ''; isAuthenticated = false;
        sendStatusChange('logged_out');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('switch-account');
          mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        tray = null;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

// ============ 登录 ============

// 单次登录尝试：地址不可达或响应非 API（JSON）时返回 notApi 标记，供自动端口探测使用
async function attemptLogin(base: string, user: string, password: string): Promise<{ ok: boolean; message?: string; name?: string; token?: string; notApi?: boolean }> {
  try {
    const resp = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { ok: false, notApi: true, message: '服务器响应异常（返回了网页内容），请稍后重试或联系管理员' };
    }
    const data = await resp.json();
    if (data.code !== 200 || !data.data?.token) return { ok: false, message: data.message || '登录失败' };
    return { ok: true, token: data.data.token, name: data.data.user?.name || user };
  } catch (err: any) {
    return { ok: false, notApi: true, message: `无法连接服务器（${err.message}），请检查网络后重试` };
  }
}

async function handleLogin(_event: any, user: string, password: string) {
  // 服务器地址由后端内置（阿里云生产），渲染进程不再传入
  let base = DEFAULT_SERVER_URL.replace(/\/+$/, '');
  let r = await attemptLogin(base, user, password);
  // 填了网页端口或错误端口时：自动探测一次 API 默认端口 3000
  if (!r.ok && r.notApi) {
    try {
      const u = new URL(base);
      if (u.port !== '3000') {
        u.port = '3000';
        const probeBase = u.toString().replace(/\/$/, '');
        const r2 = await attemptLogin(probeBase, user, password);
        if (r2.ok) { r = r2; base = probeBase; }
      }
    } catch { /* 忽略探测失败 */ }
  }
  if (!r.ok || !r.token) {
    console.log(`[auth] 登录失败: ${user} → ${r.message || '登录失败'}`);
    return { ok: false, message: r.message || '登录失败' };
  }
  jwtToken = r.token;
  serverUrl = base;
  username = user;
  isAuthenticated = true;
  console.log(`[auth] 登录成功: ${user} → ${base}`);

  connectWebSocket();
  // 登录成功后检查一次客户端更新
  setTimeout(() => checkForUpdate(), 1500);
  return { ok: true, username: user, name: r.name || user };
}

// ============ WebSocket 连接 ============
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws/print';
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[ws] 已连接:', wsUrl);
    reconnectDelay = 1000;

    // 发送认证
    ws!.send(JSON.stringify({ type: 'auth', token: jwtToken }));
  });

  ws.on('message', (raw: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'auth_ok':
        console.log('[ws] 认证成功:', msg.username);
        sendStatusChange('connected');
        reportPrinters();
        break;

      case 'auth_fail':
        console.error('[ws] 认证失败:', msg.message);
        sendStatusChange('auth_failed');
        break;

      case 'print_job':
        handlePrintJob(msg);
        break;

      case 'printers_snapshot': {
        // 共享打印快照：按电脑名标记本机/共享，推送给渲染进程分区展示
        const local = os.hostname();
        sharedSnapshot = (Array.isArray(msg.printers) ? msg.printers : []).map((p: any) => ({ ...p, isLocal: p.clientName === local }));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shared-printers', sharedSnapshot);
        }
        break;
      }

      case 'ping':
        ws?.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'cancel_job': {
        // 前端发起取消：标记任务 ID，handlePrintJob 在关键节点检查并中止；同时立即从日志移除该条
        const cancelId = String(msg.jobId || '');
        if (cancelId) {
          cancelledJobs.add(cancelId);
          removeJobLog(cancelId);
          console.log(`[ws] 收到取消任务: ${cancelId}`);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[ws] 连接关闭');
    isAuthenticated = false;
    sendStatusChange('disconnected');
    scheduleReconnect();
  });

  ws.on('error', (err: Error) => {
    console.error('[ws] 连接错误:', err.message);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (!jwtToken) return; // 未登录，不重连

  reconnectTimer = setTimeout(() => {
    console.log(`[ws] 重连 (delay: ${reconnectDelay}ms)...`);
    sendStatusChange('reconnecting');
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// ============ 打印机枚举 & 上报 ============
async function getPrinterList(): Promise<{ name: string; isDefault: boolean }[]> {
  if (!mainWindow) return [];
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      isDefault: p.isDefault,
    }));
  } catch (err) {
    console.error('获取打印机列表失败:', err);
    return [];
  }
}

async function reportPrinters() {
  const printers = await getPrinterList();
  // 上报口径：本机全量打印机上报（同租户网页打印下拉始终可见在线电脑的全部打印机）；
  // sharedNames 为手动添加的共享名单，服务端仅将这部分对其他电脑的客户端可见（对方“共享打印机”区）
  if (ws && ws.readyState === WebSocket.OPEN) {
    // 携带本机电脑名：服务端据此标记打印机归属，实现同租户共享路由
    ws.send(JSON.stringify({ type: 'register_printers', printers, sharedNames: sharedFilter, clientName: os.hostname() }));
    console.log(`[ws] 上报本机打印机 ${printers.length} 台（其中共享 ${sharedFilter.length} 台，${os.hostname()}）`);
  }
  // 同时推送给渲染进程
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('printers-updated', printers);
  }
}

// ============ 静默打印 ============
async function handlePrintJob(msg: {
  id: string;
  jobType: 'url' | 'pdf';
  content: string;
  printerName: string;
  copies: number;
}) {
  const log: JobLog = {
    id: msg.id,
    time: new Date().toLocaleTimeString(),
    jobType: msg.jobType,
    printerName: msg.printerName || '默认打印机',
    status: 'pending',
  };
  pushLog(log);

  // 取消标志：外部可通过 cancelledJobs Set 标记取消
  let cancelled = false;
  const checkCancelled = () => { if (cancelledJobs.has(msg.id)) cancelled = true; };
  // 隐藏打印窗口引用：失败/超时时统一清理，避免残留窗口后台续跑
  let printWinRef: BrowserWindow | null = null;

  try {
    // 更新状态为 printing
    log.status = 'printing';
    pushLog({ ...log });
    ws?.send(JSON.stringify({ type: 'job_status', jobId: msg.id, status: 'printing' }));
    console.log(`[print] 任务 ${msg.id} 开始加载打印内容（${msg.jobType}）: ${msg.jobType === 'url' ? msg.content : 'base64 PDF'}`);

    // 创建隐藏的打印窗口
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false },
    });
    printWinRef = printWin;

    // 带超时的 loadURL/loadFile（60 秒，服务器带宽较低时 15s 不够用）
    const loadTimeout = 60_000;
    if (msg.jobType === 'url') {
      await Promise.race([
        printWin.loadURL(msg.content),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('加载打印内容超时（60s），请检查网络或服务端是否可达')), loadTimeout)),
      ]);
    } else {
      const tmpFile = path.join(os.tmpdir(), `print-${uuid()}.pdf`);
      fs.writeFileSync(tmpFile, Buffer.from(msg.content, 'base64'));
      await Promise.race([
        printWin.loadFile(tmpFile),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('加载 PDF 超时（60s）')), loadTimeout)),
      ]);
      setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } }, 60_000);
    }
    console.log(`[print] 任务 ${msg.id} 内容加载完成`);

    checkCancelled();
    if (cancelled) { printWin.close(); throw new Error('任务已取消'); }

    // 走到这里说明文档本身已加载完成（loadURL/loadFile 的 promise 已 resolve，即 did-finish-load 已发生），
    // 因此这里只需等图片等子资源：最多 10s，超时放弃等待直接出纸（标签内容不依赖图片时仍可正常打印）。
    // 旧写法在此另设一道 60s 硬失败（报“页面加载超时，请检查网络或服务端是否可达”），而 isLoading() 会被
    // 单张不可达图片长期撑成 true → 任务必挂满 60s 判失败，且紧随其后的 10s 兜底永远执行不到（实机复现）。
    await Promise.race([
      new Promise<void>((resolve) => {
        const wc = printWin.webContents;
        if (!wc.isLoading()) { resolve(); return; }
        wc.once('did-finish-load', () => resolve());
        wc.once('did-stop-loading', () => resolve());
        wc.once('dom-ready', () => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
    console.log(`[print] 任务 ${msg.id} DOM 就绪（子资源等待封顶 10s，不判失败）`);

    // 打印前校验打印机名：网页保存的选择可能是历史缓存（打印机已移除/换机），
    // Electron 对不存在的 deviceName 既不回调也不报错→任务永久挂起；失配时回退本机默认打印机
    const printers = await getPrinterList();
    if (!printers.length) { printWin.close(); throw new Error('本机无任何可用打印机，请先安装打印机'); }
    let deviceName = msg.printerName || '';
    if (deviceName && !printers.some(p => p.name === deviceName)) {
      const fb = printers.find(p => p.isDefault) || printers[0];
      const note = `打印机"${deviceName}"不在本机名单，已改用"${fb.name}"`;
      console.log(`[print] ${note}`);
      log.printerName = fb.name;
      log.error = note;
      pushLog({ ...log });
      deviceName = fb.name;
    }
    console.log(`[print] 任务 ${msg.id} 调用静默打印 deviceName="${deviceName || '系统默认'}" copies=${msg.copies || 1}`);

    // 静默打印（带超时 60 秒，打印机不存在时回调可能不触发）
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        printWin.webContents.print(
          {
            silent: true,
            deviceName: deviceName || undefined,
            copies: msg.copies || 1,
            // 边距设为 none：页眉页脚（日期/标题/网址/页码）无边距空间可画，确保只打印模板内容；同时保留背景色
            printBackground: true,
            margins: { marginType: 'none' },
          },
          (success: boolean, failureReason: string) => {
            if (success) {
              resolve();
            } else {
              reject(new Error(failureReason || '打印失败'));
            }
          }
        );
      }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`打印超时（60s），打印机"${deviceName || '默认'}"可能不存在或无响应`)), loadTimeout)),
    ]);
    console.log(`[print] 任务 ${msg.id} 打印回调成功`);

    // 关闭打印窗口
    printWin.close();

    log.status = 'completed';
    pushLog({ ...log });
    ws?.send(JSON.stringify({ type: 'job_status', jobId: msg.id, status: 'completed' }));
  } catch (err: any) {
    // 失败/超时：立即停载并关闭隐藏窗口，防止残留窗口后台续跑或迟到的 print 回调干扰
    if (printWinRef && !printWinRef.isDestroyed()) {
      try { printWinRef.webContents.stop(); } catch { /* ignore */ }
      printWinRef.close();
    }
    checkCancelled();
    if (cancelled || cancelledJobs.has(msg.id)) {
      // 手动取消的任务：直接从任务日志中移除，不保留失败残行
      cancelledJobs.delete(msg.id);
      removeJobLog(msg.id);
      ws?.send(JSON.stringify({ type: 'job_status', jobId: msg.id, status: 'cancelled' }));
      return;
    }
    console.error(`[print] 任务 ${msg.id} 失败: ${err.message}`);
    log.status = 'failed';
    log.error = err.message;
    pushLog({ ...log });
    ws?.send(JSON.stringify({ type: 'job_status', jobId: msg.id, status: 'failed', error: err.message }));
  }
}

// ============ IPC 通信 ============
function setupIPC() {
  ipcMain.handle('login', handleLogin);

  ipcMain.handle('get-printers', async () => {
    return getPrinterList();
  });

  ipcMain.handle('get-status', () => {
    return {
      connected: isAuthenticated && ws?.readyState === WebSocket.OPEN,
      username,
      serverUrl,
    };
  });

  ipcMain.handle('get-job-logs', () => {
    return jobLogs;
  });

  ipcMain.handle('get-shared-printers', () => {
    return sharedSnapshot;
  });

  ipcMain.handle('set-shared-printers', (_e, names: string[]) => {
    sharedFilter = Array.isArray(names) ? names.map(String) : [];
    reportPrinters();
    return { ok: true };
  });

  ipcMain.handle('check-update', () => {
    checkForUpdate();
    return { ok: true };
  });

  ipcMain.handle('install-update', () => {
    if (!updateDownloaded) return { ok: false, message: '更新尚未下载完成' };
    autoUpdater.quitAndInstall();
    return { ok: true };
  });

  ipcMain.handle('logout', () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    jwtToken = '';
    username = '';
    isAuthenticated = false;
    sendStatusChange('logged_out');
    return { ok: true };
  });

  // 任务日志取消按钮：主进程用已存储的 username 调服务端取消 API（服务端经 WebSocket 转发回本客户端）
  ipcMain.handle('cancel-job', async (_event: any, jobId: string) => {
    if (!jobId) return { ok: false, message: '缺少任务 ID' };
    const base = (serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    try {
      const resp = await fetch(`${base}/api/print/job/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.code === 0) return { ok: true };
      return { ok: false, message: data?.message || `服务端返回 ${resp.status}` };
    } catch (err: any) {
      return { ok: false, message: err?.message || '无法连接服务器' };
    }
  });
}

function sendStatusChange(status: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-change', status);
  }
}

// ============ 应用生命周期 ============

// 中文菜单栏：替换 Electron 默认英文菜单（File/Edit/View/Window/Help）
function setupChineseMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { type: 'separator' },
        { label: '退出', click: () => { tray = null; app.quit(); } },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重置缩放', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '显示主窗口', click: () => mainWindow?.show() },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '打开日志文件夹',
          click: () => {
            try { fs.mkdirSync(logDir(), { recursive: true }); } catch { /* ignore */ }
            shell.openPath(logDir());
          },
        },
        {
          label: '关于讯能手打印客户端',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于讯能手打印客户端',
              message: `讯能手打印客户端 v${app.getVersion()}`,
              detail: '本地打印组件：打印机上报、静默打印、同租户打印机共享。',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  console.log(`[app] 启动 v${app.getVersion()}，日志目录: ${logDir()}`);
  setupChineseMenu();
  createWindow();
  createTray();
  setupIPC();
  setupAutoUpdate();
});

app.on('window-all-closed', () => {
  // 托盘存在时不退出
  if (!tray) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
