import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { getUser } from '../../services/session'
import { logout } from '../../services/auth'
import { SessionUser } from '../../services/session'
import AppTabBar from '../../components/AppTabBar'

const ROLE_TEXT: Record<string, string> = {
  supplier: '供应商', purchaser: '采购商', factory: '加工厂', both: '供应商+采购商', admin: '管理员',
}

// 我的：账号信息 + 退出登录
const Mine = () => {
  let user: SessionUser | null = null
  useDidShow(() => { user = getUser() })
  user = getUser()

  const onLogout = () => {
    Taro.showModal({
      title: '提示',
      content: '确定退出登录吗？',
      success: r => { if (r.confirm) logout() },
    })
  }

  return (
    <View style={{ paddingBottom: 140 }}>
      <View style={{ background: 'linear-gradient(135deg,#1677ff,#4096ff)', padding: '48px 32px', color: '#fff' }}>
        <Text style={{ fontSize: 40, fontWeight: 600, display: 'block' }}>{user?.name || user?.username || '未登录'}</Text>
        <Text style={{ fontSize: 24, opacity: 0.85 }}>
          {user?.company_name || ''} {user ? `· ${ROLE_TEXT[user.role] || user.role}` : ''}
        </Text>
      </View>
      <View className="card">
        <View className="row"><Text className="muted">账号</Text><Text>{user?.username || '—'}</Text></View>
        <View className="row"><Text className="muted">数据归属</Text><Text>{user?.owner || '—'}</Text></View>
        <View className="row"><Text className="muted">版本</Text><Text>v1.0.0</Text></View>
      </View>
      <View style={{ padding: '0 24px' }}>
        <Button className="btn-danger" onClick={onLogout}>退出登录</Button>
      </View>
      <AppTabBar current="mine" />
    </View>
  )
}

export default Mine
