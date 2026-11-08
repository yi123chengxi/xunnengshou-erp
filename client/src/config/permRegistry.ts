/**
 * PERM_V2 权限点统一注册表
 * 菜单点（menu）：四大平台（供应商/采购商/加工厂/开发者后台）可见菜单的唯一权限口径
 * 功能点（fn）/字段点（field）：P2 起逐步声明，key 前缀 fn: / field:
 * 说明：菜单 key 与路由/现有开发者白名单（dev_customer_perms_）保持同格式，零迁移兼容
 */
export type PermScope = 'supplier' | 'purchaser' | 'factory' | 'dev';
export type PermPointType = 'menu' | 'fn' | 'field';
export type PermTri = 'allow' | 'deny' | 'inherit';

export interface PermMenuItem { key: string; label: string; }
export interface PermMenuGroup { key: string; label: string; items: PermMenuItem[]; }
export interface PermPoint { key: string; label: string; type: PermPointType; group: string; scope: PermScope; def: 'allow' | 'deny'; }

// ===================== 菜单树（与四布局可见菜单一致） =====================
export const PERM_MENUS: Record<PermScope, PermMenuGroup[]> = {
  supplier: [
    {
      key: 'ecommerce', label: '电商常用', items: [
        { key: 'ecommerce/progress', label: '新款进度' },
        { key: 'ecommerce/shop-management', label: '店铺管理' },
        { key: 'ecommerce/opportunity', label: '商机市场' },
        { key: 'ecommerce/warehouse-stats', label: '仓库统计' },
        { key: 'ecommerce/manage', label: '品牌管理' },
      ],
    },
    {
      key: 'basic-data', label: '基础数据', items: [
        { key: 'basic-data/product-list', label: '全部商品' },
        { key: 'basic-data/finished-product', label: '成品' },
        { key: 'basic-data/product-bom', label: '半成品' },
        { key: 'basic-data/raw-material', label: '原材料' },
        { key: 'basic-data/prod-process', label: '生产工序' },
        { key: 'basic-data/plan-design', label: '新款研发' },
        { key: 'basic-data/mold', label: '模具管理' },
        { key: 'basic-data/product-print', label: '商品打印' },
      ],
    },
    {
      key: 'customer', label: '客户管理', items: [
        { key: 'customer/customer-info', label: '客户基础信息' },
        { key: 'customer/cooperation-manage', label: '合作申请' },
        { key: 'customer/bill-detail', label: '账单明细' },
        { key: 'customer/reconciliation', label: '对账管理' },
        { key: 'customer/price-strategy', label: '采购价设置' },
      ],
    },
    {
      key: 'sales', label: '销售管理', items: [
        { key: 'sales/order-manage', label: '订单管理' },
        { key: 'sales/order-profit', label: '订单毛利率' },
        { key: 'sales/sales-ranking', label: '销售排行榜' },
        { key: 'sales/finance-audit', label: '财务审核' },
        { key: 'sales/print-picking', label: '打单拣货' },
        { key: 'sales/sales-out-stats', label: '销售经营分析' },
      ],
    },
    {
      key: 'production', label: '生产管理', items: [
        { key: 'production/production-order', label: '生产订单' },
        { key: 'production/processing-order', label: '加工订单' },
        { key: 'production/purchase-requisition', label: '采购申请单' },
        { key: 'production/workflow-templates', label: '生产流程模板' },
        { key: 'production/production-schedule', label: '生产排期' },
      ],
    },
    {
      key: 'inventory', label: '库存管理', items: [
        { key: 'inventory/prod-in-stats', label: '生产入库统计' },
        { key: 'inventory/purchase-receiving', label: '采购入库' },
        { key: 'inventory/inventory-check', label: '库存盘点' },
        { key: 'inventory/inventory-outbound', label: '库存出库' },
      ],
    },
    {
      key: 'finance', label: '财务管理', items: [
        { key: 'finance/boss-dashboard', label: '老板看板' },
        { key: 'finance/bank-account', label: '银行账户' },
        { key: 'finance/reimbursement', label: '报销' },
        { key: 'finance/payment-request', label: '收/付申请' },
        { key: 'finance/general-ledger', label: '会计账薄' },
        { key: 'finance/simple-ledger', label: '简易账薄' },
      ],
    },
    {
      key: 'hr-manage', label: '人事管理', items: [
        { key: 'hr-manage/attendance', label: '考勤打卡' },
        { key: 'hr-manage/salary', label: '工资计算' },
        { key: 'hr-manage/employee', label: '员工档案' },
        { key: 'hr-manage/shift', label: '班次设置' },
        { key: 'hr-manage/leave', label: '请假管理' },
        { key: 'hr-manage/resigned', label: '离职人员' },
      ],
    },
    {
      key: 'settings', label: '系统设置', items: [
        { key: 'settings/account-manage', label: '账号管理' },
        { key: 'settings/role-manage', label: '角色管理' },
        { key: 'settings/expense-fee', label: '费用管理' },
        { key: 'settings/warehouse-manage', label: '仓位管理' },
        { key: 'settings/print-template', label: '打印模板' },
        { key: 'settings/notification-settings', label: '弹窗设置' },
      ],
    },
    {
      key: 'jst', label: '聚水潭数据', items: [
        { key: 'jst/order', label: '订单API' },
        { key: 'jst/inventory', label: '库存API' },
        { key: 'jst/product', label: '商品API' },
        { key: 'jst/logistics', label: '物流API' },
        { key: 'jst/outbound', label: '出库API' },
        { key: 'jst/shop', label: '店铺API' },
        { key: 'jst/logistics-company', label: '物流公司API' },
        { key: 'jst/shop-product', label: '店铺商品' },
        { key: 'jst/data-order', label: '订单' },
        { key: 'jst/data-inventory', label: '库存管理' },
        { key: 'jst/data-outbound', label: '出库单' },
      ],
    },
  ],
  purchaser: [
    {
      key: 'base', label: '常用', items: [
        { key: 'purchaser/dashboard', label: '采购商首页' },
        { key: 'purchaser/orders', label: '订单管理' },
      ],
    },
    {
      key: 'ecommerce', label: '电商常用', items: [
        { key: 'purchaser/ecommerce/progress', label: '新款进度' },
        { key: 'purchaser/ecommerce/shop-management', label: '店铺管理' },
        { key: 'purchaser/market/finished', label: '成品市场' },
        { key: 'purchaser/ecommerce/manage', label: '品牌管理' },
        { key: 'purchaser/ecommerce/warehouse-stats', label: '仓库统计' },
      ],
    },
    {
      key: 'suppliers', label: '供应商', items: [
        { key: 'purchaser/suppliers/list', label: '供应商列表' },
        { key: 'purchaser/suppliers/factory-list', label: '加工厂列表' },
        { key: 'purchaser/suppliers/cooperation', label: '合作申请' },
        { key: 'purchaser/suppliers/bill', label: '采购账单' },
        { key: 'purchaser/suppliers/reconciliation', label: '对账管理' },
      ],
    },
    {
      key: 'product-data', label: '商品资料', items: [
        { key: 'purchaser/product-data/finished-product', label: '成品' },
      ],
    },
    {
      key: 'finance', label: '财务管理', items: [
        { key: 'purchaser/finance/boss-dashboard', label: '老板看板' },
        { key: 'purchaser/finance/bank-account', label: '银行账户' },
        { key: 'purchaser/finance/reimbursement', label: '报销' },
        { key: 'purchaser/finance/payment-request', label: '收/付申请' },
        { key: 'purchaser/finance/general-ledger', label: '会计账薄' },
        { key: 'purchaser/finance/simple-ledger', label: '简易账薄' },
      ],
    },
    {
      key: 'profile', label: '企业信息', items: [
        { key: 'purchaser/profile', label: '企业信息' },
      ],
    },
    {
      key: 'settings', label: '系统设置', items: [
        { key: 'purchaser/settings/account-manage', label: '账号管理' },
        { key: 'purchaser/settings/role-manage', label: '角色管理' },
        { key: 'purchaser/settings/expense-fee', label: '费用管理' },
        { key: 'purchaser/settings/warehouse-manage', label: '仓位管理' },
        { key: 'purchaser/settings/print-template', label: '打印模板' },
        { key: 'purchaser/settings/notification-settings', label: '弹窗设置' },
      ],
    },
  ],
  factory: [
    {
      key: 'base', label: '常用', items: [
        { key: 'factory/dashboard', label: '加工厂首页' },
        { key: 'factory/production/processing-order', label: '加工订单' },
        { key: 'factory/cooperation', label: '合作工厂' },
        { key: 'factory/market/opportunity', label: '商机市场' },
      ],
    },
    {
      key: 'finance', label: '财务管理', items: [
        { key: 'factory/finance/bank-account', label: '银行账户' },
        { key: 'factory/finance/reimbursement', label: '报销' },
        { key: 'factory/finance/general-ledger', label: '会计账薄' },
        { key: 'factory/finance/simple-ledger', label: '简易账薄' },
      ],
    },
    {
      key: 'settings', label: '系统设置', items: [
        { key: 'factory/settings/account-manage', label: '账号管理' },
        { key: 'factory/settings/role-manage', label: '角色管理' },
      ],
    },
    {
      key: 'profile', label: '企业信息', items: [
        { key: 'factory/profile', label: '企业信息' },
      ],
    },
  ],
  dev: [
    {
      key: 'customers', label: '客户管理', items: [
        { key: 'dev/customers/mine', label: '我的客户' },
        { key: 'dev/customers/all', label: '全部客户' },
        { key: 'dev/customers/orders', label: '订单管理' },
        { key: 'dev/customers/pool', label: '客户公海' },
        { key: 'dev/customers/stats', label: '数据统计' },
      ],
    },
    {
      key: 'analytics', label: '业绩分析', items: [
        { key: 'dev/analytics/payment', label: '客户付款' },
        { key: 'dev/analytics/group-stats', label: '分组统计' },
        { key: 'dev/analytics/action-points', label: '积分明细' },
        { key: 'dev/analytics/points-stats', label: '积分兑换' },
        { key: 'dev/analytics/performance', label: '绩效考核' },
      ],
    },
    {
      key: 'settings', label: '系统设置', items: [
        { key: 'dev/settings/accounts', label: '账号管理' },
        { key: 'dev/settings/roles', label: '角色权限' },
        { key: 'dev/settings/points', label: '积分兑换奖品' },
        { key: 'dev/settings/feedback', label: '意见反馈' },
        { key: 'dev/settings/announcement', label: '公告管理' },
        { key: 'dev/settings/integration', label: '接口配置' },
      ],
    },
  ],
};

