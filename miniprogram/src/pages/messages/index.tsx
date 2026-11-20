import { useCallback, useState } from 'react'
import './index.scss'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { getChatConversations, ConvItem } from '../../services/api'
import { refreshChatUnread } from '../../services/chatBadge'

const pad = (n: number) => String(n).padStart(2, '0')
const timeText = (ts: number): string => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`
}

// 会话行行内样式（weapp 全局类会压过行内覆盖，尺寸类控件一律行内自带外观）
const ROW = { display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid #f2f4f7' } as const
const AVATAR = { width: 42, height: 42, borderRadius: 21, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1677ff,#4096ff)' } as const
const UNREAD = { flexShrink: 0, minWidth: 17, height: 17, lineHeight: '17px', padding: '0 5px', borderRadius: 9, background: '#ff4d4f', color: '#fff', fontSize: 11, textAlign: 'center', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap' } as const

// 我的消息：与网页版 ChatPage 左列同源的会话列表（市场「联系」产生的会话都在这里）
const MessagesPage = () => {
  const [list, setList] = useState<ConvItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await getChatConversations()
      // 预览模式（后端未部署）GET 404 会静默回落空形状：显式提示，避免「点我的消息没反应」
      if (!d || !Array.isArray(d.list)) {
        Taro.showToast({ title: '消息接口尚未部署上线', icon: 'none' })
        setList([])
      } else {
        setList(d.list)
      }
      void refreshChatUnread()
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '消息加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次进入与从会话页返回时都拉一次，保证未读气泡与最后一条消息同步
  useDidShow(() => { void load() })

  const open = (c: ConvItem) => {
    const to = String(c.other?.username || '')
    if (!to) return
    const nm = encodeURIComponent(String(c.other?.company || c.other?.name || to))
    const subject = encodeURIComponent(String(c.subject || ''))
    Taro.navigateTo({ url: `/pages/chat/index?to=${encodeURIComponent(to)}&name=${nm}&subject=${subject}` })
  }

  const titleOf = (c: ConvItem) => String(c.other?.company || c.other?.name || c.other?.username || '会话')
  const previewOf = (c: ConvItem) => {
    const body = c.lastMessageType === 'image' ? '[图片]' : String(c.lastMessage || '')
    return c.subject ? `【${c.subject}】${body}` : (body || '暂无消息')
  }

  return (
    <View style={{ minHeight: '100vh', background: '#f5f6f8' }}>
      {loading && list.length === 0 ? (
        <View style={{ textAlign: 'center', fontSize: 15, color: '#8a94a6', padding: '40px 0' }}>加载中…</View>
      ) : null}
      {!loading && list.length === 0 ? (
        <View style={{ textAlign: 'center', padding: '80px 0' }}>
          <Text style={{ display: 'block', fontSize: 15, color: '#8a94a6' }}>暂无消息</Text>
          <Text style={{ display: 'block', fontSize: 13, color: '#aab1bd', marginTop: 8 }}>去市场联系供应商后，会话会显示在这里</Text>
        </View>
      ) : null}
      <View style={{ background: '#fff' }}>
        {list.map(c => (
          <View key={c.convId || c.other?.username} style={ROW} onClick={() => open(c)}>
            <View style={AVATAR}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>{titleOf(c).slice(0, 1) || '友'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
              <View style={{ display: 'flex', alignItems: 'center' }}>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: '#1f2733', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {titleOf(c)}
                </Text>
                <Text style={{ flexShrink: 0, marginLeft: 8, fontSize: 12, color: '#9aa3ad' }}>{timeText(c.lastTime)}</Text>
              </View>
              <View style={{ display: 'flex', alignItems: 'center', marginTop: 3 }}>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#8a94a6', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {previewOf(c)}
                </Text>
                {c.unread > 0 ? <Text style={{ ...UNREAD, marginLeft: 8 }}>{c.unread > 99 ? '99+' : c.unread}</Text> : null}
                {c.other?.online ? <Text style={{ marginLeft: 6, fontSize: 12, color: '#52c41a' }}>●</Text> : null}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export default MessagesPage
