import { useEffect, useState } from 'react';

// 权限数据版本哨兵：含此标记的权限数组为「包含采购商/加工厂控制」的新版数据；
// 旧版数据（无此标记）中缺失的 purchaser/*/factory/* 键视为默认放行（兼容已保存的旧权限）
export const PERM_V2 = '__v2';

// 权限数据版本哨兵 V3：含此标记的权限数组为「包含日常记账菜单」的新版数据；
// 旧版数据（无此标记）中缺失的日常记账键视为默认放行（兼容已保存的旧权限）
export const PERM_V3 = '__v3';
export const PERM_V3_DEFAULT_KEYS = ['finance/daily-bookkeeping', 'purchaser/finance/daily-bookkeeping', 'factory/finance/daily-bookkeeping'];

// 权限数据版本哨兵 V4：含此标记的权限数组为「包含报销菜单」的新版数据；
// 旧版数据（无此标记）中缺失的报销键视为默认放行（兼容已保存的旧权限）
export const PERM_V4 = '__v4';
export const PERM_V4_DEFAULT_KEYS = ['finance/reimbursement', 'purchaser/finance/reimbursement', 'factory/finance/reimbursement'];

// 权限数据版本哨兵 V5：含此标记的权限数组为「包含人事管理菜单与采购商付款申请菜单」的新版数据；
// 旧版数据（无此标记）中缺失的人事管理/付款申请键视为默认放行（兼容已保存的旧权限）
export const PERM_V5 = '__v5';
export const PERM_V5_DEFAULT_KEYS = [
  'hr-manage/attendance', 'hr-manage/salary', 'hr-manage/employee',
  'hr-manage/shift', 'hr-manage/leave',
  'finance/payment-request',
  'purchaser/finance/payment-request',
];

// 权限数据版本哨兵 V6：含此标记的权限数组为「包含其他货币资金与总账薄菜单」的新版数据；
// 旧版数据（无此标记）中缺失的键视为默认放行（兼容已保存的旧权限）
export const PERM_V6 = '__v6';
export const PERM_V6_DEFAULT_KEYS = [
  'finance/other-currency', 'finance/general-ledger',
  'purchaser/finance/other-currency', 'purchaser/finance/general-ledger',
  'factory/finance/other-currency', 'factory/finance/general-ledger',
];

// 权限数据版本哨兵 V7：含此标记的权限数组为「包含简易账薄菜单」的新版数据；
// 旧版数据（无此标记）中缺失的简易账薄键视为默认放行（兼容已保存的旧权限）
export const PERM_V7 = '__v7';
export const PERM_V7_DEFAULT_KEYS = [
  'finance/simple-ledger',
  'purchaser/finance/simple-ledger',
  'factory/finance/simple-ledger',
];

// 权限数据版本哨兵 V8：含此标记的权限数组为「包含财务管理全部子菜单」的新版数据；
// 旧版数据（无此标记）中缺失的财务键视为默认放行（统一覆盖银行/对账/店铺等早期菜单）
export const PERM_V8 = '__v8';
export const PERM_V8_DEFAULT_KEYS = [
  // 供应商平台（9项）
  'finance/bank-account', 'finance/daily-bookkeeping', 'finance/reimbursement',
  'finance/payment-request', 'finance/reconciliation', 'finance/shop-management',
  'finance/other-currency', 'finance/general-ledger', 'finance/simple-ledger', 'customer/reconciliation',
  // 采购商平台（9项）
  'purchaser/finance/bank-account', 'purchaser/finance/daily-bookkeeping', 'purchaser/finance/reimbursement',
  'purchaser/finance/payment-request', 'purchaser/finance/reconciliation', 'purchaser/finance/shop-management',
  'purchaser/finance/other-currency', 'purchaser/finance/general-ledger', 'purchaser/finance/simple-ledger', 'purchaser/suppliers/reconciliation',
  // 加工厂平台（6项）
  'factory/finance/bank-account', 'factory/finance/daily-bookkeeping', 'factory/finance/reimbursement',
  'factory/finance/other-currency', 'factory/finance/general-ledger', 'factory/finance/simple-ledger',
];

// 权限数据版本哨兵 V9：含此标记的权限数组为「包含新款进度菜单」的新版数据；
// 旧版数据（无此标记）中缺失的新款进度键视为默认放行（供应商+采购商双平台）
export const PERM_V9 = '__v9';
export const PERM_V9_DEFAULT_KEYS = [
  'newstyle/progress',
  'purchaser/newstyle/progress',
];

// 权限数据版本哨兵 V10：含此标记的权限数组为「包含品牌授权菜单（授权品牌/自有品牌）」的新版数据；
// 旧版数据（无此标记）中缺失的品牌授权键视为默认放行（供应商平台）
export const PERM_V10 = '__v10';
export const PERM_V10_DEFAULT_KEYS = [
  'brandauth/manage',
  'brandauth/authorized',
  'brandauth/own',
  'purchaser/brandauth/manage',
  'purchaser/brandauth/mycerts',
];

