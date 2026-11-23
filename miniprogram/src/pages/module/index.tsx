import { useState } from 'react'
import './index.scss'
import { View } from '@tarojs/components'
import { useDidShow, useLoad } from '@tarojs/taro'
import ModuleView from '../../components/ModuleView'
import AppTabBar from '../../components/AppTabBar'

// 通用模块页（非 Tab 主菜单入口）：?key=模块&child=子菜单&q=扫码关键字&extra=过滤参数（如客户名）
const Module = () => {
  const [params, setParams] = useState<{ key: string; child?: string; q?: string; extra?: string }>({ key: '' })
  const [tick, setTick] = useState(0)
  useLoad(p => setParams({ key: String(p.key || ''), child: p.child ? String(p.child) : undefined, q: p.q ? String(p.q) : undefined, extra: p.extra ? String(p.extra) : undefined }))
  useDidShow(() => setTick(t => t + 1))
  return (
    <View style={{ paddingBottom: 120 }}>
      {params.key
        ? <ModuleView moduleKey={params.key} initialChild={params.child} initialQ={params.q} initialExtra={params.extra} tick={tick} />
        : <View className="empty">加载中…</View>}
      <AppTabBar />
    </View>
  )
}

export default Module
