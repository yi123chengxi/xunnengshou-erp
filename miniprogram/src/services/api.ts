import { request } from './request'

export interface SummaryData {
  today: { orderCount: number; salesAmount: number }
  month: { orderCount: number; salesAmount: number }
  todos: { reimbPending: number; payPending: number; recvPending: number }
}

export interface ApprovalItem {
  type: 'reimbursement' | 'payment'
  key: string
  no: string
  title: string
  applicant: string
  applicantName: string
  amount: number
  status: string
  statusText: string
  time: string
  recordType: string
  receiptCount: number
  isReceipt?: boolean
}

export interface ApprovalDetail {
  record: any
  item: ApprovalItem
  pending: boolean
  canAudit: boolean
}

export const getSummary = () => request<SummaryData>('/wx/summary')

/**
 * 工作台经营看板（服务端 /wx/dashboard 按网页版同口径计算后下发）
 * - metrics 中无权限的指标服务端直接下发 null（手机端显示 —），不是 0
 * - pendingStats 为「生产管理-待生产数据统计」快照，无权限时为 null（整块不渲染）
 */
export interface BoardMetrics {
  pendingQty: number | null; pendingCount: number | null; allOrderCount: number | null; planQtyAll: number | null
  todayDoneQty: number | null; todayDoneCount: number | null
  todaySalesCount: number | null; todaySalesQty: number | null; todaySalesAmount: number | null
  monthSalesCount: number | null; monthSalesAmount: number | null
  todayIncome: number | null; todayExpense: number | null
  monthIncome: number | null; monthExpense: number | null
  balanceTotal: number | null; accountCount: number | null
  overdueCount: number | null; overdueRate: number | null; unscheduledQty: number | null; done30Qty: number | null
}

/** 待生产统计行（与网页版 PendingRow 同名精简字段） */
export interface PendingRowBrief {
  id: string; productName: string; customerName: string; statusLabel: string
  nodeName: string; pendingQty: number; remainScheduleQty: number; progress: number
  elapsedDays: number; limitDays: number; overdue: boolean; planEnd: string
  hasCgsq: boolean; jgDone: number; jgTotal: number; person: string
}

export interface PendingStats {
  generatedAt: string
  totals: {
    allCount: number; poolCount: number; pendingCount: number; processingCount: number; warningCount: number
    doneCount: number; poolQty: number; planQty: number; doneQty: number; planQtyAll: number
    scheduledQty: number; unscheduledQty: number; unscheduledCount: number
    deferredCount: number; deferredQty: number; avgProgress: number
  }
  bom: {
    noCgsqCount: number; noJgCount: number; readyCount: number; jgTotalCount: number; jgDoneCount: number
    jgDoneRate: number; jgOpenCount: number; jgOpenQty: number; jgOpenAmount: number
    cgsqOpenCount: number; cgsqOpenQty: number; blockedCount: number
  }
  risk: {
    overdueCount: number; overdueRate: number; avgOverDays: number; maxOverDays: number
    nodeOverCount: number; dueSoonCount: number; planEndPassedCount: number; noPlanEndCount: number
  }
  nodes: { index: number; name: string; count: number; qty: number; avgStayDays: number; estDays: number; overCount: number }[]
  persons: { name: string; count: number; qty: number; overdueCount: number }[]
  styles: { styleCode: string; moldCode: string; qty: number; orderCount: number; colors: number; sizes: number }[]
  colors: { name: string; qty: number; orderCount: number }[]
  sizes: { name: string; qty: number; orderCount: number }[]
  capacity: {
    lines: { line: string; standard: number; avgShiftOutput: number; usedCapacity: number; scheduled7: number; capacity7: number }[]
    days: { date: string; label: string; scheduled: number; capacity: number }[]
    capacity7: number; unscheduledQty: number; gap: number
    backlogDays: number | null; hasStandard: boolean; lineCount: number
  }
  efficiency: { done30Count: number; done30Qty: number; avgCycleDays: number | null; completeRate: number; scheduleRate: number }
  doneTodayQty: number; doneTodayCount: number
  poolTop: PendingRowBrief[]
  overdueTop: PendingRowBrief[]
}

