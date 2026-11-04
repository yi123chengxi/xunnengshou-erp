/**
 * 权限点页面扫描生成器：扫描各页面源码与 pageConfig 配置，按「菜单 → 子页面(Tab/配置页) → 字段/按键」生成权限点注册片段
 * 用法：cd client && node scripts/gen-perm-points.js
 * 产物：src/config/permPageScan.generated.ts（SCANNED_PAGES）
 * 规则：
 *  - 独立页面：字段=表格列定义（title+dataIndex 相邻，两种顺序）；多 Tab 页按 activeTab === 'x' 分段归属子页面；
 *  - 按键=页面/分段内关键词存在性（新增/编辑/删除/导入/导出/批量/显示字段/打印/审核）；
 *  - 配置页（pageConfig/pageConfig2）：字段=配置列；按键=块内关键词，无关键词时给通用工具栏六件套；
 *  - 独立页面优先于配置页（同菜单两者都有时配置页跳过）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = path.join(ROOT, 'src', 'pages');

const SLUG_OVERRIDE = {
  ShopListPage: 'shoplist', MonthEndCheckPage: 'monthend', ShopProfitPage: 'profit',
  WithdrawalRecordPage: 'withdrawal', NewStyleProgressPage: 'progress', BusinessLicensePage: 'license',
  InvoiceRecordPage: 'invoice', CustomerInfo: 'customer', MarketPage: 'market', WarehouseStatsPage: 'warehouse',
};

// 菜单 key → 独立页面文件（相对 src/pages，可 ../ 到 components）
const MENU_PAGES = {
  'ecommerce/progress': ['NewStyleProgressPage'],
  'ecommerce/shop-management': ['ShopListPage', 'MonthEndCheckPage', 'ShopProfitPage', 'WithdrawalRecordPage', 'BusinessLicensePage', 'InvoiceRecordPage'],
  'ecommerce/opportunity': ['MarketPage'],
  'ecommerce/warehouse-stats': ['WarehouseStatsPage'],
  'ecommerce/manage': ['BrandManagePage'],
  'basic-data/mold': ['MoldPage'],
  'basic-data/product-print': ['ProductPrintPage'],
  'customer/customer-info': ['CustomerInfo'],
  'customer/cooperation-manage': ['CooperationManage'],
  'customer/reconciliation': ['ReconciliationManage'],
  'customer/price-strategy': ['../components/PriceStrategyPage'],
  'sales/order-profit': ['OrderProfitPage'],
  'production/workflow-templates': ['production/WorkflowTemplatePage'],
  'inventory/prod-in-stats': ['inventory/ProdInboundStatsPage'],
  'inventory/purchase-receiving': ['inventory/PurchaseReceivingPage'],
  'inventory/inventory-check': ['inventory/InventoryCheckPage'],
  'inventory/inventory-outbound': ['inventory/InventoryOutboundPage'],
  'finance/reimbursement': ['ReimbursementPage'],
  'finance/payment-request': ['PaymentRequestPage'],
  'finance/invoice-apply': ['InvoiceApplyPage'],
  'finance/general-ledger': ['GeneralLedgerPage'],
  'finance/simple-ledger': ['SimpleLedgerPage'],
  'finance/daily-bookkeeping': ['DailyBookkeepingPage'],
  'finance/daily-bookkeeping-stats': ['BookkeepingStatsPage'],
  'hr-manage/attendance': ['hr/AttendancePage'],
  'hr-manage/salary': ['hr/SalaryPage'],
  'hr-manage/employee': ['hr/EmployeePage'],
  'hr-manage/shift': ['hr/ShiftPage'],
  'hr-manage/leave': ['hr/LeavePage'],
  'settings/account-manage': ['AccountManage'],
  'settings/role-manage': ['RoleManage'],
  'settings/notification-settings': ['NotificationSettings'],
};

// 供应商后台菜单 key 全量（与 permRegistry PERM_MENUS.supplier 同步）
const SUPPLIER_MENU_KEYS = [
  'ecommerce/progress', 'ecommerce/shop-management', 'ecommerce/opportunity', 'ecommerce/warehouse-stats', 'ecommerce/manage',
  'basic-data/product-list', 'basic-data/finished-product', 'basic-data/product-bom', 'basic-data/raw-material', 'basic-data/prod-process', 'basic-data/plan-design', 'basic-data/mold', 'basic-data/product-print',
  'customer/customer-info', 'customer/cooperation-manage', 'customer/bill-detail', 'customer/reconciliation', 'customer/price-strategy',
  'sales/order-manage', 'sales/order-profit', 'sales/sales-ranking', 'sales/finance-audit', 'sales/print-picking', 'sales/sales-out-stats',
  'production/production-order', 'production/processing-order', 'production/purchase-requisition', 'production/workflow-templates', 'production/production-schedule',
  'inventory/prod-in-stats', 'inventory/purchase-receiving', 'inventory/inventory-check', 'inventory/inventory-outbound',
  'finance/bank-account', 'finance/reimbursement', 'finance/payment-request', 'finance/general-ledger', 'finance/simple-ledger',
  'hr-manage/attendance', 'hr-manage/salary', 'hr-manage/employee', 'hr-manage/shift', 'hr-manage/leave',
  'settings/account-manage', 'settings/role-manage', 'settings/expense-fee', 'settings/warehouse-manage', 'settings/print-template', 'settings/notification-settings',
  'jst/order', 'jst/inventory', 'jst/product', 'jst/logistics', 'jst/outbound', 'jst/shop', 'jst/logistics-company', 'jst/shop-product', 'jst/data-order', 'jst/data-inventory', 'jst/data-outbound',
];

// 菜单中文名（与 permRegistry PERM_MENUS.supplier 同步）
const MENU_LABELS = {
  'ecommerce/progress': '新款进度', 'ecommerce/shop-management': '店铺管理', 'ecommerce/opportunity': '商机市场', 'ecommerce/warehouse-stats': '仓库统计', 'ecommerce/manage': '品牌管理',
  'basic-data/product-list': '全部商品', 'basic-data/finished-product': '成品', 'basic-data/product-bom': '半成品', 'basic-data/raw-material': '原材料', 'basic-data/prod-process': '生产工序', 'basic-data/plan-design': '新款研发', 'basic-data/mold': '模具管理', 'basic-data/product-print': '商品打印',
  'customer/customer-info': '客户基础信息', 'customer/cooperation-manage': '合作申请', 'customer/bill-detail': '账单明细', 'customer/reconciliation': '对账管理', 'customer/price-strategy': '采购价设置',
  'sales/order-manage': '订单管理', 'sales/order-profit': '订单毛利率', 'sales/sales-ranking': '销售排行榜', 'sales/finance-audit': '财务审核', 'sales/print-picking': '打单拣货', 'sales/sales-out-stats': '销售经营分析',
  'production/production-order': '生产订单', 'production/processing-order': '加工订单', 'production/purchase-requisition': '采购申请单', 'production/workflow-templates': '生产流程模板', 'production/production-schedule': '生产排期',
  'inventory/prod-in-stats': '生产入库统计', 'inventory/purchase-receiving': '采购入库', 'inventory/inventory-check': '库存盘点', 'inventory/inventory-outbound': '库存出库',
  'finance/bank-account': '银行账户', 'finance/reimbursement': '报销', 'finance/payment-request': '收/付申请', 'finance/invoice-apply': '开票申请', 'finance/general-ledger': '会计账薄', 'finance/simple-ledger': '简易账薄', 'finance/daily-bookkeeping': '日常记账', 'finance/daily-bookkeeping-stats': '记账统计',
  'hr-manage/attendance': '考勤打卡', 'hr-manage/salary': '工资计算', 'hr-manage/employee': '员工档案', 'hr-manage/shift': '班次设置', 'hr-manage/leave': '请假管理',
  'settings/account-manage': '账号管理', 'settings/role-manage': '角色管理', 'settings/expense-fee': '费用管理', 'settings/warehouse-manage': '仓位管理', 'settings/print-template': '打印模板', 'settings/notification-settings': '弹窗设置',
};

const CONFIG_SOURCES = [
  { file: 'src/config/pageConfig.ts', maps: ['basicDataPages', 'customerPages', 'salesPages'] },
  { file: 'src/config/pageConfig2.ts', maps: ['productionPages', 'purchasePages', 'inventoryPages', 'financePages', 'settingsPages'] },
];

const FN_DETECT = [
  ['add', /新增|新建|添加/],
  ['edit', /编辑/],
  ['delete', /删除/],
  ['import', /导入/],
  ['export', /导出/],
  ['batch', /批量/],
  ['fieldconfig', /显示字段/],
  ['print', /打印/],
  ['audit', /审核|驳回/],
];
const FN_DEFAULT = ['add', 'edit', 'delete', 'import', 'export', 'fieldconfig'];

const COL_RE_1 = /title:\s*['"`]([^'"`]{1,24})['"`]\s*,\s*dataIndex:\s*['"`]([^'"`]+)['"`]/g;
const COL_RE_2 = /dataIndex:\s*['"`]([^'"`]+)['"`]\s*,\s*(?:key:\s*['"`][^'"`]+['"`]\s*,\s*)?title:\s*['"`]([^'"`]{1,24})['"`]/g;
const TAB_RE = /\{\s*key:\s*['"`](\w+)['"`]\s*,\s*label:\s*['"`]([^'"`]{1,16})['"`]/g;
const TAB_MARKER = /activeTab\s*===\s*['"`](\w+)['"`]/g;

const extractColumns = (src) => {
  const out = [];
  const seen = new Set();
  let m;
  COL_RE_1.lastIndex = 0;
  while ((m = COL_RE_1.exec(src))) {
    const [, title, dataIndex] = m;
    if (seen.has(dataIndex)) continue;
    seen.add(dataIndex);
    out.push({ title, dataIndex });
  }
  COL_RE_2.lastIndex = 0;
  while ((m = COL_RE_2.exec(src))) {
    const [, dataIndex, title] = m;
    if (seen.has(dataIndex)) continue;
    seen.add(dataIndex);
    out.push({ title, dataIndex });
  }
  return out.filter(c => c.title && !/[${<]/.test(c.title));
};

const extractFns = (src, fallback) => {
  const hit = FN_DETECT.filter(([, re]) => re.test(src)).map(([a]) => a);
  return hit.length > 0 ? hit : (fallback || []);
};

const scanFile = (rel) => {
  const file = path.join(PAGES, rel + '.tsx');
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const name = rel.split('/').pop();
  const slug = SLUG_OVERRIDE[name] || name.replace(/Page$/, '').toLowerCase();
  const markers = [];
  let m;
  TAB_MARKER.lastIndex = 0;
  while ((m = TAB_MARKER.exec(src))) markers.push({ key: m[1], idx: m.index });
  const tabLabels = {};
  TAB_RE.lastIndex = 0;
  while ((m = TAB_RE.exec(src))) tabLabels[m[1]] = m[2];
  const pages = [];
  if (markers.length >= 2) {
    const uniq = [];
    markers.forEach(mk => { if (!uniq.some(u => u.key === mk.key)) uniq.push(mk); });
    uniq.forEach((mk, i) => {
      const seg = src.slice(mk.idx, uniq[i + 1] ? uniq[i + 1].idx : src.length);
      pages.push({ page: `${slug}.${mk.key}`, pageLabel: tabLabels[mk.key] || mk.key, fields: extractColumns(seg), fns: extractFns(seg, FN_DEFAULT) });
    });
    pages.unshift({ page: slug, pageLabel: `${name.replace(/Page$/, '')}·通用`, fields: extractColumns(src.slice(0, markers[0].idx)), fns: extractFns(src, FN_DEFAULT) });
  } else {
    pages.push({ page: slug, pageLabel: name.replace(/Page$/, ''), fields: extractColumns(src), fns: extractFns(src, FN_DEFAULT) });
  }
  return { pages: pages.filter(p => p.fields.length > 0 || p.fns.length > 0) };
};

// 配置页扫描：map 内按 indent-2 key 分块
const scanConfig = () => {
  const out = [];
  CONFIG_SOURCES.forEach(({ file, maps }) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) return;
    const src = fs.readFileSync(full, 'utf8');
    maps.forEach(mapName => {
      const mi = src.indexOf(`export const ${mapName}`);
      if (mi < 0) return;
      const nextExport = src.indexOf('export const', mi + 10);
      const body = src.slice(mi, nextExport < 0 ? src.length : nextExport);
      const keyRe = /^ {2}'([a-zA-Z\-]+)':\s*\{/gm;
      const marks = [];
      let m;
      while ((m = keyRe.exec(body))) marks.push({ key: m[1], idx: m.index });
      marks.forEach((mk, i) => {
        const block = body.slice(mk.idx, marks[i + 1] ? marks[i + 1].idx : body.length);
        const menuKey = SUPPLIER_MENU_KEYS.find(x => x.endsWith('/' + mk.key));
        if (!menuKey || MENU_PAGES[menuKey]) return; // 无菜单或已有独立页面
        const fields = extractColumns(block);
        if (fields.length === 0) return;
        out.push({ menuKey, page: mk.key, pageLabel: MENU_LABELS[menuKey] || mk.key, fields, fns: extractFns(block, FN_DEFAULT) });
      });
    });
  });
  return out;
};

const result = [];
Object.entries(MENU_PAGES).forEach(([menuKey, files]) => {
  files.forEach(rel => {
    const scanned = scanFile(rel);
    if (!scanned) { console.warn('[skip] missing file:', rel); return; }
    scanned.pages.forEach(p => result.push({ menuKey, page: p.page, pageLabel: p.pageLabel, fields: p.fields, fns: p.fns }));
  });
});
scanConfig().forEach(p => result.push(p));

const totalFields = result.reduce((s, p) => s + p.fields.length, 0);
const lines = [];
lines.push('/**');
lines.push(' * 页面扫描产物（scripts/gen-perm-points.js 生成，勿手改；页面变更后重跑再生成）');
lines.push(` * 生成时间：${new Date().toISOString()}；菜单 ${new Set(result.map(r => r.menuKey)).size} 个 / 页面分组 ${result.length} 个 / 字段 ${totalFields} 个`);
lines.push(' */');
lines.push('export interface ScannedPage { menuKey: string; page: string; pageLabel: string; fields: { title: string; dataIndex: string }[]; fns: string[]; }');
lines.push(`export const SCANNED_PAGES: ScannedPage[] = ${JSON.stringify(result, null, 1)};`);
lines.push('');
const out = path.join(ROOT, 'src', 'config', 'permPageScan.generated.ts');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`[ok] ${out}`);
console.log(`menus=${new Set(result.map(r => r.menuKey)).size} pageGroups=${result.length} fields=${totalFields}`);
