import Taro from '@tarojs/taro'

// 会话存储（与 Web 端 localStorage 隔离，小程序独立 storage）
const TOKEN_KEY = 'wx_token'
const USER_KEY = 'wx_user'
const BIND_TOKEN_KEY = 'wx_bind_token'

export interface SessionUser {
  username: string
  role: string
  owner: string
  name: string
  company_name?: string
}

export const getToken = (): string => {
  try { return Taro.getStorageSync(TOKEN_KEY) || '' } catch { return '' }
}
export const setToken = (token: string): void => {
  try { Taro.setStorageSync(TOKEN_KEY, token) } catch { /* ignore */ }
}
export const getUser = (): SessionUser | null => {
  try { return Taro.getStorageSync(USER_KEY) || null } catch { return null }
}
export const setUser = (user: SessionUser): void => {
  try { Taro.setStorageSync(USER_KEY, user) } catch { /* ignore */ }
}
export const getBindToken = (): string => {
  try { return Taro.getStorageSync(BIND_TOKEN_KEY) || '' } catch { return '' }
}
export const setBindToken = (t: string): void => {
  try { Taro.setStorageSync(BIND_TOKEN_KEY, t) } catch { /* ignore */ }
}
export const clearSession = (): void => {
  try {
    Taro.removeStorageSync(TOKEN_KEY)
    Taro.removeStorageSync(USER_KEY)
    Taro.removeStorageSync(BIND_TOKEN_KEY)
  } catch { /* ignore */ }
}