export interface DashboardData {
  perm: { productionStats: boolean; productionOrder: boolean; salesOrder: boolean; bankAccount: boolean }
  metrics: BoardMetrics
  pendingStats: PendingStats | null
  updatedAt: string
}

export const getDashboard = () => request<DashboardData>('/wx/dashboard')

/** 菜单点可见性（服务端按网页版 PERM_V2 复算）：用于小程序菜单栏与网页版同权限隐藏 */
export const getWxMenus = () => request<{ perms: Record<string, boolean> }>('/wx/menus')

export const getApprovals = (type: 'reimbursement' | 'payment', tab: string) =>
  request<{ list: ApprovalItem[] }>(`/wx/approvals?type=${type}&tab=${tab}`)

export const getApprovalDetail = (type: string, key: string) =>
  request<ApprovalDetail>(`/wx/approvals/${type}/${encodeURIComponent(key)}`)

export const auditApproval = (type: string, key: string, body: { approved: boolean; comment?: string; mainCategory?: string }) =>
  request<{ saved: boolean; record: any }>(`/wx/approvals/${type}/${encodeURIComponent(key)}/audit`, { method: 'POST', data: body })

export const createReimbursement = (body: { title: string; category: string; amount: number; description?: string; receipts?: string[] }) =>
  request<{ saved: boolean; record: any }>('/wx/reimbursements', { method: 'POST', data: body })

export const getInventory = (q: string) =>
  request<{ list: any[]; total: number }>(`/wx/inventory?q=${encodeURIComponent(q)}`)

/** 商品成本明细（服务端 /wx/product-cost 与 Web「物料明细」同口径：半成品/原材料/工艺/生产费用 + 合计） */
export const getProductCost = (key: string) =>
  request<{ semi: any[]; raw: any[]; proc: any[]; fees: any[]; totalCost: number; hasBom: boolean }>(`/wx/product-cost/${encodeURIComponent(key)}`)

export const getOrders = (q: string, status = '') =>
  request<{ list: any[]; total: number }>(`/wx/orders?q=${encodeURIComponent(q)}${status ? `&status=${encodeURIComponent(status)}` : ''}`)

export const getMarket = (type: 'finished' | 'semi' | 'mold', q = '') =>
  request<{ list: any[] }>(`/wx/market?type=${type}&q=${encodeURIComponent(q)}`)

/** 市场产品详情（字段与 Web 详情弹窗同口径；报价记录仅发布方自己下发） */
export interface MarketDetail {
  id: string
  type: string
  shortName?: string
  styleCode?: string
  productCode?: string
  unit?: string
  quantity?: number
  totalStock?: number
  targetPrice?: number
  status?: string
  deadline?: string
  processTypes?: string[]
  deposit?: number
  depositStatus?: string
  remark?: string
  publishTime?: string
  shoeUpper?: string
  shoeSole?: string
  images?: string[]
  variants?: { color: string; spec: string; productCode: string; unitPrice: number; stock: number; status: string }[]
  quoteCount?: number
  quotes?: {
    company: string; unitPrice: number; totalPrice: number; quantity: number;
    deliveryDays: number; contactPerson: string; contactPhone: string; time: string; status: string
  }[]
  publisherUsername?: string
  publisherCompany?: string
  canContact?: boolean
  /** 是否本人发布（决定报价价格是否全量、是否显示报价入口） */
  isMine?: boolean
  /** 是否可见实际库存（供应商库存同步设置白名单命中或本人；false 时库存字段下发 -1，界面显示 ***） */
  canViewInventory?: boolean
  /** 模具租售 */
  title?: string
  moldCode?: string
  moldName?: string
  spec?: string
  mode?: string
  price?: number
  rent?: boolean
  specs?: { spec: string; qty: number }[]
  totalQty?: number
}

export const getMarketDetail = (type: string, id: string) =>
  request<{ detail: MarketDetail }>(`/wx/market/${type}/${encodeURIComponent(id)}`)

