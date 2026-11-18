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
