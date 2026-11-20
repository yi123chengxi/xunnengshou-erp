import { useState } from 'react'
import './index.scss'
import { View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import MarketView from '../../components/MarketView'
import AppTabBar from '../../components/AppTabBar'

// 市场 Tab：商机市场，顶部 发包/成品/模具租售 切换，默认成品市场
const Market = () => {
  const [tick, setTick] = useState(0)
  useDidShow(() => setTick(t => t + 1))
  return (
    <View style={{ paddingBottom: 140 }}>
      <MarketView tick={tick} />
      <AppTabBar current="market" />
    </View>
  )
}

export default Market
