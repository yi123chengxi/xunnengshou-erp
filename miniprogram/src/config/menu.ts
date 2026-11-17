// 小程序主菜单配置（与 Web 端主菜单同语义的精简移动映射）
// 规则：点击主菜单 → 进入第一个子菜单；底部子菜单条切换同模块其他子菜单
export interface MenuChild { key: string; title: string }
export interface MenuModule { key: string; title: string; icon: string; children: MenuChild[] }

export const MODULES: MenuModule[] = [
  {
    key: 'finance', title: '财务管理', icon: '💰',
    children: [
      { key: 'approvals', title: '审批中心' },
      { key: 'reimburse', title: '报销申请' },
      { key: 'bookkeeping', title: '日常记账' },
    ],
  },
  {
    key: 'order', title: '订单管理', icon: '📋',
    children: [
      { key: 'orders', title: '订单查询' },
      { key: 'production', title: '生产订单' },
      { key: 'purchase', title: '采购订单' },
    ],
  },
  {
    key: 'warehouse', title: '仓库管理', icon: '📦',
    children: [
      { key: 'inventory', title: '库存查询' },
      { key: 'scan', title: '扫码查货' },
    ],
  },
  {
    key: 'market', title: '商机市场', icon: '🛒',
    children: [
      { key: 'finished', title: '成品市场' },
      { key: 'semi', title: '发包市场' },
      { key: 'mold', title: '模具租售' },
    ],
  },
  {
    key: 'hr', title: '人事管理', icon: '🧑‍💼',
    children: [
      { key: 'attendance', title: '上下班打卡' },
      { key: 'staff', title: '员工档案' },
    ],
  },
  {
    key: 'customer', title: '客户管理', icon: '🤝',
    children: [
      { key: 'customers', title: '客户列表' },
    ],
  },
  {
    key: 'product', title: '商品资料', icon: '🏷️',
    children: [
      { key: 'products', title: '商品列表' },
    ],
  },
]

// 主菜单中属于底部固定 Tab 的：从「更多」点击时直接 reLaunch 到对应 Tab 页
export const TAB_MODULE_PATHS: Record<string, string> = {
  finance: '/pages/finance/index',
  order: '/pages/order/index',
  market: '/pages/market/index',
}

export const findModule = (key: string): MenuModule | undefined => MODULES.find(m => m.key === key)