/** 加工厂对发包单提交报价（同厂重复报价覆盖自身那条） */
export const submitMarketQuote = (id: string, body: { unitPrice: number; totalPrice?: number; deliveryDays?: number; contactPerson?: string; contactPhone?: string; remark?: string }) =>
  request<{ saved: boolean; quoteCount: number }>(`/wx/market/${encodeURIComponent(id)}/quote`, { method: 'POST', data: body })

/** 站内消息（与网页版 ChatPage 同一份消息库；手机端 HTTP + 轮询） */
export interface ChatMsg {
  id: string; from: string; to: string; content: string; type: string; subject: string; ts: number; mine: boolean
}

export interface ChatPeer { username: string; name: string; company: string; online?: boolean }

export const getChatHistory = (to: string) =>
  request<{ convId: string; other: ChatPeer; messages: ChatMsg[] }>(
    `/wx/chat/history?to=${encodeURIComponent(to)}&limit=100`,
  )

export const sendChatMessage = (body: { to: string; content: string; msg_type?: 'text' | 'image'; subject?: string }) =>
  request<{ saved: boolean; message: ChatMsg }>('/wx/chat/send', { method: 'POST', data: body })

export const markChatRead = (to: string) =>
  request<{ saved: boolean }>('/wx/chat/read', { method: 'POST', data: { to } })

/** 会话列表（我的消息）：与 Web ChatPage 左列同源，含对方展示信息与各自未读数 */
export interface ConvItem {
  convId: string
  other: ChatPeer
  lastMessage: string
  lastMessageType: string
  lastTime: number
  subject: string
  unread: number
}

export const getChatConversations = () =>
  request<{ list: ConvItem[] }>('/wx/chat/conversations')

export const getChatUnread = () =>
  request<{ count: number }>('/wx/chat/unread')

/** 企业信息（与网页版右上角「企业信息」弹窗基本信息同口径） */
export interface CompanyProfile {
  username: string
  role: string
  name: string
  companyName: string
  legalPerson: string
  companyNo: string
  orderPrefix: string
  taxpayerCode: string
  contactPerson: string
  phone: string
  address: string
  email: string
  registerDate: string
  status: string
  trialEndDate: string
  authorizedUntil: string
}

export const getProfile = () => request<{ profile: CompanyProfile }>('/wx/profile')

/** 银行账户交易流水（与 Web normalizeBankTxns 口径一致） */
export interface BankTxn {
  time: string
  type: 'in' | 'out'
  amount: number
  balanceAfter: number | null
  counterparty: string
  person: string
  remark: string
}

/** 银行账户（服务端 /wx/bank-accounts 只读下发，不含密码类字段） */
export interface BankAccount {
  key: string
  name: string
  shortName: string
  bankName: string
  branchName: string
  bankAccountNo: string
  accountType: string
  balance: number
  status: string
  openDate: string
  person: string
  txnCount?: number
  transactions?: BankTxn[]
}

export const getBankAccounts = (q = '') =>
  request<{ list: BankAccount[]; total: number; totalBalance: number }>(`/wx/bank-accounts?q=${encodeURIComponent(q)}`)

export interface AttendanceRecord { key: string; username: string; name?: string; date: string; in: string; out: string; photoIn?: string; photoOut?: string }

/** 班次打卡配置（服务端 GET /wx/attendance 下发，驱动小程序范围/拍照打卡） */
export interface AttendanceShift {
  name: string
  startTime: string
  endTime: string
  punchLat: number | null
  punchLng: number | null
  punchRadius: number
  requirePhoto: boolean
  clockInLocation: string
  clockInAddress: string
}

export const getAttendance = () => request<{ record: AttendanceRecord | null; date: string; shift: AttendanceShift | null }>('/wx/attendance')

/** 打卡：type 上/下班；lat/lng 为 wgs84 定位（班次设了范围时必传）；photo 为拍照上传后的 URL（requirePhoto 时必传） */
export const postAttendance = (body: { type: 'in' | 'out'; lat?: number; lng?: number; photo?: string }) =>
  request<{ saved: boolean; record: AttendanceRecord }>('/wx/attendance', { method: 'POST', data: body })

