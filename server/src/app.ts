import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
// SQLite 数据库（同步导入，确保启动时建表完成）
import './database/sqlite';
import { runCleanupFromDB } from './tasks/cleanup.task';
import { ensureUsageBackfill } from './services/storageUsage';
import { STORE_DRIVER, store } from './database/store';
import { securityHeaders, corsGuard, rateLimit } from './middleware/security';
import { upgradePlaintextUserTable, hashRegisteredUsersJson } from './middleware/syncGuard';

// 路由导入
import customerRoutes from './routes/customer.routes';
import supplierRoutes from './routes/supplier.routes';
import productRoutes from './routes/product.routes';
import materialRoutes from './routes/material.routes';
import orderRoutes from './routes/order.routes';
import productionRoutes from './routes/production.routes';
import purchaseRoutes from './routes/purchase.routes';
import inventoryRoutes from './routes/inventory.routes';
import financeReceivableRoutes from './routes/finance/receivable.routes';
import financePayableRoutes from './routes/finance/payable.routes';
import financeReconciliationRoutes from './routes/finance/reconciliation.routes';
import financeAccountRoutes from './routes/finance/account.routes';
import dashboardRoutes from './routes/dashboard.routes';
import authRoutes from './routes/auth.routes';
import syncRoutes, { warmMetaCache } from './routes/sync.routes';
import jstRoutes from './routes/jst.routes';
import pushRoutes from './routes/push.routes';
import printRoutes from './routes/print.routes';
import chatRoutes from './routes/chat.routes';
import smsRoutes from './routes/sms.routes';
import enterpriseRoutes from './routes/enterprise.routes';
import systemRoutes from './routes/system.routes';
import imageRoutes from './routes/image.routes';
import { startEnterprisePatrol } from './services/enterprisePatrol';
import { initPrintWebSocket } from './ws/print-ws';
import { initChatWebSocket } from './ws/chat-ws';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.disable('x-powered-by');
app.set('trust proxy', 1); // Nginx 反代：取真实客户端 IP 用于限流
app.use(securityHeaders);
app.use(corsGuard);
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// 打印客户端更新源：latest.yml + 安装包（electron-updater generic provider，客户端登录后按 serverUrl/downloads/ 检查更新）
app.use('/downloads', express.static(path.join(__dirname, '../downloads')));

// API路由（先挂限流，再挂业务路由）
app.use('/api/auth/login', rateLimit({ name: 'auth-login', windowMs: 5 * 60_000, max: 30, message: '登录尝试过于频繁，请稍后再试' }));
app.use('/api/auth', rateLimit({ name: 'auth', windowMs: 60_000, max: 120 }));
app.use('/api/sms', rateLimit({ name: 'sms', windowMs: 60_000, max: 60, message: '验证码请求过于频繁，请稍后再试' }));
// 同步轮询：60s 一轮会拉取多键 + 写回，单 IP 每分钟上限 2400 次以拦截脚本扫描，不拦截正常轮询
app.use('/api/sync', rateLimit({ name: 'sync', windowMs: 60_000, max: 2400, message: '同步请求过于频繁，请稍后再试' }));
// 图片空间：上传为 MB 级请求，单独限流避免挤占同步通道
app.use('/api/images', rateLimit({ name: 'images', windowMs: 60_000, max: 300, message: '图片操作过于频繁，请稍后再试' }));

app.use('/api/auth', authRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/enterprise', enterpriseRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/products', productRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/finance/receivable', financeReceivableRoutes);
app.use('/api/finance/payable', financePayableRoutes);
app.use('/api/finance/reconciliation', financeReconciliationRoutes);
app.use('/api/finance/accounts', financeAccountRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/jst', jstRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/print', printRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/images', imageRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 手动触发过期用户数据清理
app.post('/api/system/cleanup-expired', async (_req, res) => {
  try {
    const result = await runCleanupFromDB();
    res.json({ code: 0, data: result, message: `清理完成，删除 ${result?.deletedAccounts?.length || 0} 个账号` });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 全局错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server Error:', err);
  res.status(err.status || 500).json({
    code: err.status || 500,
    message: err.message || '服务器内部错误',
  });
});

// 启动服务（HTTP server 同时承载 REST API + WebSocket）
const server = http.createServer(app);
initPrintWebSocket(server);
initChatWebSocket(server);

server.listen(PORT, async () => {
  console.log(`🚀 工厂管理系统服务已启动: http://localhost:${PORT}`);
  console.log(`✅ 数据库已就绪（驱动：${STORE_DRIVER}）`);
  // 版本表（/api/sync/meta）缓存预热：dataset_store 整表扫描可能很慢，
  // 不预热会让部署后第一个登录/刷新的人等满一次慢查询
  setTimeout(() => warmMetaCache(), 2000);
  // 存储用量计数器背填：仅首次升级（计数器表为空）时全量聚合一次，后续走增量
  void ensureUsageBackfill().catch(() => { /* ignore */ });
  // 安全迁移：存量明文密码升级为 bcrypt（registered_users 表 + registeredUsers 数据集）
  void (async () => {
    try {
      const upgraded = await upgradePlaintextUserTable(store);
      if (upgraded > 0) console.log(`[security] registered_users 明文密码已升级为 bcrypt：${upgraded} 个账号`);
      const rec = await store.getDataset('registeredUsers');
      if (rec) {
        const hashed = await hashRegisteredUsersJson(rec.dataset_json, rec.dataset_json);
        if (hashed !== rec.dataset_json) {
          await store.forceUpsertDataset('registeredUsers', hashed, '', rec.updated_at);
          console.log('[security] registeredUsers 数据集明文密码已升级为 bcrypt 哈希');
        }
      }
    } catch (err: any) {
      console.error('[security] 密码哈希迁移失败:', err?.message || err);
    }
  })();
  // 企业认证 30 天巡检日任务（当日已跑自动跳过）
  try { startEnterprisePatrol(); } catch { /* ignore */ }
  console.log('🖨️  打印 WebSocket 服务已就绪: ws://localhost:' + PORT + '/ws/print');
  console.log('💬 聊天 WebSocket 服务已就绪: ws://localhost:' + PORT + '/ws/chat');

  // 启动时立即执行一次过期数据清理
  setTimeout(async () => {
    console.log('🧹 执行过期用户数据清理（启动时）...');
    try {
      await runCleanupFromDB();
    } catch (err: any) {
      console.error('清理任务执行失败:', err.message);
    }
  }, 5000);

  // 每24小时自动执行一次过期数据清理
  setInterval(async () => {
    console.log('🧹 执行定时过期用户数据清理...');
    try {
      await runCleanupFromDB();
    } catch (err: any) {
      console.error('定时清理任务执行失败:', err.message);
    }
  }, 24 * 60 * 60 * 1000);
});

export default app;