// 权限数据版本哨兵 V11：含此标记的权限数组为「包含仓库统计菜单」的新版数据；
// 旧版数据（无此标记）中缺失的仓库统计键视为默认放行
export const PERM_V11 = '__v11';
export const PERM_V11_DEFAULT_KEYS = [
  'ecommerce/warehouse-stats',
];

// 权限数据版本哨兵 V12：含此标记的权限数组为「包含采购商仓库统计菜单」的新版数据；
// 旧版数据（无此标记）中缺失的采购商仓库统计键视为默认放行
export const PERM_V12 = '__v12';
export const PERM_V12_DEFAULT_KEYS = [
  'purchaser/ecommerce/warehouse-stats',
];

// 权限数据版本哨兵 V13：含此标记的权限数组为「包含加工订单/采购申请单/生产流程模板/费用管理/模具管理/聚水潭数据」的新版数据；
// 旧版数据（无此标记）中缺失的键视为默认放行
export const PERM_V13 = '__v13';
export const PERM_V13_DEFAULT_KEYS = [
  'production/processing-order', 'production/purchase-requisition', 'production/workflow-templates',
  'settings/expense-fee', 'basic-data/mold',
  'jst/api-order', 'jst/api-inventory', 'jst/api-product', 'jst/api-logistics',
  'jst/api-outbound', 'jst/api-shop', 'jst/api-logistics-company',
  'jst/data-shop-product', 'jst/data-order', 'jst/data-inventory', 'jst/data-outbound',
];

// 权限数据版本哨兵 V14：含此标记的权限数组为「电商常用菜单统一重构」的新版数据；
// 旧键(newstyle/progress, brandauth/manage, finance/shop-management)合并至 ecommerce/*
// 旧版数据（无此标记）中缺失的键视为默认放行
export const PERM_V14 = '__v14';
export const PERM_V14_DEFAULT_KEYS = [
  'ecommerce/progress', 'ecommerce/shop-management', 'ecommerce/opportunity',
  'ecommerce/warehouse-stats', 'ecommerce/manage',
  'purchaser/ecommerce/progress', 'purchaser/ecommerce/shop-management',
  'purchaser/ecommerce/warehouse-stats', 'purchaser/ecommerce/manage',
];

// 权限数据版本哨兵 V15：含此标记的权限数组为「包含财务管理-开票申请菜单」的新版数据；
// 旧版数据（无此标记）中缺失的开票申请键视为默认放行
export const PERM_V15 = '__v15';
export const PERM_V15_DEFAULT_KEYS = [
  'finance/invoice-apply',
];

// 权限数据版本哨兵 V16：含此标记的权限数组为「包含人事管理-离职人员菜单」的新版数据；
// 旧版数据（无此标记）中缺失的离职人员键视为默认放行
export const PERM_V16 = '__v16';
export const PERM_V16_DEFAULT_KEYS = [
  'hr-manage/resigned',
];

// 电商常用菜单键迁移映射（旧键 → 新键），用于加载旧版权限数据时自动转换
export const ECOM_KEY_MIGRATION: Record<string, string> = {
  'newstyle/progress': 'ecommerce/progress',
  'brandauth/manage': 'ecommerce/manage',
  'finance/shop-management': 'ecommerce/shop-management',
  'purchaser/newstyle/progress': 'purchaser/ecommerce/progress',
  'purchaser/brandauth/manage': 'purchaser/ecommerce/manage',
  'purchaser/finance/shop-management': 'purchaser/ecommerce/shop-management',
  // 对账管理菜单迁移：财务 → 客户管理(供应商) / 供应商菜单(采购商)
  'finance/reconciliation': 'customer/reconciliation',
  'purchaser/finance/reconciliation': 'purchaser/suppliers/reconciliation',
};

