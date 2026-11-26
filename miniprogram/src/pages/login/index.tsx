import { useState } from 'react'
import './index.scss'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { wxLogin, bindAccount, passwordLogin } from '../../services/auth'
import { getBindToken, setGuestMode } from '../../services/session'

// H5 预览端无 wx.login：直接账号密码登录；weapp 端走微信一键登录/绑定
const isH5 = process.env.TARO_ENV === 'h5'

// 登录页：微信一键登录（已绑定）→ 未绑定则 ERP 账号密码绑定当前微信
const Login = () => {
  const [needBind, setNeedBind] = useState(() => isH5 || !!getBindToken())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  // 本项目无原生 tabBar（底部按键由 AppTabBar 每页内渲染），Tab 页跳转必须用 reLaunch，用 switchTab 会 fail
  const enter = () => Taro.reLaunch({ url: '/pages/workbench/index' }).catch(() => {
    // 跳转失败不再静默吞掉，否则表现为「登录成功但页面没反应」
    Taro.showToast({ title: '已进入首页，请点底部按键', icon: 'none' })
  })

  // 登录环节的取消出口：微信登录规范不允许把用户锁在「只能登录」的页面，
  // 点取消必须真能离开——优先原路返回保留进入登录页前的位置，栈底无上一页时才回首页浏览模式
  const skipLogin = () => {
    setGuestMode()
    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
      Taro.navigateBack().catch(() => Taro.reLaunch({ url: '/pages/workbench/index' }))
    } else {
      Taro.reLaunch({ url: '/pages/workbench/index' }).catch(() => {
        Taro.showToast({ title: '已进入浏览模式，请点底部按键', icon: 'none' })
      })
    }
  }

  const onWxLogin = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await wxLogin()
      if (r.bound) enter()
      else if (r.needSelect) Taro.navigateTo({ url: '/pages/company-select/index' })
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
      {/* 取消入口放在分支外，保证「一键登录态」与「账号绑定态」两种界面都有可用出口 */}
      <View
        style={{ marginTop: 28, textAlign: 'center', fontSize: 28, color: '#595959', padding: '16px 24px' }}
        onClick={skipLogin}
      >
        暂不登录，先随便看看
      </View>
    </View>
  )
}

export default Login
