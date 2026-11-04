// 权限配置 - 所有模块和子页面的权限定义
// 每个权限点的格式: "模块key/子页面key"

export interface PermissionModule {
  key: string;
  label: string;
  children: { key: string; label: string }[];
}

// 权限模块定义（与 MainLayout 的 modules 保持一致）
export const permissionModules: PermissionModule[] = [
  {
    key: 'ecommerce',
    label: '电商常用',
    children: [
      { key: 'progress', label: '新款进度' },
      { key: 'shop-management', label: '店铺管理' },
      { key: 'opportunity', label: '商机市场' },
      { key: 'warehouse-stats', label: '仓库统计' },
      { key: 'manage', label: '品牌管理' },
    ],
  },
  {
    key: 'basic-data',
    label: '基础数据',
    children: [
      { key: 'product-list', label: '全部商品' },
      { key: 'finished-product', label: '成品' },
      { key: 'product-bom', label: '半成品' },
      { key: 'raw-material', label: '原材料' },
      { key: 'prod-process', label: '生产工序' },
      { key: 'plan-design', label: '新款研发' },
      { key: 'mold', label: '模具管理' },
    ],
  },
  {
    key: 'customer',
    label: '客户管理',
    children: [
      { key: 'customer-info', label: '客户基础信息' },
      { key: 'cooperation-manage', label: '合作申请' },
      { key: 'bill-detail', label: '账单明细' },
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    children: [
      { key: 'order-manage', label: '订单管理' },
      { key: 'order-profit', label: '订单毛利率' },
      { key: 'sales-ranking', label: '销售排行榜' },
      { key: 'finance-audit', label: '财务审核' },
      { key: 'print-picking', label: '打单拣货' },
      { key: 'sales-out-stats', label: '销售经营分析' },
    ],
  },
  {
    key: 'production',
    label: '生产管理',
    children: [
      { key: 'production-order', label: '生产订单' },
      { key: 'processing-order', label: '加工订单' },
      { key: 'purchase-requisition', label: '采购申请单' },
      { key: 'workflow-templates', label: '生产流程模板' },
      { key: 'production-schedule', label: '生产排期' },
      { key: 'delivery-remind', label: '交货期提醒' },
      { key: 'order-track', label: '订单执行跟踪' },
    ],
  },
  {
    key: 'inventory',
    label: '库存管理',
    children: [
      { key: 'delivery-warning', label: '交货期预警' },
      { key: 'task-exec-track', label: '任务执行跟踪' },
      { key: 'prod-daily-report', label: '生产日报' },
      { key: 'pass-rate-stats', label: '合格率统计' },
      { key: 'prod-in-stats', label: '生产入库统计' },
      { key: 'purchase-receiving', label: '采购入库' },
      { key: 'inventory-check', label: '库存盘点' },
      { key: 'inventory-outbound', label: '库存出库' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    children: [
      { key: 'bank-account', label: '银行账户' },
      { key: 'reimbursement', label: '报销' },
      { key: 'payment-request', label: '收/付申请' },
      { key: 'invoice-apply', label: '开票申请' },
      { key: 'reconciliation', label: '对账管理' },
      { key: 'general-ledger', label: '会计账薄' },
      { key: 'simple-ledger', label: '简易账薄' },
    ],
  },
  {
    key: 'hr-manage',
    label: '人事管理',
    children: [
      { key: 'attendance', label: '考勤打卡' },
      { key: 'salary', label: '工资计算' },
      { key: 'employee', label: '员工档案' },
      { key: 'shift', label: '班次设置' },
      { key: 'leave', label: '请假管理' },
    ],
  },
  {
    key: 'dashboard',
    label: '经营看板',
    children: [
      { key: 'arrival-remind', label: '到货期提醒' },
      { key: 'order-exec-track', label: '订单执行跟踪' },
      { key: 'inventory-period', label: '库存期初期末' },
      { key: 'inventory-warning', label: '库存预警' },
      { key: 'inventory-check-stats', label: '盘点统计' },
    ],
  },
  {
    key: 'settings',
    label: '系统设置',
    children: [
      { key: 'account-manage', label: '账号管理' },
      { key: 'role-manage', label: '角色管理' },
      { key: 'expense-fee', label: '费用管理' },
      { key: 'warehouse-manage', label: '仓位管理' },
      { key: 'print-template', label: '打印模板' },
      { key: 'notification-settings', label: '弹窗设置' },
    ],
  },
  {
    key: 'jst',
    label: '聚水潭数据',
    children: [
      { key: 'api-order', label: '订单API' },
      { key: 'api-inventory', label: '库存API' },
      { key: 'api-product', label: '商品API' },
      { key: 'api-logistics', label: '物流API' },
      { key: 'api-outbound', label: '出库API' },
      { key: 'api-shop', label: '店铺API' },
      { key: 'api-logistics-company', label: '物流公司API' },
      { key: 'data-shop-product', label: '店铺商品' },
      { key: 'data-order', label: '订单' },
      { key: 'data-inventory', label: '库存管理' },
      { key: 'data-outbound', label: '出库单' },
    ],
  },
];

// 生成所有权限点列表
export const getAllPermissions = (): string[] => {
  const perms: string[] = [];
  permissionModules.forEach(mod => {
    mod.children.forEach(child => {
      perms.push(`${mod.key}/${child.key}`);
    });
  });
  return perms;
};

// 角色接口
export interface RoleRecord {
  key: string;
  name: string;
  description: string;
  permissions: string[]; // 权限点数组，如 ["basic-data/product-list", "customer/customer-info"]
  isPreset: boolean; // 是否为预设角色
}

// 预设角色定义
export const presetRoles: RoleRecord[] = [
  {
    key: 'role-all',
    name: '全部权限',
    description: '拥有系统所有模块和页面的访问权限',
    permissions: getAllPermissions(),
    isPreset: true,
  },
  {
    key: 'role-production',
    name: '生产管理',
    description: '基础数据、生产管理、库存管理相关权限',
    permissions: [
      ...permissionModules.find(m => m.key === 'basic-data')!.children.map(c => `basic-data/${c.key}`),
      ...permissionModules.find(m => m.key === 'production')!.children.map(c => `production/${c.key}`),
      ...permissionModules.find(m => m.key === 'inventory')!.children.map(c => `inventory/${c.key}`),
    ],
    isPreset: true,
  },
  {
    key: 'role-sales',
    name: '销售管理',
    description: '客户管理、销售管理、经营看板相关权限',
    permissions: [
      ...permissionModules.find(m => m.key === 'customer')!.children.map(c => `customer/${c.key}`),
      ...permissionModules.find(m => m.key === 'sales')!.children.map(c => `sales/${c.key}`),
      ...permissionModules.find(m => m.key === 'dashboard')!.children.map(c => `dashboard/${c.key}`),
    ],
    isPreset: true,
  },
  {
    key: 'role-finance',
    name: '财务管理',
    description: '财务管理、经营看板相关权限',
    permissions: [
      ...permissionModules.find(m => m.key === 'finance')!.children.map(c => `finance/${c.key}`),
      ...permissionModules.find(m => m.key === 'dashboard')!.children.map(c => `dashboard/${c.key}`),
    ],
    isPreset: true,
  },
  {
    key: 'role-purchase',
    name: '采购与库存',
    description: '库存管理、基础数据、生产管理相关权限',
    permissions: [
      ...permissionModules.find(m => m.key === 'inventory')!.children.map(c => `inventory/${c.key}`),
      ...permissionModules.find(m => m.key === 'basic-data')!.children.map(c => `basic-data/${c.key}`),
      ...permissionModules.find(m => m.key === 'production')!.children.map(c => `production/${c.key}`),
    ],
    isPreset: true,
  },
];

// 获取角色的 localStorage 存储 key
// 子账号登录时，使用父账号的 key 读取角色数据
export const getRolesStorageKey = () => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  const accountKey = isSub
    ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '')
    : (localStorage.getItem('username') || '');
  return 'roles_' + accountKey;
};

// 加载自定义角色
export const loadCustomRoles = (): RoleRecord[] => {
  try {
    const data = localStorage.getItem(getRolesStorageKey());
    if (data) return JSON.parse(data) as RoleRecord[];
  } catch { /* ignore */ }
  return [];
};

// 预设角色覆盖存储
const getPresetOverridesKey = () => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  const accountKey = isSub
    ? (localStorage.getItem('parentAccount') || localStorage.getItem('username') || '')
    : (localStorage.getItem('username') || '');
  return 'preset_role_overrides_' + accountKey;
};