// 读取开发者后台设置的客户软件菜单权限（dev_customer_perms_<账号>，未设置=全部允许）
export const readDevPermSet = (username?: string): Set<string> | null => {
  try {
    const u = username ?? (localStorage.getItem('username') || '');
    const raw = localStorage.getItem(`dev_customer_perms_${u}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set<string>(arr) : null;
  } catch { return null; }
};

// 权限判定：set 为 null 全放行；旧版数据对采购商/加工厂键默认放行
export const isPermAllowed = (set: Set<string> | null, key: string): boolean => {
  // 商机市场为平台级撮合入口（供应商/加工厂/采购商三端），不受客户菜单权限白名单限制
  if (key.startsWith('market/') || key.includes('/market/') || key === 'ecommerce/opportunity') return true;
  if (set === null) return true;
  if (set.has(key)) return true;
  if (!set.has(PERM_V2) && (key.startsWith('purchaser/') || key.startsWith('factory/'))) return true;
  if (!set.has(PERM_V3) && PERM_V3_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V4) && PERM_V4_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V5) && PERM_V5_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V6) && PERM_V6_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V7) && PERM_V7_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V8) && PERM_V8_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V9) && PERM_V9_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V10) && PERM_V10_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V11) && PERM_V11_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V12) && PERM_V12_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V13) && PERM_V13_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V14) && PERM_V14_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V15) && PERM_V15_DEFAULT_KEYS.includes(key)) return true;
  if (!set.has(PERM_V16) && PERM_V16_DEFAULT_KEYS.includes(key)) return true;
  // 电商常用键迁移兼容：旧版权限数据含旧键时，新键也放行
  const reverseMap: Record<string, string> = {};
  Object.entries(ECOM_KEY_MIGRATION).forEach(([oldK, newK]) => { reverseMap[newK] = oldK; });
  if (reverseMap[key] && set.has(reverseMap[key])) return true;
  return false;
};

// 响应式权限集合：保存权限后（同标签页 dev-perms-changed / 跨标签页 storage）实时刷新
export const useDevPermSet = (): Set<string> | null => {
  const [set, setSet] = useState<Set<string> | null>(() => readDevPermSet());
  useEffect(() => {
    const refresh = () => setSet(readDevPermSet());
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('dev_customer_perms_')) refresh();
    };
    window.addEventListener('dev-perms-changed', refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('dev-perms-changed', refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return set;
};

// ===================== 采购商/加工厂平台菜单（权限树定义，键与布局菜单 key 一致） =====================
export interface PermMenuDef { key: string; label: string; children?: { key: string; label: string }[]; }

export const PURCHASER_PERM_MENUS: PermMenuDef[] = [
  { key: 'dashboard', label: '采购商首页' },
  { key: 'orders', label: '订单管理' },
  { key: 'newstyle/progress', label: '新款进度' },
  { key: 'brandauth', label: '品牌授权', children: [{ key: 'manage', label: '品牌管理' }, { key: 'mycerts', label: '我的授权书' }] },
  { key: 'ecommerce/warehouse-stats', label: '仓库统计' },
  {
    key: 'suppliers', label: '供应商', children: [
      { key: 'list', label: '供应商列表' },
      { key: 'factory-list', label: '加工厂列表' },
      { key: 'cooperation', label: '合作申请' },
      { key: 'bill', label: '采购账单' },
    ],
  },
  { key: 'product-data', label: '商品资料', children: [{ key: 'finished-product', label: '成品' }] },
  {
    key: 'finance', label: '财务管理', children: [
      { key: 'bank-account', label: '银行账户' },
      { key: 'reimbursement', label: '报销' },
      { key: 'payment-request', label: '收/付申请' },
      { key: 'reconciliation', label: '对账管理' },
      { key: 'shop-management', label: '店铺管理' },
      { key: 'general-ledger', label: '会计账薄' },
      { key: 'simple-ledger', label: '简易账薄' },
    ],
  },
  { key: 'profile', label: '企业信息' },
  {
    key: 'settings', label: '系统设置', children: [
      { key: 'account-manage', label: '账号管理' },
      { key: 'role-manage', label: '角色管理' },
      { key: 'expense-fee', label: '费用管理' },
      { key: 'warehouse-manage', label: '仓位管理' },
      { key: 'print-template', label: '打印模板' },
      { key: 'notification-settings', label: '弹窗设置' },
    ],
  },
];

export const FACTORY_PERM_MENUS: PermMenuDef[] = [
  { key: 'dashboard', label: '加工厂首页' },
  { key: 'production/processing-order', label: '加工订单' },
  { key: 'cooperation', label: '合作工厂' },
  { key: 'finance', label: '财务管理', children: [
        { key: 'bank-account', label: '银行账户' },
        { key: 'reimbursement', label: '报销' },
        { key: 'general-ledger', label: '会计账薄' },
        { key: 'simple-ledger', label: '简易账薄' },
      ] },
  {
    key: 'settings', label: '系统设置', children: [
      { key: 'account-manage', label: '账号管理' },
      { key: 'role-manage', label: '角色管理' },
    ],
  },
  { key: 'profile', label: '企业信息' },
];

// 平台菜单 → 权限树节点（叶子键 `purchaser/<menuKey>` / `purchaser/<menuKey>/<childKey>`）
export const buildPlatformPermNodes = (prefix: 'purchaser' | 'factory', menus: PermMenuDef[]) => menus.map(m => (m.children && m.children.length)
  ? { key: `${prefix}/${m.key}`, label: m.label, children: m.children.map(c => ({ key: `${prefix}/${m.key}/${c.key}`, label: c.label })) }
  : { key: `${prefix}/${m.key}`, label: m.label });

export const PLATFORM_PERM_PREFIXES = ['purchaser/', 'factory/'];
