import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
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
const ListView = ({
  page, extra = '', headers, addLabel, onAdd, tick = 0,
}: { page: string; extra?: string; headers?: string[]; addLabel?: string; onAdd?: () => void; tick?: number }) => {
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
          style={{ flex: 1, marginBottom: 0, height: 76, boxSizing: 'border-box' }}
          placeholder="搜索关键字"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        {/* 行内按键用 View 实现：Taro H5 的 Button 基础样式（满宽/行高）会干扰 flex 对齐 */}
        <View
          className="btn-primary"
          style={{ marginLeft: 12, width: 'auto', height: 76, lineHeight: '76px', padding: '0 24px', fontSize: 26, flexShrink: 0, boxSizing: 'border-box', borderRadius: 12 }}
          onClick={() => setApplied(input.trim())}
        >
          查询
        </View>
        {onAdd ? (
          <View
            className="btn-primary"
            style={{ marginLeft: 12, width: 'auto', height: 76, lineHeight: '76px', padding: '0 24px', fontSize: 26, flexShrink: 0, boxSizing: 'border-box', borderRadius: 12 }}
            onClick={onAdd}
          >
            {addLabel || '新增'}
          </View>
        ) : null}
      </View>
      {loaded && total > 0 && (
        <View className="muted" style={{ padding: '8px 24px 0', fontSize: 22 }}>
          共 {total} 条{total > 100 ? '，仅显示前 100 条' : ''}
        </View>
      )}
      {loaded && list.length === 0 && <View className="empty">暂无数据</View>}
      {headers && headers.length ? (
        /* 横向表格模式：顶部字段名行 + 每条记录一行单元格 */
        <View style={{ margin: '8px 24px 0', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
          <View style={{ display: 'flex', background: '#eef1f5', padding: '14px 0' }}>
            {headers.map((h, i) => (
              <Text key={h} style={{ flex: i === 0 ? 1.4 : 1, textAlign: 'center', fontSize: 24, color: '#5a6d85', fontWeight: 600 }}>
                {h}
              </Text>
            ))}
          </View>
          {list.map(it => (
            <View key={String(it.key)} style={{ display: 'flex', padding: '18px 0', borderTop: '1px solid #f0f2f5', alignItems: 'center' }}>
              {(it.row || []).map((c, i) => (
                <Text
                  key={i}
                  style={{ flex: i === 0 ? 1.4 : 1, textAlign: 'center', fontSize: 26, padding: '0 8px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                >
                  {c || '—'}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : (
        list.map(it => (
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
        ))
      )}
    </View>
  )
}

export default ListView
