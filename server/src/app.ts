import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
// SQLite 数据库（同步导入，确保启动时建表完成）
import './database/sqlite';
import { runCleanupFromDB } from './tasks/cleanup.task';
import { ensureUsageBackfill } from './services/storageUsage';
import { STORE_DRIVER, store, storeBase } from './database/store';
import { startWriteBehindReplay } from './database/writeBehind';
import { securityHeaders, corsGuard, rateLimit } from './middleware/security';
import { upgradePlaintextUserTable, hashRegisteredUsersJson } from './middleware/syncGuard';
import { migrateStrandedOwnerDatasets, startStrandedMigrationLoop } from './services/strandedRebucket';

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
import wxRoutes from './routes/wx.routes';
import syncRoutes, { warmMetaCache } from './routes/sync.routes';
import jstRoutes from './routes/jst.routes';
import pushRoutes from './routes/push.routes';
import printRoutes from './routes/print.routes';
import chatRoutes from './routes/chat.routes';
import smsRoutes from './routes/sms.routes';
import enterpriseRoutes from './routes/enterprise.routes';
import systemRoutes from './routes/system.routes';
import imageRoutes from './routes/image.routes';
import marketRoutes from './routes/market.routes';
import moldRoutes from './routes/mold.routes';
import newstyleRoutes from './routes/newstyle.routes';
import cooperationRoutes from './routes/cooperation.routes';
import { migrateLegacyMarketKey } from './services/market-listings';
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
// 微信小程序接口：登录/绑定含微信 code 换取与凭据校验，与 auth 同档限流
app.use('/api/wx', rateLimit({ name: 'wx', windowMs: 60_000, max: 120 }));
app.use('/api/sms', rateLimit({ name: 'sms', windowMs: 60_000, max: 60, message: '验证码请求过于频繁，请稍后再试' }));
// 同步轮询：60s 一轮会拉取多键 + 写回，单 IP 每分钟上限 2400 次以拦截脚本扫描，不拦截正常轮询
app.use('/api/sync', rateLimit({ name: 'sync', windowMs: 60_000, max: 2400, message: '同步请求过于频繁，请稍后再试' }));
// 图片空间：上传为 MB 级请求，单独限流避免挤占同步通道
app.use('/api/images', rateLimit({ name: 'images', windowMs: 60_000, max: 300, message: '图片操作过于频繁，请稍后再试' }));
// 商机市场独立库：列表/批量写入/报价，按登录轮询与发布峰值给额度
app.use('/api/market', rateLimit({ name: 'market', windowMs: 60_000, max: 600, message: '市场请求过于频繁，请稍后再试' }));
// 模具管理权威真表：列表/增删改，低频业务按常规额度
app.use('/api/molds', rateLimit({ name: 'molds', windowMs: 60_000, max: 300, message: '模具请求过于频繁，请稍后再试' }));
// 新款进度权威真表：列表/整表提交，低频业务按常规额度
app.use('/api/newstyle', rateLimit({ name: 'newstyle', windowMs: 60_000, max: 300, message: '新款进度请求过于频繁，请稍后再试' }));
// 供应商菜单/合作握手权威真表：快照读 + 授权写入，低频业务按常规额度
app.use('/api/cooperation', rateLimit({ name: 'cooperation', windowMs: 60_000, max: 600, message: '合作请求过于频繁，请稍后再试' }));

app.use('/api/auth', authRoutes);
app.use('/api/wx', wxRoutes);
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
app.use('/api/market', marketRoutes);
app.use('/api/molds', moldRoutes);
app.use('/api/newstyle', newstyleRoutes);
app.use('/api/cooperation', cooperationRoutes);

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
  // 写兜底回放：DB 故障期间落磁盘的数据集在 DB 恢复后自动写回 MySQL（启动 15s 首跑、每 5 分钟一轮）
  startWriteBehindReplay(storeBase);
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
  // 错桶迁移：子账号被当成主账号时写进个人桶的订单/账单等，启动时并入主账号桶（幂等，DB 不可写则下次重试）
  void migrateStrandedOwnerDatasets().then((n) => { if (n > 0) console.log(`[rebucket] 启动错桶迁移完成：${n} 个数据集已归并`); }).catch(() => { /* ignore */ });
  // 商机市场旧键一次性迁移：market_publish_orders 存量存活记录迁入独立库 market_listings（幂等）
  void migrateLegacyMarketKey().catch(() => { /* ignore */ });
  // 运行期周期迁移：隶属关系运行期变化（在线串联/改绑）后无需等重启即可收敛
  startStrandedMigrationLoop();
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
