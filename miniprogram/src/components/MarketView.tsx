import { useState, useEffect } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getMarket } from '../services/api'

const SEGMENTS = [
  { key: 'semi', label: '发包市场' },
  { key: 'finished', label: '成品市场' },
  { key: 'mold', label: '模具租售' },
] as const

type MarketType = 'semi' | 'finished' | 'mold'

const statusTag = (status: string) => {
  if (status === '待报价' || status === '待确认') return 'tag-orange'
  if (status === '报价中' || status === '已发布') return 'tag-blue'
  if (status === '已关闭') return 'tag-gray'
  return 'tag-green'
}

// 商机市场视图：顶部三切换（默认成品市场），商品双列卡片式展示。
// 与 Web 市场卡片同口径：成品卡不显示简称标题（首行款号标签）、不显示报价/询价数；
// 报价/询价数仅发包市场显示；模具卡左上角租/售角标
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
      <View style={{ display: 'flex', flexWrap: 'wrap', padding: '8px 16px 0' }}>
        {list.map((r: any) => (
          <View key={String(r.id)} style={{ width: '50%', boxSizing: 'border-box', padding: 8 }}>
            <View style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(31,39,51,0.06)', position: 'relative' }}>
              {/* 封面区：padding-top:100% 撑出正方形（H5/weapp 通用，不依赖 aspect-ratio） */}
              <View style={{ position: 'relative', width: '100%', paddingTop: '100%' }}>
                {r.image ? (
                  <Image src={r.image} mode="aspectFill" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                ) : (
                  <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'linear-gradient(135deg,#e6f4ff,#f0f5ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72 }}>
                    {type === 'mold' ? '🧰' : '🛍️'}
                  </View>
                )}
                {type === 'mold' && r.mode ? (
                  <Text style={{ position: 'absolute', top: 0, left: 0, color: '#fff', fontSize: 20, lineHeight: '32px', padding: '0 14px', borderRadius: '12px 0 12px 0', background: r.mode === '出租' ? 'linear-gradient(135deg,#1677ff,#69b1ff)' : 'linear-gradient(135deg,#52c41a,#95de64)' }}>
                    {r.mode}
                  </Text>
                ) : null}
              </View>
              <View style={{ padding: '12px 16px 16px' }}>
                <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text className="tag tag-blue" style={{ maxWidth: 200, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {type === 'mold' ? (r.title || r.id) : (r.styleCode || r.id)}
                  </Text>
                  {r.status ? <Text className={`tag ${statusTag(r.status)}`}>{r.status}</Text> : null}
                </View>
                {type === 'semi' && r.shortName ? (
                  <Text style={{ fontSize: 26, fontWeight: 600, display: 'block', margin: '8px 0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {r.shortName}
                  </Text>
                ) : null}
                {type === 'mold' ? (
                  <Text style={{ fontSize: 26, fontWeight: 600, display: 'block', margin: '8px 0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {r.title}
                  </Text>
                ) : null}
                <Text className="muted" style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {r.publisherCompany || '—'}
                </Text>
                <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  {type === 'mold' ? (
                    <Text className="amount">¥{(Number(r.price) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
                  ) : r.targetPrice ? (
                    <Text className="amount">期望 ¥{r.targetPrice}</Text>
                  ) : (
                    <Text className="muted">价格面议</Text>
                  )}
                  {type === 'semi' ? <Text className="muted">{r.quoteCount || 0} 报价</Text> : null}
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export default MarketView
