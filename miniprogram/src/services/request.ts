import Taro from '@tarojs/taro'
import { API_BASE } from './config'
import { getToken, clearSession, isPreviewMode } from './session'

export interface ApiResp<T = any> { code: number; data: T; message?: string }

// 布局预览模式：/wx/* 未部署(404)时回落的空数据形状，覆盖各接口消费字段，列表页静默展示空态
const PREVIEW_EMPTY: any = {
  list: [], total: 0, record: null, date: '',
  today: { orderCount: 0, salesAmount: 0 },
  month: { orderCount: 0, salesAmount: 0 },
  todos: { reimbPending: 0, payPending: 0, recvPending: 0 },
  saved: true,
}

/** 统一请求封装：自动带 JWT、401 清会话跳登录、非 2xx 抛中文错误 */
export async function request<T = any>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT'; data?: any } = {},
): Promise<T> {
  const header: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) header.Authorization = `Bearer ${token}`
  let res: Taro.request.SuccessCallbackResult
  try {
    res = await Taro.request({
      url: `${API_BASE}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: 15000,
    })
  } catch {
    throw new Error('网络异常，请检查网络后重试')
  }
  if (res.statusCode === 401) {
    clearSession()
    Taro.redirectTo({ url: '/pages/login/index' })
    throw new Error('登录已过期，请重新登录')
  }
  const body = (res.data || {}) as ApiResp<T>
  if (res.statusCode === 404 && path.startsWith('/wx/') && isPreviewMode()) {
    // 布局预览兜底：只读接口静默回落空态供验收布局；
    // 写接口必须显式报错——否则假成功会让用户误以为数据已落库（实测：仓库统计新增在未部署时被静默丢弃）
    if ((options.method || 'GET') === 'GET') return PREVIEW_EMPTY as T
    throw new Error('该写入接口尚未部署上线，操作未生效（部署后即可用）')
  }
  if (res.statusCode >= 400) {
    throw new Error(body.message || (body as any).error || `请求失败(${res.statusCode})`)
  }
  return body.data
}
