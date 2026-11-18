import Taro from '@tarojs/taro'
import { request } from './request'
import { getToken, setToken, setUser, setUser as saveUser, getBindToken, setBindToken, clearSession, setPreviewMode, clearPreviewMode, SessionUser } from './session'

export { isPreviewMode } from './session'

/** 微信 code → 服务端换 openid：已绑定直接拿令牌，未绑定返回 bindToken 进入账号密码绑定 */
export async function wxLogin(): Promise<{ bound: boolean }> {
  const { code } = await Taro.login()
  const data = await request<{ bound: boolean; token?: string; user?: SessionUser; bindToken?: string }>('/wx/login', {
    method: 'POST',
    data: { code },
  })
  if (data.bound && data.token && data.user) {
    setToken(data.token)
    saveUser(data.user)
    return { bound: true }
  }
  setBindToken(data.bindToken || '')
  return { bound: false }
}

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

/** 启动时恢复会话：有令牌则向服务端复核（归属重算），失效则清会话跳登录 */
export function restoreSession(): void {
  if (!getToken()) {
    const pages = Taro.getCurrentPages()
    const cur = pages[pages.length - 1]
    if (cur && cur.route !== 'pages/login/index') Taro.redirectTo({ url: '/pages/login/index' })
    return
  }
  request<SessionUser>('/wx/me')
    .then(user => setUser(user))
    .catch(() => { /* 401 已在 request 内处理跳转 */ })
}

export const logout = (): void => {
  clearSession()
  Taro.redirectTo({ url: '/pages/login/index' })
}