export const getLeaves = (tab: 'mine' | 'pending' | 'all') =>
  request<{ list: any[] }>(`/wx/leaves?tab=${tab}`)

export const createLeave = (body: { type: string; startDate: string; endDate: string; reason?: string }) =>
  request<{ saved: boolean; record: any }>('/wx/leaves', { method: 'POST', data: body })

export const auditLeave = (key: string, approved: boolean, rejectReason = '') =>
  request<{ saved: boolean; record: any }>(`/wx/leaves/${encodeURIComponent(key)}/audit`, { method: 'POST', data: approved ? { approved } : { approved, rejectReason } })

/** 通用列表展示结构（服务端 /wx/lists/:page 按 Web 同口径映射后下发） */
export interface ListItem {
  key: string
  title: string
  sub: string[]
  tag?: string
  tone?: string
  amount?: number
  /** 横向表格行单元格（与列表页 headers 顺序对应） */
  row?: string[]
  /** 详情弹层字段（label/值 对），配合 ListView detail 点击展示 */
  fields?: [string, string][]
  /** 副信息逐行字号（px，缺省 24）：生产订单首行款式编码行按用户要求缩 40% */
  subSizes?: number[]
  /** 副信息首行靠右对齐内容（如生产订单创建日期靠右） */
  subRight?: string
  /** 副信息逐行字体颜色（空串=保持默认灰）：生产订单排产行绿色 */
  subColors?: string[]
  /** tag 行内样式覆盖（如已排产绿底白字），优先于 tone 浅色底 */
  tagStyle?: { color?: string; background?: string; borderColor?: string }
  /** 卡片底色（客户列表逐客不同底色） */
  cardBg?: string
}

export const getListPage = (page: string, q: string, extra = '') =>
  request<{ list: ListItem[]; total: number; sums?: string[]; debtTotal?: number }>(`/wx/lists/${page}?q=${encodeURIComponent(q)}${extra ? `&${extra}` : ''}`)

/** 打单拣货列表项（服务端 /wx/picking 下发：卡片三行字段 + 货品明细） */
export interface PickingItem {
  key: string
  id: string
  outboundNo: string
  /** 款式编码×汇总数量（同款式合并求和） */
  styleQty: string
  receiverName: string
  receiverCity: string
  receiverPhone: string
  receiverAddress: string
  customerName: string
  orderStatus: string
  printStatus: string
  /** 发货凭证图片（发货时上传存档） */
  shipImages: string[]
  /** 无关联订单的遗留拣货单（只读，不可发货） */
  legacy: boolean
  totalQty: number
  productAmount: number
  items: { productCode: string; shortName: string; styleCode: string; color: string; spec: string; unit: string; quantity: number; price: number }[]
}

export const getPicking = (q = '') =>
  request<{ list: PickingItem[]; total: number }>(`/wx/picking?q=${encodeURIComponent(q)}`)

/** 立即发货（可改数量）：quantities 与订单货品明细顺序对齐，逐项 0..原数量；
 *  任一项少于原数量则服务端对缺少部分即时缺货拆分（子单号 = 原单号-1、出库单号 = 原出库单号-1）；
 *  images 为发货凭证图片 URL（小程序侧已压缩上传） */
export const shipPicking = (id: string, quantities: number[], images: string[] = []) =>
  request<{ shipped: boolean; docNo: string; splitChildId: string; needSplit: boolean }>(
    `/wx/picking/${encodeURIComponent(id)}/ship`, { method: 'POST', data: { quantities, images } })

export const createBookkeeping = (body: {
  bookDate: string; bookType: '收入' | '支出'; mainCategory: string;
  subCategory?: string; amount: number; account?: string; remark?: string;
}) => request<{ saved: boolean; record: any }>('/wx/bookkeeping', { method: 'POST', data: body })

