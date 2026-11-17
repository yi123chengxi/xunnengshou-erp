import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getMarket } from '../services/api'

const SEGMENTS = [
  { key: 'semi', label: '发包市场' },
  { key: 'finished', label: '成品市场' },
  { key: 'mold', label: '模具租售' },
] as const

type MarketType = 'semi' | 'finished' | 'mold'

// 商机市场视图：顶部三切换（默认成品市场），只读卡片列表
const MarketView = ({ fixedType, tick = 0 }: { fixedType?: MarketType; tick?: number }) => {
  const [type, setType] = useState<MarketType>(fixedType || 'finished')
  const [list, setList] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (fixedType) setType(fixedType)
  }, [fixedType])

  useEffect(() => {
    setLoaded(false)
    getMarket(type)
      .then(d => setList(d.list))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [type, tick])

  return (
    <View>
      {!fixedType && (
        <View className="segment" style={{ margin: '16px 24px 0' }}>
          {SEGMENTS.map(s => (
            <View key={s.key} className={`segment-item ${type === s.key ? 'active' : ''}`} onClick={() => setType(s.key)}>
              {s.label}
            </View>
          ))}
        </View>
      )}
      {loaded && list.length === 0 && <View className="empty">暂无上架信息</View>}
      {list.map((r: any) => (
        <View key={String(r.id)} className="card">
          {type === 'mold' ? (
            <>
              <View className="row">
                <Text style={{ fontWeight: 600 }}>{r.title}</Text>
                <Text className="amount">¥{(Number(r.price) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
              </View>
              <View className="row">
                <Text className="muted">{r.publisherCompany || '—'}</Text>
                <Text className="muted">{String(r.publishTime || '').slice(0, 10)}</Text>
              </View>
            </>
          ) : (
            <>
              <View className="row">
                <Text style={{ fontWeight: 600 }}>{r.shortName || r.styleCode || r.id}</Text>
                {r.status ? <Text className="tag tag-blue">{r.status}</Text> : null}
              </View>
              <View className="row">
                <Text className="muted">款号 {r.styleCode || '—'}　数量 {r.quantity || '—'}</Text>
              </View>
              <View className="row">
                <Text className="muted">{r.publisherCompany || '—'}　{r.quoteCount || 0} 条报价/询价</Text>
                {r.targetPrice ? <Text className="amount">期望 ¥{r.targetPrice}</Text> : null}
              </View>
            </>
          )}
        </View>
      ))}
    </View>
  )
}

export default MarketView
