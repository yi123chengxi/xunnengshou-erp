import Taro from '@tarojs/taro'

// 会话存储（与 Web 端 localStorage 隔离，小程序独立 storage）
const TOKEN_KEY = 'wx_token'
const USER_KEY = 'wx_user'
const BIND_TOKEN_KEY = 'wx_bind_token'
const GUEST_KEY = 'wx_guest_mode'

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
  try {
    Taro.setStorageSync(TOKEN_KEY, token)
    // 令牌一旦写入就不可能还是游客：在唯一写点回收游客态，而不是在四条登录路径里各自补调用
    Taro.removeStorageSync(GUEST_KEY)
  } catch { /* ignore */ }
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

// 布局预览模式：/wx/me 不可用（后端未部署）时置位，数据接口 404 静默回落空数据
const PREVIEW_KEY = 'wx_preview_mode'
export const isPreviewMode = (): boolean => {
  try { return Taro.getStorageSync(PREVIEW_KEY) === '1' } catch { return false }
}
export const setPreviewMode = (): void => {
  try { Taro.setStorageSync(PREVIEW_KEY, '1') } catch { /* ignore */ }
}
export const clearPreviewMode = (): void => {
  try { Taro.removeStorageSync(PREVIEW_KEY) } catch { /* ignore */ }
}

// 游客浏览模式：用户在登录环节选择「暂不登录」后置位。
// 微信登录规范要求小程序不得强制登录，故无令牌时须留在页面渲染空态，而非跳回登录页锁住用户。
// 与 PREVIEW_KEY 分开维护：preview 语义是「接口未部署」，游客语义是「未登录」，二者提示文案不同。
export const isGuestMode = (): boolean => {
  try { return Taro.getStorageSync(GUEST_KEY) === '1' } catch { return false }
}
export const setGuestMode = (): void => {
  try { Taro.setStorageSync(GUEST_KEY, '1') } catch { /* ignore */ }
}
export const clearGuestMode = (): void => {
  try { Taro.removeStorageSync(GUEST_KEY) } catch { /* ignore */ }
}
