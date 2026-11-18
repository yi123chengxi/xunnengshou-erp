import { useState, useEffect } from 'react'
import { View, Text, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getListPage, ListItem } from '../services/api'

const TONE_CLASS: Record<string, string> = {
  blue: 'tag-blue', green: 'tag-green', orange: 'tag-orange', red: 'tag-red', gray: 'tag-gray',
}

/**
 * 通用列表视图：服务端 /wx/lists/:page 按 Web 同页面口径映射后下发展示结构，
 * 用于补齐日常记账/生产订单/采购订单/新款进度/店铺/仓库统计/品牌/员工/客户等子菜单。
 * 搜索为「点击查询后才生效」的双态模式，减少大列表实时过滤开销。
 */
const ListView = ({ page, extra = '', tick = 0 }: { page: string; extra?: string; tick?: number }) => {
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [list, setList] = useState<ListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    getListPage(page, applied, extra)
      .then(d => { setList(d.list || []); setTotal(d.total || 0) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [page, applied, extra, tick])

  return (
    <View>
      <View style={{ display: 'flex', padding: '16px 24px 0', alignItems: 'center' }}>
        <Input
          className="input"
          style={{ flex: 1 }}
          placeholder="搜索关键字"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        <Button size="mini" className="btn-primary" style={{ marginLeft: 12, lineHeight: '56px' }} onClick={() => setApplied(input.trim())}>
          查询
        </Button>
      </View>
      {loaded && total > 0 && (
        <View className="muted" style={{ padding: '8px 24px 0', fontSize: 22 }}>
          共 {total} 条{total > 100 ? '，仅显示前 100 条' : ''}
        </View>
      )}
      {loaded && list.length === 0 && <View className="empty">暂无数据</View>}
      {list.map(it => (
        <View key={String(it.key)} className="card">
          <View className="row">
            <Text style={{ fontWeight: 600, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {it.title}
            </Text>
            {it.tag ? <Text className={`tag ${TONE_CLASS[it.tone || 'blue'] || 'tag-blue'}`}>{it.tag}</Text> : null}
          </View>
          {(it.sub || []).map((s, i) => (
            <View key={i} className="muted" style={{ paddingTop: 4, fontSize: 24 }}>{s}</View>
          ))}
          {typeof it.amount === 'number' && it.amount !== 0 ? (
            <View style={{ paddingTop: 8, fontWeight: 700, fontSize: 30, color: it.amount >= 0 ? '#52c41a' : '#ff4d4f' }}>
              {it.amount >= 0 ? '+' : '-'}¥{Math.abs(it.amount).toFixed(2)}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export default ListView
