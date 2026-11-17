import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { MODULES, TAB_MODULE_PATHS } from '../../config/menu'
import AppTabBar from '../../components/AppTabBar'

// 更多：全部主菜单；点击主菜单 → 进入该主菜单第一个子菜单
const More = () => {
  const open = (key: string) => {
    const tabPath = TAB_MODULE_PATHS[key]
    if (tabPath) Taro.reLaunch({ url: tabPath })
    else Taro.navigateTo({ url: `/pages/module?key=${key}` })
  }
  return (
    <View style={{ paddingBottom: 140 }}>
      <View className="card">
        <View className="card-title">全部功能</View>
        {MODULES.map(m => (
          <View key={m.key} className="row" onClick={() => open(m.key)}>
            <Text>{m.icon} {m.title}</Text>
            <View>
              <Text className="muted" style={{ marginRight: 12 }}>{m.children.map(c => c.title).join(' / ')}</Text>
              <Text style={{ color: '#1677ff' }}>›</Text>
            </View>
          </View>
        ))}
      </View>
      <AppTabBar />
    </View>
  )
}

export default More
