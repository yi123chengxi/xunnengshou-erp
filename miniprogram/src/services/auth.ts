import Taro from '@tarojs/taro'
import { request } from './request'
import { getToken, setToken, setUser, setUser as saveUser, getBindToken, setBindToken, clearSession, setPreviewMode, clearPreviewMode, setGuestMode, SessionUser } from './session'

export { isPreviewMode } from './session'

/** 选择公司页/绑定管理共用的账号摘要 */
export interface WxAccountBrief { username: string; name: string; company: string }

/** 微信 code → 服务端换 openid：单绑定直接拿令牌；多绑定返回 needSelect 并暂存 ticket+列表；未绑定返回 bindToken 进入账号密码绑定 */
export async function wxLogin(): Promise<{ bound: boolean; needSelect?: boolean }> {
  const { code } = await Taro.login()
  const data = await request<{ bound: boolean; token?: string; user?: SessionUser; bindToken?: string; needSelect?: boolean; ticket?: string; list?: WxAccountBrief[] }>('/wx/login', {
    method: 'POST',
    data: { code },
  })
  if (data.bound && data.token && data.user) {
    setToken(data.token)
    saveUser(data.user)
    return { bound: true }
  }
  if (data.needSelect) {
    Taro.setStorageSync('wx_select_ctx', { ticket: data.ticket || '', list: data.list || [] })
    return { bound: false, needSelect: true }
  }
  setBindToken(data.bindToken || '')
  return { bound: false }
}

export const readSelectCtx = (): { ticket: string; list: WxAccountBrief[] } | null => {
  try { return Taro.getStorageSync('wx_select_ctx') || null } catch { return null }
}

/** 多绑定扫码后选定公司：凭 ticket 换令牌并清选择上下文 */
export async function selectCompany(username: string): Promise<void> {
  const ctx = readSelectCtx()
  if (!ctx || !ctx.ticket) throw new Error('选择凭证已过期，请重新登录')
  const data = await request<{ bound: boolean; token: string; user: SessionUser }>('/wx/login/select', {
    method: 'POST',
    data: { ticket: ctx.ticket, username },
  })
  setToken(data.token)
  saveUser(data.user)
  Taro.removeStorageSync('wx_select_ctx')
}

/** 当前微信已绑公司账号列表（令牌须为微信登录会话） */
export const getWxBindings = () => request<{ list: WxAccountBrief[]; current: string }>('/wx/bindings')

/** 解绑指定公司账号 */
export const unbindWx = (username: string) => request<{ unbound: string; list: WxAccountBrief[] }>('/wx/unbind', { method: 'POST', data: { username } })

/** 首次使用：ERP 账号密码绑定当前微信 */
export async function bindAccount(username: string, password: string): Promise<void> {
  const bindToken = getBindToken()
  const data = await request<{ bound: boolean; token: string; user: SessionUser }>('/wx/bind', {
    method: 'POST',
    data: { bindToken, username, password },
  })
  setToken(data.token)
  saveUser(data.user)
  setBindToken('')
}

/** H5 预览端登录：无 wx.login，走与网页同源的账号密码登录（JWT 与 /wx/* 同令牌体系）。
 *  /wx/me 不可用（后端未部署）时降级为布局预览模式：会话照建、首页提示数据待部署 */
export async function passwordLogin(username: string, password: string): Promise<void> {
  const data = await request<{ token: string; user: any }>('/auth/login', {
    method: 'POST',
    data: { username, password },
  })
  setToken(data.token)
  try {
    const me = await request<SessionUser>('/wx/me')
    setUser(me)
    clearPreviewMode()
  } catch {
    setUser({
      username: data.user.username,
      role: String(data.user.role || ''),
      owner: data.user.username,
      name: data.user.name || data.user.username,
      company_name: data.user.company_name || '',
    })
    setPreviewMode()
  }
}

/** 启动时恢复会话：有令牌则向服务端复核（归属重算）。
 *  无令牌时不再跳登录页——微信登录规范禁止一进小程序就强制登录，
 *  未登录一律留在当前页以浏览模式渲染（首页会置游客位） */
export function restoreSession(): void {
  if (!getToken()) return
  request<SessionUser>('/wx/me')
    .then(user => setUser(user))
    .catch(() => { /* 401 已在 request 内处理 */ })
}

/** 退出登录：清会话后回首页浏览模式，而非把用户锁在登录页 */
export const logout = (): void => {
  clearSession()
  setGuestMode()
  Taro.reLaunch({ url: '/pages/workbench/index' })
}
