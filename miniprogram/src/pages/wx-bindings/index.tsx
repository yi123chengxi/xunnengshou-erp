import { useState, useEffect, useCallback } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getWxBindings, unbindWx, WxAccountBrief } from '../../services/auth'

// 微信绑定管理：当前微信已绑定的公司账号列表 + 解绑（与网页个人中心「微信绑定」同源同口径）
const WxBindings = () => {
  const [list, setList] = useState<WxAccountBrief[] | null>(null)
  const [current, setCurrent] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    setErr('')
    getWxBindings()
      .then(d => { setList(d.list || []); setCurrent(d.current || '') })
      .catch(e => { setErr(e.message || '加载失败'); setList(null) })
  }, [])
  useEffect(() => { load() }, [load])

  const unbind = (username: string) => {
    if (busy) return
    Taro.showModal({
      title: '解绑',
      content: `解绑后本微信扫码登录将不再能进入 ${username}，是否继续？`,
      success: r => {
        if (!r.confirm) return
        setBusy(username)
        unbindWx(username)
          .then(d => { setList(d.list || []); Taro.showToast({ title: '已解绑', icon: 'success' }) })
          .catch(e => Taro.showToast({ title: e.message || '解绑失败', icon: 'none' }))
          .finally(() => setBusy(''))
      },
    })
  }

  return (
    <View style={{ padding: '24px 32px' }}>
      <Text style={{ fontSize: 36, fontWeight: 700, color: '#1f2733', display: 'block', marginBottom: 8 }}>微信绑定管理</Text>
      <Text className="muted" style={{ display: 'block', marginBottom: 24, fontSize: 24 }}>本微信可扫码登录的公司账号；解绑后该公司将不可经微信进入</Text>
      {err && <View className="empty">{err}（需微信登录会话）</View>}
      {!err && list === null && <View className="empty">加载中…</View>}
      {!err && list !== null && list.length === 0 && <View className="empty">本微信尚未绑定任何公司账号</View>}
      {(list || []).map(it => (
        <View key={it.username} style={{ background: '#fff', borderRadius: 0, padding: '20px 24px', marginBottom: 16 }}>
          <View style={{ display: 'flex', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ display: 'block', fontSize: 30, fontWeight: 600, color: '#1f2733' }}>{it.company || it.username}</Text>
              <Text className="muted" style={{ display: 'block', fontSize: 24, marginTop: 4 }}>账号 {it.username}{it.name ? ` · ${it.name}` : ''}</Text>
            </View>
            {it.username === current && (
              <Text style={{ flexShrink: 0, marginLeft: 12, fontSize: 22, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6, padding: '2px 10px' }}>当前登录</Text>
            )}
            <Text
              style={{ flexShrink: 0, marginLeft: 12, fontSize: 26, color: busy === it.username ? '#ff7875' : '#f5222d' }}
              onClick={() => unbind(it.username)}
            >
              {busy === it.username ? '解绑中…' : '解绑'}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}

export default WxBindings