/** 仓库统计手机录入：备货/配货/急采/奖惩（服务端按 Web 同口径派生工资） */
export const createWsRecord = (kind: 'stock' | 'pick' | 'urgent' | 'note', body: Record<string, any>) =>
  request<{ saved: boolean; record: any }>(`/wx/ws/${kind}`, { method: 'POST', data: body })

/** 仓库统计记录详情：服务端直出原始字段（工资为已派生值） */
export const getWsRecord = (kind: 'stock' | 'pick' | 'urgent' | 'note', key: string) =>
  request<{ record: any }>(`/wx/ws/${kind}/${encodeURIComponent(key)}`)

/** 仓库统计记录编辑：只提交可录入字段，工资/月份由服务端按 Web 同公式重算 */
export const updateWsRecord = (kind: 'stock' | 'pick' | 'urgent' | 'note', key: string, body: Record<string, any>) =>
  request<{ saved: boolean; record: any }>(`/wx/ws/${kind}/${encodeURIComponent(key)}`, { method: 'PUT', data: body })

/** 材质下拉候选：工价表材质 ∪ 已有记录材质去重（与 Web 材质下拉同源） */
export const getWsMaterials = (kind: 'stock' | 'urgent') =>
  request<{ materials: string[] }>(`/wx/ws-materials/${kind}`)

/** 新款进度主表单手机录入（与 Web 新增新款弹窗同字段，服务端派生状态默认值） */
export const createNewStyle = (body: Record<string, any>) =>
  request<{ saved: boolean; record: any }>('/wx/newstyle', { method: 'POST', data: body })

/** 单条排期记录（服务端下发，用于详情弹层展示与修改） */
export interface ScheduleRec {
  key: string
  id: string
  line: string
  shift: string
  startDate: string
  planQty: number
}

/** 待排产订单卡片（与 Web ScheduleBoard 待排产面板同结构） */
export interface ScheduleOrderItem {
  id: string
  moldCode: string
  styleQty: string
  image: string
  productName: string
  planQty: number
  pending: number
  semiText: string
  scheduledQty: number
  statusText: string
  schedules: ScheduleRec[]
  fields?: [string, string][]
}

/** 生产排期看板：生产线×上午/下午/晚上网格 + 待排产订单卡（与 Web ScheduleBoard 同键同口径） */
export interface ScheduleBoardData {
  date: string
  lines: string[]
  shifts: { key: string; label: string; range: string }[]
  cells: Record<string, { total: number; items: { no: string; qty: number }[] }>
  dayTotal: number
  orders: ScheduleOrderItem[]
}

export const getScheduleBoard = (date: string) =>
  request<ScheduleBoardData>(`/wx/schedule-board?date=${date}`)

/** 手机排期登记（与 Web ScheduleBoard 拖拽落库同源：PS- 编号 + 班次 + 待排量钳制） */
export const postSchedule = (body: { productionOrderId: string; date: string; line: string; shift: string; qty: number }) =>
  request<{ saved: boolean; record: any }>('/wx/schedule', { method: 'POST', data: body })

/** 手机修改排期（按记录 key，与新增同闸同钳制） */
export const putSchedule = (key: string, body: { date: string; line: string; shift: string; qty: number }) =>
  request<{ saved: boolean; record: any }>(`/wx/schedule/${key}`, { method: 'PUT', data: body })

/** 对账记录精简形状（服务端 recon_db_supplier_<owner> 存活记录下发） */
export interface ReconRecordBrief {
  key: string
  docNo: string
  customerName: string
  supplierName: string
  ourAmount: number
  theirAmount: number
  initiator: string
  createdAt: string
  reconResult: string
}

/** 对账管理列表（与 Web ReconciliationManage 供应商平台同库同源） */
export const getReconRecords = () => request<{ list: ReconRecordBrief[] }>('/wx/recon-records')

/** 供方确认对账（与 Web completeRecon('confirmSupplier') 同口径落库） */
export const confirmRecon = (key: string) =>
  request<{ saved: boolean }>(`/wx/recon/${encodeURIComponent(key)}/confirm`, { method: 'POST' })
