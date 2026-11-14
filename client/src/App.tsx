import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Skeleton } from 'antd';
import { pullAllDatasets, pullPermDatasets, isPermSyncKey } from './utils/serverSync';
import { syncOwnerFromToken } from './utils/dataOwner';
import { PRESET_PRINT_TEMPLATES, seedPresetPrintTemplates } from './config/presetPrintTemplates';
import { connectChatWS, disconnectChatWS, REMOTE_UPDATE_EVENT } from './utils/chatSocket';
import MainLayout from './layouts/MainLayout';
import PurchaserLayout from './layouts/PurchaserLayout';
import FactoryLayout from './layouts/FactoryLayout';
import DevLayout from './layouts/DevLayout';

// 懒加载所有页面组件
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const ModulePage = React.lazy(() => import('./pages/ModulePage'));
const ModuleChildPage = React.lazy(() => import('./pages/ModuleChildPage'));
const AccountManage = React.lazy(() => import('./pages/AccountManage'));
const RoleManage = React.lazy(() => import('./pages/RoleManage'));
const ReconciliationManage = React.lazy(() => import('./pages/ReconciliationManage'));
const CustomerInfo = React.lazy(() => import('./pages/CustomerInfo'));
const PriceStrategyPage = React.lazy(() => import('./components/PriceStrategyPage'));
const PurchaserDashboard = React.lazy(() => import('./components/PurchaserDashboard'));
const CooperationManage = React.lazy(() => import('./pages/CooperationManage'));
const Auth = React.lazy(() => import('./pages/Auth'));
const DevLogin = React.lazy(() => import('./pages/DevLogin'));
const DevDashboard = React.lazy(() => import('./pages/DevDashboard'));
const StoragePricing = React.lazy(() => import('./pages/StoragePricing'));
const PurchaserCooperationManage = React.lazy(() => import('./pages/PurchaserCooperationManage'));
const PurchaserSupplierList = React.lazy(() => import('./pages/PurchaserSupplierList'));
const PurchaserBillPage = React.lazy(() => import('./pages/PurchaserBillPage'));
const PurchaserProfile = React.lazy(() => import('./pages/PurchaserProfile'));
const CooperationConfirmPage = React.lazy(() => import('./pages/CooperationConfirmPage'));
const PurchaserCooperationConfirmPage = React.lazy(() => import('./pages/PurchaserCooperationConfirmPage'));
const PurchaserInvitePage = React.lazy(() => import('./pages/PurchaserInvitePage'));
const WorkflowTemplatePage = React.lazy(() => import('./pages/production/WorkflowTemplatePage'));
const JstPage = React.lazy(() => import('./pages/JstPage'));
const JstDataPage = React.lazy(() => import('./pages/JstDataPage'));
const ShopProfitPage = React.lazy(() => import('./pages/ShopProfitPage'));
const ShopListPage = React.lazy(() => import('./pages/ShopListPage'));
const MonthEndCheckPage = React.lazy(() => import('./pages/MonthEndCheckPage'));
const WithdrawalRecordPage = React.lazy(() => import('./pages/WithdrawalRecordPage'));
const DailyBookkeepingPage = React.lazy(() => import('./pages/DailyBookkeepingPage'));
const BookkeepingStatsPage = React.lazy(() => import('./pages/BookkeepingStatsPage'));
const ShopManagementPage = React.lazy(() => import('./pages/ShopManagementPage'));
const BusinessLicensePage = React.lazy(() => import('./pages/BusinessLicensePage'));
const NotificationSettingsPage = React.lazy(() => import('./pages/NotificationSettings'));
const ContractFactoryPage = React.lazy(() => import('./pages/ContractFactoryPage'));
const ReimbursementPage = React.lazy(() => import('./pages/ReimbursementPage'));
const FactoryCooperationPage = React.lazy(() => import('./pages/FactoryCooperationPage'));
const MarketPage = React.lazy(() => import('./pages/MarketPage'));
const NewStyleProgressPage = React.lazy(() => import('./pages/NewStyleProgressPage'));
const BrandManagePage = React.lazy(() => import('./pages/BrandManagePage'));
const BrandApplyPage = React.lazy(() => import('./pages/BrandApplyPage'));
const BrandCertPage = React.lazy(() => import('./pages/BrandCertPage'));
const SharedInventoryPage = React.lazy(() => import('./pages/SharedInventoryPage'));
const SharedCartPage = React.lazy(() => import('./pages/SharedCartPage'));
const MarketOrdersPage = React.lazy(() => import('./pages/MarketOrdersPage'));
const DevAccountManage = React.lazy(() => import('./pages/dev/DevAccountManage'));
const DevOrdersPage = React.lazy(() => import('./pages/dev/DevOrdersPage'));
const DevRolesPage = React.lazy(() => import('./pages/dev/DevRolesPage'));
const DevPointsRewardsPage = React.lazy(() => import('./pages/dev/DevPointsRewardsPage'));
const DevFeedbackPage = React.lazy(() => import('./pages/dev/DevFeedbackPage'));
const DevAnnouncementPage = React.lazy(() => import('./pages/dev/DevAnnouncementPage'));
const DevIntegrationSettings = React.lazy(() => import('./pages/dev/DevIntegrationSettings'));
const DevCustomerStats = React.lazy(() => import('./pages/dev/DevStatsPages').then(m => ({ default: m.DevCustomerStats })));
const DevStaffPaymentPage = React.lazy(() => import('./pages/dev/DevPaymentPages').then(m => ({ default: m.DevStaffPaymentPage })));
const DevGroupStatsPage = React.lazy(() => import('./pages/dev/DevGroupStatsPage'));
const DevActionPointsPage = React.lazy(() => import('./pages/dev/DevActionPointsPage'));
const DevPointsStatsPage = React.lazy(() => import('./pages/dev/DevPointsStatsPage'));
const DevPerformanceNewPage = React.lazy(() => import('./pages/dev/DevPerformanceNewPage'));
const AttendancePage = React.lazy(() => import('./pages/hr/AttendancePage'));
const SalaryPage = React.lazy(() => import('./pages/hr/SalaryPage'));
const EmployeePage = React.lazy(() => import('./pages/hr/EmployeePage'));
const ShiftPage = React.lazy(() => import('./pages/hr/ShiftPage'));
const LeavePage = React.lazy(() => import('./pages/hr/LeavePage'));
const ResignedPage = React.lazy(() => import('./pages/hr/ResignedPage'));
const PaymentRequestPage = React.lazy(() => import('./pages/PaymentRequestPage'));
const InvoiceApplyPage = React.lazy(() => import('./pages/InvoiceApplyPage'));
const GeneralLedgerPage = React.lazy(() => import('./pages/GeneralLedgerPage'));
const SimpleLedgerPage = React.lazy(() => import('./pages/SimpleLedgerPage'));
const BossDashboard = React.lazy(() => import('./pages/BossDashboard'));
const PurchaseReceivingPage = React.lazy(() => import('./pages/inventory/PurchaseReceivingPage'));
const InventoryCheckPage = React.lazy(() => import('./pages/inventory/InventoryCheckPage'));
const InventoryOutboundPage = React.lazy(() => import('./pages/inventory/InventoryOutboundPage'));
const ProdInboundStatsPage = React.lazy(() => import('./pages/inventory/ProdInboundStatsPage'));
const OrderProfitPage = React.lazy(() => import('./pages/OrderProfitPage'));
const WarehouseStatsPage = React.lazy(() => import('./pages/WarehouseStatsPage'));
const MoldPage = React.lazy(() => import('./pages/MoldPage'));
// 图片空间：基础数据下的云端统一图片库（须注册在通配路由之前）
const ImageSpacePage = React.lazy(() => import('./pages/ImageSpacePage'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: 40 }}>
    <span style={{ color: '#999' }}>加载中...</span>
  </div>
);

