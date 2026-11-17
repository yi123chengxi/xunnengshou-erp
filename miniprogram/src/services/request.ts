import Taro from '@tarojs/taro'
import { API_BASE } from './config'
import { getToken, clearSession } from './session'

export interface ApiResp<T = any> { code: number; data: T; message?: string }

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
  if (res.statusCode >= 400) {
    throw new Error(body.message || (body as any).error || `请求失败(${res.statusCode})`)
  }
  return body.data
}
