import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getOrders } from '../services/api'

// 订单查询内嵌视图：单号/客户模糊搜索，只读列表
const OrdersEmbed = ({ tick = 0 }: { tick?: number }) => {
  const [q, setQ] = useState('')
  const [keyword, setKeyword] = useState('')
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    getOrders(keyword)
      .then(d => { setList(d.list); setTotal(d.total) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [keyword, tick])

  return (
    <View>
      <View style={{ padding: '16px 24px 0' }}>
        <Input
          className="input"
          placeholder="搜索订单号 / 客户名称"
          value={q}
          onInput={e => setQ(e.detail.value)}
          onConfirm={() => setKeyword(q.trim())}
          confirmType="search"
        />
      </View>
      {loaded && <View className="muted" style={{ padding: '0 24px 8px' }}>共 {total} 条，显示前 {list.length} 条</View>}
      {loaded && list.length === 0 && <View className="empty">暂无匹配订单</View>}
      {list.map((r: any) => (
        <View key={String(r.key)} className="card">
          <View className="row">
            <Text style={{ fontWeight: 600 }}>{r.orderNo || '—'}</Text>
            <Text className="amount">¥{(Number(r.salesAmount) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
          </View>
          <View className="row">
            <Text className="muted">{r.customerName || '—'}</Text>
            <Text className="muted">{String(r.createTime || '').slice(0, 10)}</Text>
          </View>
          <View className="row">
            <Text className="muted">业务员 {r.person || '—'}</Text>
            {r.status ? <Text className="tag tag-blue">{r.status}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  )
}

export default OrdersEmbed
