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

export const getOrders = (q: string) =>
  request<{ list: any[]; total: number }>(`/wx/orders?q=${encodeURIComponent(q)}`)

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
}

export const getBankAccounts = (q = '') =>
  request<{ list: BankAccount[]; total: number; totalBalance: number }>(`/wx/bank-accounts?q=${encodeURIComponent(q)}`)

export interface AttendanceRecord { key: string; username: string; name?: string; date: string; in: string; out: string }

export const getAttendance = () => request<{ record: AttendanceRecord | null; date: string }>('/wx/attendance')

export const postAttendance = (type: 'in' | 'out') =>
  request<{ saved: boolean; record: AttendanceRecord }>('/wx/attendance', { method: 'POST', data: { type } })

export const getLeaves = (tab: 'mine' | 'pending' | 'all') =>
  request<{ list: any[] }>(`/wx/leaves?tab=${tab}`)

export const createLeave = (body: { type: string; startDate: string; endDate: string; reason?: string }) =>
  request<{ saved: boolean; record: any }>('/wx/leaves', { method: 'POST', data: body })

export const auditLeave = (key: string, approved: boolean) =>
  request<{ saved: boolean; record: any }>(`/wx/leaves/${encodeURIComponent(key)}/audit`, { method: 'POST', data: { approved } })

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
}

export const getListPage = (page: string, q: string, extra = '') =>
  request<{ list: ListItem[]; total: number; sums?: string[] }>(`/wx/lists/${page}?q=${encodeURIComponent(q)}${extra ? `&${extra}` : ''}`)

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

/** 生产排期看板：生产线×上午/下午/晚上网格（与 Web ScheduleBoard 同键同口径） */
export interface ScheduleBoardData {
  date: string
  lines: string[]
  shifts: { key: string; label: string; range: string }[]
  cells: Record<string, { total: number; items: { no: string; qty: number }[] }>
  dayTotal: number
}

export const getScheduleBoard = (date: string) =>
  request<ScheduleBoardData>(`/wx/schedule-board?date=${date}`)
