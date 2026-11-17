import { useState } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { wxLogin, bindAccount, passwordLogin } from '../../services/auth'
import { getBindToken } from '../../services/session'

// H5 预览端无 wx.login：直接账号密码登录；weapp 端走微信一键登录/绑定
const isH5 = process.env.TARO_ENV === 'h5'

// 登录页：微信一键登录（已绑定）→ 未绑定则 ERP 账号密码绑定当前微信
const Login = () => {
  const [needBind, setNeedBind] = useState(() => isH5 || !!getBindToken())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const enter = () => Taro.switchTab({ url: '/pages/workbench/index' })

  const onWxLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await wxLogin()
      if (r.bound) enter()
      else {
        setNeedBind(true)
        Taro.showToast({ title: '首次使用请绑定ERP账号', icon: 'none' })
      }
    } catch (e: any) {
      Taro.showToast({ title: e.message || '登录失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const onBind = async () => {
    if (!username.trim() || !password) {
      Taro.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }
    setBusy(true)
    try {
      if (isH5) await passwordLogin(username.trim(), password)
      else await bindAccount(username.trim(), password)
      enter()
    } catch (e: any) {
      Taro.showToast({ title: e.message || (isH5 ? '登录失败' : '绑定失败'), icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ padding: '60px 48px' }}>
      <View style={{ textAlign: 'center', marginBottom: 60 }}>
        <Text style={{ fontSize: 52, fontWeight: 700, color: '#1677ff', display: 'block' }}>讯能手ERP</Text>
        <Text className="muted" style={{ fontSize: 26 }}>工厂管理 · 移动工作台</Text>
      </View>
      {!needBind ? (
        <Button className="btn-primary" loading={busy} onClick={onWxLogin}>微信一键登录</Button>
      ) : (
        <View>
          <Input className="input" placeholder="ERP账号" value={username} onInput={e => setUsername(e.detail.value)} />
          <Input className="input" password placeholder="密码" value={password} onInput={e => setPassword(e.detail.value)} />
          <Button className="btn-primary" loading={busy} onClick={onBind}>{isH5 ? '登录' : '绑定并登录'}</Button>
          {!isH5 && (
            <View className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
              绑定后此微信将关联该ERP账号，下次可一键登录
            </View>
          )}
        </View>
      )}
    </View>
  )
}

export default Login