export interface PresetRoleOverride {
  key: string; // 预设角色的 key
  permissions: string[]; // 覆盖后的权限列表
}

export const loadPresetOverrides = (): PresetRoleOverride[] => {
  try {
    const data = localStorage.getItem(getPresetOverridesKey());
    if (data) return JSON.parse(data) as PresetRoleOverride[];
  } catch { /* ignore */ }
  return [];
};

export const savePresetOverride = (key: string, permissions: string[]) => {
  const overrides = loadPresetOverrides();
  const idx = overrides.findIndex(o => o.key === key);
  if (idx >= 0) {
    overrides[idx].permissions = permissions;
  } else {
    overrides.push({ key, permissions });
  }
  localStorage.setItem(getPresetOverridesKey(), JSON.stringify(overrides));
};

export const resetPresetOverride = (key: string) => {
  const overrides = loadPresetOverrides().filter(o => o.key !== key);
  localStorage.setItem(getPresetOverridesKey(), JSON.stringify(overrides));
};

// 获取所有角色（预设 + 自定义，预设角色应用覆盖配置）
export const getAllRoles = (): RoleRecord[] => {
  const overrides = loadPresetOverrides();
  const mergedPresets = presetRoles.map(pr => {
    const override = overrides.find(o => o.key === pr.key);
    if (override) {
      return { ...pr, permissions: override.permissions };
    }
    return pr;
  });
  return [...mergedPresets, ...loadCustomRoles()];
};

// 根据角色名数组计算合并后的权限（取并集）
export const getMergedPermissions = (roleNames: string[], customPermissions?: string[]): string[] => {
  const allRoles = getAllRoles();
  const permSet = new Set<string>();
  roleNames.forEach(roleName => {
    const role = allRoles.find(r => r.name === roleName);
    if (role) {
      role.permissions.forEach(p => permSet.add(p));
    }
  });
  // 合并独立分配的权限
  if (customPermissions) {
    customPermissions.forEach(p => permSet.add(p));
  }
  return Array.from(permSet);
};
