import { useState } from 'react'
import './index.scss'
import { View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import ModuleView from '../../components/ModuleView'
import AppTabBar from '../../components/AppTabBar'

// 财务 Tab：财务管理模块容器（默认第一子菜单=审批中心）
const Finance = () => {
  const [tick, setTick] = useState(0)
  useDidShow(() => setTick(t => t + 1))
  return (
    <View style={{ paddingBottom: 120 }}>
      <ModuleView moduleKey="finance" tick={tick} />
      <AppTabBar current="finance" />
    </View>
  )
}

export default Finance
