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

export const getMarket = (type: 'finished' | 'semi' | 'mold') =>
  request<{ list: any[] }>(`/wx/market?type=${type}`)

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

/** 新款进度主表单手机录入（与 Web 新增新款弹窗同字段，服务端派生状态默认值） */
export const createNewStyle = (body: Record<string, any>) =>
  request<{ saved: boolean; record: any }>('/wx/newstyle', { method: 'POST', data: body })