// ===================== 功能点 / 字段点（P2 起声明，def=默认态；生成逻辑见文件末尾） =====================
import { basicDataPages } from './pageConfig';

/** 通用功能动作（每页工具栏/行操作统一口径） */
export const FN_ACTIONS = ['add', 'edit', 'delete', 'import', 'export', 'batch', 'fieldconfig', 'print', 'audit'] as const;
export type FnAction = typeof FN_ACTIONS[number];
export const FN_ACTION_LABEL: Record<FnAction, string> = {
  add: '新增', edit: '编辑', delete: '删除', import: '导入', export: '导出',
  batch: '批量操作', fieldconfig: '显示字段配置', print: '打印', audit: '审核/驳回',
};
export const PRODUCT_PAGE_KEY = 'basic-data/product-list';
/** 字段点元数据（供编辑器分组渲染） */
export const PRODUCT_FIELD_META: { title: string; dataIndex: string; group?: string }[] = (() => {
  const cols: any[] = (basicDataPages as any)?.['product-list']?.columns || [];
  const finished: any[] = (basicDataPages as any)?.['finished-product']?.columns || [];
  const seen = new Set<string>();
  const out: { title: string; dataIndex: string; group?: string }[] = [];
  [...cols, ...finished].forEach(c => {
    if (!c?.dataIndex || seen.has(c.dataIndex)) return;
    seen.add(c.dataIndex);
    out.push({ title: c.title, dataIndex: c.dataIndex, group: c.group || '其它' });
  });
  return out;
})();
export const PRODUCT_FIELD_KEYS = PRODUCT_FIELD_META.map(c => c.dataIndex);

