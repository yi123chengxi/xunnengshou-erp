import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Image, Input, ScrollView } from '@tarojs/components'
import Taro, { useRouter, useDidShow, useUnload } from '@tarojs/taro'
import { getChatHistory, sendChatMessage, markChatRead, ChatMsg } from '../../services/api'
import { fullImageUrl } from '../../utils/imageUrl'
import { chooseAndUploadImage } from '../../services/upload'

// 市场「联系」会话页：与网页版 ChatPage 共用服务端同一张 chat_messages（同一份消息库、同一内容审核规则）
// 手机端不常驻 WebSocket，改用可见期间定时拉历史（接收方在线时服务端还会主动 WS 推送给网页端）
const POLL_MS = 5000

const pad = (n: number) => String(n).padStart(2, '0')
const timeText = (ts: number): string => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ChatPage = () => {
  const router = useRouter()
  const to = String(router.params.to || '')
  const nameParam = decodeURIComponent(String(router.params.name || ''))
  const subject = decodeURIComponent(String(router.params.subject || ''))

  const [otherName, setOtherName] = useState(nameParam || '供应商')
  const [otherOnline, setOtherOnline] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [anchor, setAnchor] = useState('')
  const shownRef = useRef(false)

  const load = useCallback(async (silent: boolean) => {
    if (!to) { setLoading(false); return }
    if (!silent) setLoading(true)
    try {
      const d = await getChatHistory(to)
      // 预览模式（后端未部署）GET 404 会静默回落空形状：此处显式提示，避免「发消息没反应」
      if (!d || !Array.isArray(d.messages)) {
        if (!silent) Taro.showToast({ title: '聊天接口尚未部署上线', icon: 'none' })
        return
      }
      setMsgs(d.messages)
      setOtherOnline(!!d.other?.online)
      const nm = String(d.other?.company || d.other?.name || '')
      if (nm) {
        setOtherName(nm)
        Taro.setNavigationBarTitle({ title: nm })
      }
      const last = d.messages[d.messages.length - 1]
      setAnchor(last ? `m-${last.id}` : '')
      if (!silent) {
        markChatRead(to).catch(() => { /* 已读标记失败不影响查看 */ })
      }
    } catch (e: any) {
      if (!silent) Taro.showToast({ title: e?.message || '消息加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [to])

  useEffect(() => {
    if (nameParam) Taro.setNavigationBarTitle({ title: nameParam })
    load(false)
    const timer = setInterval(() => load(true), POLL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // 从图片预览/后台切回时立即补一次，不等下个轮询周期
  useDidShow(() => {
    if (shownRef.current) load(true)
    shownRef.current = true
  })
  useUnload(() => { shownRef.current = false })

  const sendText = async () => {
    const c = text.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      await sendChatMessage({ to, content: c, msg_type: 'text', subject })
      setText('')
      await load(true)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '发送失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const sendImage = async () => {
    if (busy) return
    setBusy(true)
    try {
      const url = await chooseAndUploadImage(['album', 'camera'])
      await sendChatMessage({ to, content: url, msg_type: 'image', subject })
      await load(true)
    } catch (e: any) {
      if (!/cancel|取消/i.test(String(e?.errMsg || e?.message || ''))) {
        Taro.showToast({ title: e?.message || '图片发送失败', icon: 'none' })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!to) return <View className="empty">缺少联系对象，请从产品详情重新进入</View>

  // 底部输入条：与网页版一致「图片 + 文本 + 发送」，尺寸全部行内声明（全局类会压过行内覆盖）
  const barH = 39
  const imgBtnStyle = { width: barH, height: barH, flexShrink: 0, borderRadius: 7, background: '#fff', border: '1px solid #c9d1da', boxSizing: 'border-box', textAlign: 'center', lineHeight: `${barH}px`, fontSize: 15, color: '#1677ff' } as const
  const inputStyle = { flex: 1, margin: '0 8px', height: barH, lineHeight: `${barH}px`, fontSize: 17, padding: '0 11px', background: '#fff', border: '1px solid #c9d1da', borderRadius: 7, boxSizing: 'border-box' } as const
  const sendBtnStyle = { height: barH, lineHeight: `${barH}px`, padding: '0 14px', fontSize: 17, color: '#fff', background: busy ? '#9dc3ff' : '#1677ff', borderRadius: 7, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box' } as const

  return (
    <View style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f6f8' }}>
      {/* 会话对象条：与网页版聊天头部同口径（公司名 + 在线/离线） */}
      <View style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', background: '#fff', borderBottom: '1px solid #eef0f3' }}>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {otherName}
        </Text>
        <Text style={{ fontSize: 14, color: otherOnline ? '#52c41a' : '#9aa3ad' }}>
          {otherOnline ? '● 在线' : '● 离线'}
        </Text>
      </View>
      {subject ? (
        <View style={{ padding: '8px 16px', background: '#e6f4ff', fontSize: 14, color: '#1677ff', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          关于：{subject}
        </View>
      ) : null}
      <ScrollView scrollY scrollIntoView={anchor} style={{ flex: 1, padding: '12px 16px' }}>
        {loading && msgs.length === 0 ? (
          <View style={{ textAlign: 'center', fontSize: 15, color: '#8a94a6', padding: '24px 0' }}>加载中…</View>
        ) : null}
        {!loading && msgs.length === 0 ? (
          <View style={{ textAlign: 'center', fontSize: 15, color: '#8a94a6', padding: '24px 0' }}>
            还没有消息，发送第一条与「{otherName}」沟通
          </View>
        ) : null}
        {msgs.map(m => (
          <View
            key={m.id}
            id={`m-${m.id}`}
            style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}
          >
            <View style={{ maxWidth: '76%' }}>
              <View
                style={{
                  background: m.mine ? '#1677ff' : '#fff',
                  borderRadius: m.mine ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                  padding: m.type === 'image' ? 4 : '8px 12px',
                  boxShadow: '0 1px 2px rgba(31,39,51,0.06)',
                }}
              >
                {m.type === 'image' ? (
                  <Image
                    src={fullImageUrl(m.content)} mode="widthFix"
                    style={{ width: 160, borderRadius: 8, display: 'block' }}
                    onClick={() => Taro.previewImage({ urls: [fullImageUrl(m.content)] })}
                  />
                ) : (
                  <Text style={{ fontSize: 17, lineHeight: '24px', color: m.mine ? '#fff' : '#222', wordBreak: 'break-all' }}>
                    {m.content}
                  </Text>
                )}
              </View>
              <Text style={{ display: 'block', fontSize: 12, color: '#9aa3ad', marginTop: 4, textAlign: m.mine ? 'right' : 'left' }}>
                {timeText(m.ts)}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ display: 'flex', alignItems: 'center', padding: '8px 12px calc(8px + env(safe-area-inset-bottom))', background: '#fff', borderTop: '1px solid #eef0f3' }}>
        <View style={imgBtnStyle} onClick={sendImage}>图片</View>
        <Input
          style={inputStyle}
          placeholder="请输入消息"
          placeholderStyle="color:#9aa3ad;font-size:17px"
          value={text}
          onInput={e => setText(e.detail.value)}
          onConfirm={sendText}
          confirmType="send"
          adjustPosition
        />
        <View style={sendBtnStyle} onClick={sendText}>发送</View>
      </View>
    </View>
  )
}

export default ChatPage
