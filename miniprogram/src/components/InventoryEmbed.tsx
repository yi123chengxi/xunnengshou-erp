import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getInventory } from '../services/api'

// 库存查询内嵌视图：款号/简称/编码模糊搜索
const InventoryEmbed = ({ tick = 0, initialQ = '' }: { tick?: number; initialQ?: string }) => {
  const [q, setQ] = useState(initialQ)
  const [keyword, setKeyword] = useState(initialQ)
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    getInventory(keyword)
      .then(d => { setList(d.list); setTotal(d.total) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [keyword, tick])

  return (
    <View>
      <View style={{ padding: '16px 24px 0' }}>
        <Input
          className="input"
          placeholder="搜索款号 / 商品简称 / 编码"
          value={q}
          onInput={e => setQ(e.detail.value)}
          onConfirm={() => setKeyword(q.trim())}
          confirmType="search"
        />
      </View>
      {loaded && <View className="muted" style={{ padding: '0 24px 8px' }}>共 {total} 条，显示前 {list.length} 条</View>}
      {loaded && list.length === 0 && <View className="empty">暂无匹配商品</View>}
      {list.map((r: any) => (
        <View key={String(r.key)} className="card">
          <View className="row">
            <Text style={{ fontWeight: 600 }}>{r.shortName || r.productCode || '—'}</Text>
            {r.productStatus ? <Text className={`tag ${r.productStatus === '在售' ? 'tag-green' : 'tag-gray'}`}>{r.productStatus}</Text> : null}
          </View>
          <View className="row">
            <Text className="muted">款号 {r.styleCode || '—'}　编码 {r.productCode || '—'}</Text>
          </View>
          <View className="row">
            <Text className="muted">{r.productType || ''}{r.unit ? ` · 单位 ${r.unit}` : ''}</Text>
            {typeof r.stock === 'number' ? <Text className={r.stock <= 0 ? 'amount' : ''}>库存 {r.stock}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

export default InventoryEmbed