/** 店铺管理菜单 key（字段/按键权限点归属） */
export const SHOP_MENU_KEY = 'ecommerce/shop-management';
export let FN_POINTS: PermPoint[] = [];
export let FIELD_POINTS: PermPoint[] = [];

// ===================== 查询助手 =====================
export const menuGroupsOf = (scope: PermScope): PermMenuGroup[] => PERM_MENUS[scope] || [];

export const menuKeysOf = (scope: PermScope): string[] =>
  (PERM_MENUS[scope] || []).flatMap(g => g.items.map(i => i.key));

export const isMenuPoint = (scope: PermScope, key: string): boolean =>
  menuKeysOf(scope).includes(key);

export const menuLabelOf = (scope: PermScope, key: string): string => {
  for (const g of PERM_MENUS[scope] || []) {
    const hit = g.items.find(i => i.key === key);
    if (hit) return hit.label;
  }
  return key;
};

export const menuGroupOf = (scope: PermScope, key: string): PermMenuGroup | undefined =>
  (PERM_MENUS[scope] || []).find(g => g.items.some(i => i.key === key));

/** 全部功能点/字段点（按 scope 过滤） */
export const fnPointsOf = (scope: PermScope): PermPoint[] => FN_POINTS.filter(p => p.scope === scope);
export const fieldPointsOf = (scope: PermScope): PermPoint[] => FIELD_POINTS.filter(p => p.scope === scope);