// 系统预设打印模板种入（只补不覆写）：登录拉取完成后执行，保证所有租户/所有页面（含打印弹窗下拉）均可见预设
const seedAllPresets = () => {
  try { Object.keys(PRESET_PRINT_TEMPLATES).forEach(seedPresetPrintTemplates); } catch { /* 忽略本地写入失败 */ }
};

// 跨浏览器同步闸门：
// 1) 启动/登录瞬间先拉取服务器较新数据再渲染页面（超时 2.5s 自动放行）；
// 2) 登录状态下每 30s 后台轮询拉取，多浏览器同时在线时自动更新（不阻塞 UI）。
const SyncGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = React.useState(false);
  const location = useLocation();
  const startedRef = React.useRef(false);
  const intervalRef = React.useRef<any>(null);

  const gatedPull = React.useCallback(() => {
    setReady(false);
    // 上限 2.5s：拉取未完结也先放行渲染（后续落地会广播 sync-data-updated 自动刷新），
    // 避免弱网/大数据量时登录与刷新长时间停在“加载中”
    const timer = setTimeout(() => { setReady(true); seedAllPresets(); }, 2500);
    // 先用令牌校正数据归属账号（子账号归主账号）再拉取：刷新页面时 localStorage 里的
    // parentAccount 可能是陈旧值/为空，拉错桶会让主账号与负责人看不到子账号提交的单据
    syncOwnerFromToken()
      .catch(() => '')
      .then(() => pullAllDatasets())
      .finally(() => { clearTimeout(timer); setReady(true); seedAllPresets(); });
  }, []);

  React.useEffect(() => {
    const logged = !!localStorage.getItem('username');
    if (logged) {
      if (!startedRef.current) { startedRef.current = true; gatedPull(); }
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => { void pullAllDatasets(); }, 60000); // 60秒轮询，降低竞争
      }
      // 登录后初始化聊天 WebSocket
      connectChatWS();
    } else {
      startedRef.current = false;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      // 退出登录时断开聊天 WebSocket
      disconnectChatWS();
      setReady(true);
    }
  }, [location, gatedPull]);

  // 浏览器切回前台/标签页获得焦点时拉取服务端最新数据，
  // 但添加 30 秒冷却期，避免频繁拉取导致本地新数据被服务端旧数据覆盖
  React.useEffect(() => {
    let lastPullTs = 0;
    const onWake = () => {
      if (!localStorage.getItem('username')) return;
      const now = Date.now();
      if (now - lastPullTs < 30000) return; // 30秒冷却
      lastPullTs = now;
      void pullAllDatasets();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') onWake(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onWake);
    };
  }, []);

  React.useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  // 空闲预取供应商首页 chunk（登录默认落地页与跨平台切换目标）：
  // 登录后/刷新后图表与页面 chunk 已在缓存，点击“切换到供应商视图”或落地时不再等懒加载下载
  React.useEffect(() => {
    if (!ready) return;
    const w = window as any;
    const idle = w.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 2000));
    idle(() => { void import('./pages/Dashboard'); });
  }, [ready]);

  // 权限变更实时生效：其他浏览器/其他电脑改了角色或子账号权限 →
  // 服务端经 WebSocket 广播 dataset_updated → 这里立即增量拉取并重算菜单（无需刷新，也不等 60 秒轮询）
  React.useEffect(() => {
    let timer: any = null;
    const onRemoteUpdate = (e: Event) => {
      const key = String((e as CustomEvent)?.detail?.key || '');
      if (!key || !isPermSyncKey(key)) return;
      if (timer) return; // 600ms 内的多次写入合并为一次拉取
      timer = setTimeout(() => {
        timer = null;
        void pullPermDatasets();
      }, 600);
    };
    window.addEventListener(REMOTE_UPDATE_EVENT, onRemoteUpdate);
    return () => {
      window.removeEventListener(REMOTE_UPDATE_EVENT, onRemoteUpdate);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return ready ? <>{children}</> : (
    <div style={{ padding: 24 }}>
      <Skeleton active paragraph={{ rows: 6 }} title={{ width: '40%' }} />
    </div>
  );
};

function App() {
  return (
    <React.Suspense fallback={<Loading />}>
      <SyncGate>
      <Routes>
        {/* 统一认证页面（登录/注册） */}
        <Route path="/login" element={<Auth />} />
        <Route path="/register" element={<Auth />} />
        
        {/* 供应商后台（主布局） */}
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          {/* 账号管理 - 专用页面，支持新建子账号 */}
          <Route path="settings/account-manage" element={<AccountManage />} />
          <Route path="settings/role-manage" element={<RoleManage />} />
          <Route path="settings/notification-settings" element={<NotificationSettingsPage />} />
          {/* 对账管理 - 专用页面（菜单已迁至客户管理），旧财务路径重定向 */}
          <Route path="customer/reconciliation" element={<ReconciliationManage />} />
          <Route path="finance/reconciliation" element={<Navigate to="/customer/reconciliation" replace />} />
          {/* 店铺管理 - 内部侧边栏包装页面 */}
          <Route path="finance/shop-management" element={<ShopManagementPage />} />
          <Route path="finance/shop-management/profit" element={<ShopProfitPage />} />
          <Route path="finance/shop-management/list" element={<ShopListPage />} />
          <Route path="finance/shop-management/check" element={<MonthEndCheckPage />} />
          <Route path="finance/shop-management/withdrawal" element={<WithdrawalRecordPage />} />
          <Route path="finance/shop-management/business-license" element={<BusinessLicensePage />} />
          {/* 合作管理 - 合作申请 */}
          <Route path="customer/cooperation-manage" element={<CooperationManage />} />
          {/* 客户信息 - 专用页面，显示直接客户和已合作的采购商 */}
          <Route path="customer/customer-info" element={<CustomerInfo />} />
          {/* 客户管理 - 采购价设置（一客一价策略） */}
          <Route path="customer/price-strategy" element={<PriceStrategyPage />} />
          {/* 空间订购 */}
          <Route path="storage-pricing" element={<StoragePricing />} />
          {/* 生产流程模板管理 */}
          <Route path="production/workflow-templates" element={<WorkflowTemplatePage />} />
          {/* 聚水潭数据对接调试页 */}
          <Route path="jst/shop-product" element={<JstDataPage type="shop-product" />} />
          <Route path="jst/data-order" element={<JstDataPage type="data-order" />} />
          <Route path="jst/data-inventory" element={<JstDataPage type="data-inventory" />} />
          <Route path="jst/data-outbound" element={<JstDataPage type="data-outbound" />} />
          <Route path="jst/:childKey" element={<JstPage />} />
          {/* 供应商 - 代加工厂（外协代加工合作工厂） */}
          <Route path="supplier/contract-factory" element={<ContractFactoryPage />} />
          {/* 商机市场（发包市场+成品市场，三端自适应） */}
          <Route path="market/opportunity" element={<MarketPage />} />
          {/* 新款进度（供应商/采购商双平台共享同一数据） */}
          <Route path="newstyle/progress" element={<NewStyleProgressPage />} />
          {/* 品牌管理（内含 授权品牌/自有品牌 页签） */}
          <Route path="brandauth/manage" element={<BrandManagePage />} />
          {/* 仓库统计（备货单/配货/急采/工价/工资汇总） */}
          <Route path="ecommerce/warehouse-stats" element={<WarehouseStatsPage />} />
          {/* 电商常用 - 统一路由入口（与旧路由并存，兼容旧链接） */}
          <Route path="ecommerce/progress" element={<NewStyleProgressPage />} />
          <Route path="ecommerce/shop-management" element={<ShopManagementPage />} />
          <Route path="ecommerce/shop-management/profit" element={<ShopProfitPage />} />
          <Route path="ecommerce/shop-management/list" element={<ShopListPage />} />
          <Route path="ecommerce/shop-management/check" element={<MonthEndCheckPage />} />
          <Route path="ecommerce/shop-management/withdrawal" element={<WithdrawalRecordPage />} />
          <Route path="ecommerce/shop-management/business-license" element={<BusinessLicensePage />} />
          <Route path="ecommerce/opportunity" element={<MarketPage />} />
          <Route path="ecommerce/manage" element={<BrandManagePage />} />
          {/* 订单毛利率 */}
          <Route path="sales/order-profit" element={<OrderProfitPage />} />
          {/* 报销管理 */}
          <Route path="finance/reimbursement" element={<ReimbursementPage />} />
          {/* 付款申请 */}
          <Route path="finance/payment-request" element={<PaymentRequestPage />} />
          {/* 开票申请（供应商侧收件箱） */}
          <Route path="finance/invoice-apply" element={<InvoiceApplyPage />} />
          {/* 总账薄 */}
          <Route path="finance/general-ledger" element={<GeneralLedgerPage />} />
          <Route path="finance/simple-ledger" element={<SimpleLedgerPage />} />
          {/* 老板看板（经营核心指标汇总） */}
          <Route path="finance/boss-dashboard" element={<BossDashboard />} />
          {/* 人事管理 */}
          <Route path="hr-manage/attendance" element={<AttendancePage />} />
          <Route path="hr-manage/salary" element={<SalaryPage />} />
          <Route path="hr-manage/employee" element={<EmployeePage />} />
          <Route path="hr-manage/shift" element={<ShiftPage />} />
          <Route path="hr-manage/leave" element={<LeavePage />} />
          <Route path="hr-manage/resigned" element={<ResignedPage />} />
          {/* 日常记账 - 三平台共用记账页（须注册在通配路由之前） */}
          <Route path="finance/daily-bookkeeping" element={<DailyBookkeepingPage />} />
          <Route path="finance/daily-bookkeeping-stats" element={<BookkeepingStatsPage />} />
          {/* 库存管理 - 采购入库/库存盘点/库存出库 */}
          <Route path="inventory/purchase-receiving" element={<PurchaseReceivingPage />} />
          <Route path="inventory/inventory-check" element={<InventoryCheckPage />} />
          <Route path="inventory/inventory-outbound" element={<InventoryOutboundPage />} />
          {/* 库存管理 - 生产入库统计（独立统计页，读取生产完工联动数据） */}
          <Route path="inventory/prod-in-stats" element={<ProdInboundStatsPage />} />
          {/* 模具管理 */}
          <Route path="basic-data/mold" element={<MoldPage />} />
          <Route path="basic-data/image-space" element={<ImageSpacePage />} />
          {/* 各模块的子功能页面 */}
          <Route path=":moduleKey" element={<ModulePage />} />
          <Route path=":moduleKey/:childKey" element={<ModuleChildPage />} />
        </Route>
        
        {/* 采购商后台（独立布局） */}
        <Route path="/purchaser" element={<PurchaserLayout />}>
          <Route index element={<Navigate to="/purchaser/dashboard" replace />} />
          <Route path="dashboard" element={<PurchaserDashboard />} />
          <Route path="orders" element={<MarketOrdersPage />} />
          <Route path="cooperation" element={<Navigate to="/purchaser/suppliers/cooperation" replace />} />
          <Route path="suppliers" element={<Navigate to="/purchaser/suppliers/list" replace />} />
          <Route path="suppliers/list" element={<PurchaserSupplierList />} />
          {/* 采购商 - 成品市场（商机市场成品模块） */}
          <Route path="market/finished" element={<MarketPage />} />
          {/* 采购商 - 新款进度（与供应商平台共享同一数据） */}
          <Route path="newstyle/progress" element={<NewStyleProgressPage />} />
          {/* 采购商 - 品牌管理（含我的授权书子页签） */}
          <Route path="brandauth/manage" element={<BrandManagePage platform="purchaser" />} />
          {/* 采购商 - 仓库统计（与供应商平台共享同一数据） */}
          <Route path="ecommerce/warehouse-stats" element={<WarehouseStatsPage />} />
          {/* 采购商 - 电商常用统一路由 */}
          <Route path="ecommerce/progress" element={<NewStyleProgressPage />} />
          <Route path="ecommerce/manage" element={<BrandManagePage platform="purchaser" />} />
          <Route path="ecommerce/shop-management" element={<ShopManagementPage />} />
          <Route path="ecommerce/shop-management/profit" element={<ShopProfitPage />} />
          <Route path="ecommerce/shop-management/list" element={<ShopListPage />} />
          <Route path="ecommerce/shop-management/check" element={<MonthEndCheckPage />} />
          <Route path="ecommerce/shop-management/withdrawal" element={<WithdrawalRecordPage />} />
          <Route path="ecommerce/shop-management/business-license" element={<BusinessLicensePage />} />
          <Route path="suppliers/factory-list" element={<ContractFactoryPage title="加工厂列表" />} />
          <Route path="suppliers/bill" element={<PurchaserBillPage />} />
          <Route path="suppliers/cooperation" element={<PurchaserCooperationManage />} />
          {/* 商品资料 - 成品页面（与供应商平台基础数据-成品共享同一数据和功能） */}
          <Route path="product-data/:childKey" element={<ModuleChildPage />} />
          <Route path="profile" element={<PurchaserProfile />} />
          {/* 系统设置 - 与供应商平台完全一致 */}
          <Route path="settings/account-manage" element={<AccountManage />} />
          <Route path="settings/role-manage" element={<RoleManage />} />
          <Route path="settings/notification-settings" element={<NotificationSettingsPage />} />
          <Route path="settings/:childKey" element={<ModuleChildPage />} />
          {/* 财务管理 - 通配finance下未显式声明的子页面（如银行账户等） */}
          {/* 报销管理 */}
          <Route path="finance/reimbursement" element={<ReimbursementPage />} />
          <Route path="finance/payment-request" element={<PaymentRequestPage />} />
          <Route path="finance/invoice-apply" element={<InvoiceApplyPage />} />
          <Route path="finance/daily-bookkeeping" element={<DailyBookkeepingPage />} />
          <Route path="finance/daily-bookkeeping-stats" element={<BookkeepingStatsPage />} />
          <Route path="finance/general-ledger" element={<GeneralLedgerPage />} />
          <Route path="finance/simple-ledger" element={<SimpleLedgerPage />} />
          <Route path="finance/boss-dashboard" element={<BossDashboard />} />
          <Route path="finance/:childKey" element={<ModuleChildPage />} />
          {/* 对账管理（菜单已迁至供应商菜单），旧财务路径重定向 */}
          <Route path="suppliers/reconciliation" element={<ReconciliationManage />} />
          <Route path="finance/reconciliation" element={<Navigate to="/purchaser/suppliers/reconciliation" replace />} />
          {/* 店铺管理 - 内部侧边栏包装页面 */}
          <Route path="finance/shop-management" element={<ShopManagementPage />} />
          <Route path="finance/shop-management/profit" element={<ShopProfitPage />} />
          <Route path="finance/shop-management/list" element={<ShopListPage />} />
          <Route path="finance/shop-management/check" element={<MonthEndCheckPage />} />
          <Route path="finance/shop-management/withdrawal" element={<WithdrawalRecordPage />} />
          <Route path="finance/shop-management/business-license" element={<BusinessLicensePage />} />
          {/* 空间订购 */}
          <Route path="storage-pricing" element={<StoragePricing />} />
        </Route>

        {/* 供应商合作确认页面（独立页面，通过链接访问） */}
        <Route path="/cooperation-confirm/:token" element={<CooperationConfirmPage />} />

        {/* 货盘公开分享页（独立页面，无需登录，分享链接直达） */}
        <Route path="/shared/inventory" element={<SharedInventoryPage />} />

        {/* 购物车分享公开页（独立页面，供应商打开链接可一键生成订单） */}
        <Route path="/shared/cart" element={<SharedCartPage />} />

        {/* 品牌授权外部申请公开页（代理商无需登录提交授权申请） */}
        <Route path="/brand-apply/:code" element={<BrandApplyPage />} />

        {/* 授权书公开查询页（无需登录，凭随机 shareCode 查看/下载） */}
        <Route path="/brand-cert/:shareCode" element={<BrandCertPage />} />

        {/* 加工厂后台（独立布局，与采购商平台类似） */}
        <Route path="/factory" element={<FactoryLayout />}>
          <Route index element={<Navigate to="/factory/dashboard" replace />} />
          <Route path="dashboard" element={<div style={{ padding: 24 }}><h2>加工厂首页</h2><p>欢迎来到外协代加工厂管理平台</p></div>} />
          <Route path="cooperation" element={<FactoryCooperationPage />} />
          <Route path="market/opportunity" element={<MarketPage />} />
          {/* 加工订单/财务管理 - 复用通用子页面 */}
          <Route path="production/:childKey" element={<ModuleChildPage />} />
          <Route path="finance/reimbursement" element={<ReimbursementPage />} />
          <Route path="finance/daily-bookkeeping" element={<DailyBookkeepingPage />} />
          <Route path="finance/daily-bookkeeping-stats" element={<BookkeepingStatsPage />} />
          <Route path="finance/general-ledger" element={<GeneralLedgerPage />} />
          <Route path="finance/simple-ledger" element={<SimpleLedgerPage />} />
          <Route path="finance/:childKey" element={<ModuleChildPage />} />
          {/* 系统设置 - 与供应商平台完全一致 */}
          <Route path="settings/account-manage" element={<AccountManage />} />
          <Route path="settings/role-manage" element={<RoleManage />} />
          <Route path="settings/notification-settings" element={<NotificationSettingsPage />} />
          <Route path="settings/:childKey" element={<ModuleChildPage />} />
          {/* 企业信息 */}
          <Route path="profile" element={<div style={{ padding: 24 }}><h2>企业信息</h2><p>加工厂企业资料维护</p></div>} />
        </Route>

        {/* 采购商合作确认页面（独立页面，供应商邀约链接打开） */}
        <Route path="/purchaser-cooperation-confirm/:token" element={<PurchaserCooperationConfirmPage />} />

        {/* 供应商邀约合作落地页（链接仅携带公司编号；已登录跳转供应商列表页弹窗受理） */}
        <Route path="/purchaser-invite/:token" element={<PurchaserInvitePage />} />

        {/* 开发者后台（独立布局：客户管理/业绩分析/系统设置）；登录地址后缀混淆，不对外公开 */}
        <Route path="/xunnengs/entry-7x2qf9" element={<DevLogin />} />
        <Route path="/xunnengs/dashboard" element={<Navigate to="/xunnengs/customers/all" replace />} />
        <Route path="/xunnengs" element={<DevLayout />}>
          <Route index element={<Navigate to="/xunnengs/customers/all" replace />} />
          {/* 客户管理：现有注册客户列表即客户列表 */}
          <Route path="customers/all" element={<DevDashboard />} />
          <Route path="customers/orders" element={<DevOrdersPage />} />
          <Route path="customers/mine" element={<DevDashboard />} />
          <Route path="customers/pool" element={<DevDashboard />} />
          <Route path="customers/stats" element={<DevCustomerStats />} />
          {/* 业绩分析（参考 my-crm analytics/*） */}
          <Route path="analytics/payment" element={<DevStaffPaymentPage />} />
          <Route path="analytics/group-stats" element={<DevGroupStatsPage />} />
          <Route path="analytics/action-points" element={<DevActionPointsPage />} />
          <Route path="analytics/points-stats" element={<DevPointsStatsPage />} />
          <Route path="analytics/performance" element={<DevPerformanceNewPage />} />
          {/* 系统设置：开发者子账号管理 / 角色权限 / 积分兑换奖品 */}
          <Route path="settings/accounts" element={<DevAccountManage />} />
          <Route path="settings/roles" element={<DevRolesPage />} />
          <Route path="settings/points" element={<DevPointsRewardsPage />} />
          <Route path="settings/feedback" element={<DevFeedbackPage />} />
          <Route path="settings/announcement" element={<DevAnnouncementPage />} />
          <Route path="settings/integration" element={<DevIntegrationSettings />} />
        </Route>
      </Routes>
      </SyncGate>
    </React.Suspense>
  );
}

export default App;
