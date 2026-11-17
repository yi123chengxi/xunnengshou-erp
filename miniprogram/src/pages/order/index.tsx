import { useState } from 'react'
import { View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import ModuleView from '../../components/ModuleView'
import AppTabBar from '../../components/AppTabBar'

// 订单 Tab：订单管理模块容器（默认第一子菜单=订单查询）
const Order = () => {
  const [tick, setTick] = useState(0)
  useDidShow(() => setTick(t => t + 1))
  return (
    <View style={{ paddingBottom: 120 }}>
      <ModuleView moduleKey="order" tick={tick} />
      <AppTabBar current="order" />
    </View>
  )
}

export default Order
