// 小程序主菜单配置（与 Web 端主菜单同语义的精简移动映射）
// 规则：点击主菜单 → 进入第一个子菜单；底部子菜单条切换同模块其他子菜单
import Taro from '@tarojs/taro'
import { getWxMenus } from '../services/api'
export interface MenuChild { key: string; title: string }
export interface MenuModule { key: string; title: string; icon: string; children: MenuChild[] }

export const MODULES: MenuModule[] = [
  {
    key: 'finance', title: '财务管理', icon: '💰',
    children: [
      { key: 'approvals', title: '审批中心' },
      { key: 'reimburse', title: '报销申请' },
      { key: 'bookkeeping', title: '日常记账' },
      { key: 'bank-account', title: '银行账户' },
    ],
  },
  {
    key: 'order', title: '订单管理', icon: '📋',
    children: [
      { key: 'orders', title: '订单查询' },
      // 打单拣货：与 Web「销售管理→打单拣货」同一份订单数据（已审核+已付款的订单派生视图，只读）
      { key: 'print-picking', title: '打单拣货' },
      { key: 'production', title: '生产订单' },
      { key: 'purchase', title: '采购订单' },
    ],
  },
  {
    key: 'production-mgmt', title: '生产管理', icon: '🛠️',
    children: [
      { key: 'production-order', title: '生产订单' },
      { key: 'processing-order', title: '加工订单' },
      { key: 'purchase-requisition', title: '采购申请单' },
      { key: 'workflow-templates', title: '生产流程模板' },
      { key: 'production-schedule', title: '生产排期' },
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
    key: 'ecommerce', title: '电商常用', icon: '🛍️',
    children: [
      { key: 'progress', title: '新款进度' },
      { key: 'shop-management', title: '店铺管理' },
      { key: 'opportunity', title: '商机市场' },
      { key: 'warehouse-stats', title: '仓库统计' },
      { key: 'manage', title: '品牌管理' },
    ],
  },
  {
    key: 'hr', title: '人事管理', icon: '🧑‍💼',
    children: [
      { key: 'attendance', title: '上下班打卡' },
      { key: 'leave', title: '请假管理' },
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

// 子菜单图标（首页常用功能宫格与查看更多卡片共用）
// 值为资源路径（含 '.'）时渲染端改用 Image，而非 Text 表情
import scanCameraOrangeIcon from '../assets/scan-camera-orange.png'
export const CHILD_ICONS: Record<string, string> = {
  approvals: '✅', reimburse: '🧾', bookkeeping: '📔', 'bank-account': '🏦',
  orders: '📋', 'print-picking': '🖨️', production: '🏭', purchase: '📥',
  'production-order': '🏭', 'processing-order': '⚙️', 'purchase-requisition': '📥',
  'workflow-templates': '🧭', 'production-schedule': '📅',
  inventory: '📦', scan: scanCameraOrangeIcon,
  finished: '🛒', semi: '📤', mold: '🧰',
  progress: '📈', 'shop-management': '🏪', opportunity: '🛒', 'warehouse-stats': '📊', manage: '🏅',
  attendance: '⏰', staff: '🧑‍💼', leave: '📝',
  customers: '🤝', products: '🏷️',
}

/** 收藏 id（module:child）→ 子菜单标题 */
export const childTitle = (id: string): string => {
  const [mk, ck] = id.split(':')
  const m = findModule(mk)
  return m?.children.find(c => c.key === ck)?.title || ck
}

/** 子菜单 → 网页版菜单点映射（服务端 /wx/menus 按 PERM_V2 复算下发）；未映射的子菜单默认可见。
 *  多个菜单点取「任一可见即可见」（如审批中心同时承载报销与收付款两类单据） */
export const CHILD_MENU_KEYS: Record<string, string[]> = {
  approvals: ['finance/reimbursement', 'finance/payment-request'],
  'bank-account': ['finance/bank-account'],
  orders: ['sales/order-manage'],
  'print-picking': ['sales/order-manage'],
  production: ['production/production-order'],
  'production-order': ['production/production-order'],
  'processing-order': ['production/processing-order'],
  'purchase-requisition': ['production/purchase-requisition'],
  'workflow-templates': ['production/workflow-templates'],
  'production-schedule': ['production/production-schedule'],
}

// 菜单权限会话级缓存：首次拉取后复用，避免每个页面重复请求导致菜单栏闪烁；
// 接口异常/未部署（预览模式回落空态）时 perms 为 {} → 全部可见，与旧版行为一致
let menuPermCache: Promise<Record<string, boolean>> | null = null
export function loadMenuPerms(): Promise<Record<string, boolean>> {
  if (!menuPermCache) {
    menuPermCache = getWxMenus()
      .then(d => (d && d.perms) || {})
      .catch(() => ({}))
  }
  return menuPermCache
}

/** 子菜单是否可见：perms 缺该菜单点（服务端旧版未下发）时按可见处理，保证部署过渡期不误隐藏 */
export function childAllowed(perms: Record<string, boolean>, childKey: string): boolean {
  const keys = CHILD_MENU_KEYS[childKey]
  if (!keys || !keys.length) return true
  return keys.some(k => perms[k] !== false)
}

/** 打开某主菜单下的子菜单：若恰为该模块默认子菜单且模块有固定 Tab，则直跳 Tab 页 */
export function openMenuChild(moduleKey: string, childKey: string): void {
  const mod = findModule(moduleKey)
  const tabPath = TAB_MODULE_PATHS[moduleKey]
  if (tabPath && mod && mod.children[0]?.key === childKey) {
    Taro.reLaunch({ url: tabPath })
    return
  }
  // H5 路由按完整页路径匹配，缺 /index 会静默匹配失败（weapp 虽容忍但须统一写全）
  Taro.navigateTo({ url: `/pages/module/index?key=${moduleKey}&child=${childKey}` })
}
