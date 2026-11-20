import Taro from '@tarojs/taro'
import { getChatUnread } from './api'
import { getToken } from './session'

/**
 * 「我的」按键未读气泡：模块级缓存 + Taro.eventCenter 广播。
 * AppTabBar 每次挂载订阅并立即回调缓存值；各页面在会话已读/新消息后调
 * refreshChatUnread 同步，避免「读完消息气泡不减」的陈旧角标。
 */
const EVT = 'wx_chat_unread'
let last = -1
let pollTimer: ReturnType<typeof setInterval> | null = null

export const refreshChatUnread = async (): Promise<void> => {
  if (!getToken()) { last = 0; Taro.eventCenter.trigger(EVT, 0); return }
  try {
    const d = await getChatUnread()
    last = Number(d?.count) || 0
    Taro.eventCenter.trigger(EVT, last)
  } catch { /* 角标拉取失败静默，不打扰当前页面 */ }
}

/** 订阅未读数变化：注册即回调当前缓存值；首个订阅者拉起 30s 轻轮询，返回解绑函数 */
export const onChatUnread = (fn: (n: number) => void): (() => void) => {
  Taro.eventCenter.on(EVT, fn)
  if (last >= 0) fn(last)
  if (!pollTimer) {
    pollTimer = setInterval(() => { void refreshChatUnread() }, 30000)
    void refreshChatUnread()
  }
  return () => Taro.eventCenter.off(EVT, fn)
}