// ===================== 功能点/字段点生成（依赖上方查询助手与页面扫描产物，置于末尾避免 TDZ） =====================
import { SCANNED_PAGES } from './permPageScan.generated';

// 功能点：按页面扫描到的按键存在性生成（未扫描到的菜单回退通用九件套）
FN_POINTS = (() => {
  const byMenu = new Map<string, Set<string>>();
  SCANNED_PAGES.forEach(p => {
    const s = byMenu.get(p.menuKey) || new Set<string>();
    p.fns.forEach(a => s.add(a));
    byMenu.set(p.menuKey, s);
  });
  const out: PermPoint[] = [];
  menuKeysOf('supplier').forEach(mk => {
    const acts = byMenu.get(mk);
    const list: string[] = acts && acts.size > 0 ? Array.from(acts) : Array.from(FN_ACTIONS);
    const label = menuLabelOf('supplier', mk);
    const group = menuGroupOf('supplier', mk)?.key || '';
    list.forEach(a => out.push({ key: `fn:${mk}:${a}`, label: `${label}·${FN_ACTION_LABEL[a as FnAction]}`, type: 'fn' as PermPointType, group, scope: 'supplier' as PermScope, def: 'allow' as const }));
  });
  return out;
})();

// 字段点：商品列表（pageConfig）+ 全页面扫描产物（按子页面分组，查看/编辑双点）
FIELD_POINTS = PRODUCT_FIELD_META.flatMap(c => [
  { key: `field:${PRODUCT_PAGE_KEY}:${c.dataIndex}:view`, label: `${c.title}·查看`, type: 'field' as PermPointType, group: c.group || '其它', scope: 'supplier' as PermScope, def: 'allow' as const },
  { key: `field:${PRODUCT_PAGE_KEY}:${c.dataIndex}:edit`, label: `${c.title}·编辑`, type: 'field' as PermPointType, group: c.group || '其它', scope: 'supplier' as PermScope, def: 'allow' as const },
]).concat(SCANNED_PAGES.flatMap(p => p.fields.flatMap(c => [
  { key: `field:${p.menuKey}:${p.page}.${c.dataIndex}:view`, label: `${c.title}·查看`, type: 'field' as PermPointType, group: p.pageLabel, scope: 'supplier' as PermScope, def: 'allow' as const },
  { key: `field:${p.menuKey}:${p.page}.${c.dataIndex}:edit`, label: `${c.title}·编辑`, type: 'field' as PermPointType, group: p.pageLabel, scope: 'supplier' as PermScope, def: 'allow' as const },
])));
