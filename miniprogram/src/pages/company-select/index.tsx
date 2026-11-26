import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { readSelectCtx, selectCompany, WxAccountBrief } from '../../services/auth'

// 选择公司：微信绑定多个公司账号时，扫码/一键登录后在此选定进入（selectCompany 落 token 后进工作台）
const CompanySelect = () => {
  const [ctx, setCtx] = useState<{ ticket: string; list: WxAccountBrief[] } | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    const c = readSelectCtx()
    if (!c || !c.ticket || !(c.list || []).length) {
      // 凭证失效时原路返回登录页（本页由 navigateTo 打开）；用 redirectTo 会清掉返回链路把用户锁住
      Taro.navigateBack().catch(() => Taro.redirectTo({ url: '/pages/login/index' }))
      return
    }
    setCtx(c)
  }, [])

  const choose = async (username: string) => {
    if (busy) return
    setBusy(username)
    try {
      await selectCompany(username)
      // 无原生 tabBar，Tab 页跳转须用 reLaunch（switchTab 会 fail 致页面不跳转）
      Taro.reLaunch({ url: '/pages/workbench/index' })
    } catch (e: any) {
      Taro.showToast({ title: e.message || '选择失败，请重新登录', icon: 'none' })
      setBusy('')
    }
  }

  return (
    <View style={{ padding: '40px 32px' }}>
      <Text style={{ fontSize: 40, fontWeight: 700, color: '#1f2733', display: 'block', marginBottom: 8 }}>选择公司</Text>
      <Text className="muted" style={{ display: 'block', marginBottom: 32, fontSize: 26 }}>该微信绑定了多个公司账号，请选择要进入的公司</Text>
      {(ctx?.list || []).map(it => (
        <View
          key={it.username}
          style={{ background: '#fff', borderRadius: 0, padding: '24px 28px', marginBottom: 20, boxShadow: '0 1px 4px rgba(31,39,51,0.06)' }}
          onClick={() => choose(it.username)}
        >
          <View style={{ display: 'flex', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ display: 'block', fontSize: 32, fontWeight: 600, color: '#1f2733' }}>{it.company || it.username}</Text>
              <Text className="muted" style={{ display: 'block', fontSize: 24, marginTop: 4 }}>账号 {it.username}{it.name ? ` · ${it.name}` : ''}</Text>
            </View>
            <Text style={{ flexShrink: 0, marginLeft: 16, fontSize: 26, color: busy === it.username ? '#9ec9ff' : '#1677ff' }}>
              {busy === it.username ? '进入中…' : '选择 ›'}
            </Text>
          </View>
        </View>
      ))}
      <View style={{ marginTop: 24, textAlign: 'center' }}>
        <Text style={{ fontSize: 26, color: '#1677ff', padding: '12px 16px' }} onClick={() => Taro.navigateBack().catch(() => Taro.redirectTo({ url: '/pages/login/index' }))}>返回登录</Text>
      </View>
    </View>
  )
}

export default CompanySelect
