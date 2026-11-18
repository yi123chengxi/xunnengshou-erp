import { useState, useEffect, useMemo } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getListPage, ListItem } from '../services/api'

const TONE_CLASS: Record<string, string> = {
  blue: 'tag-blue', green: 'tag-green', orange: 'tag-orange', red: 'tag-red', gray: 'tag-gray',
}

// 快速筛选范围（服务端 /wx/lists 按记录日期过滤并下发 sums 汇总行）
const QUICK_RANGES = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'month', label: '本月' },
]

/** 汇总行单元格取值：¥ 金额解析为数字，其余按数字解析 */
const moneyOf = (c: string | undefined): number => Number(String(c || '').replace(/[¥,]/g, '')) || 0

/**
 * 通用列表视图：服务端 /wx/lists/:page 按 Web 同页面口径映射后下发展示结构，
 * 用于补齐日常记账/生产订单/采购订单/新款进度/店铺/仓库统计/品牌/员工/客户等子菜单。
 * 搜索为「点击查询后才生效」的双态模式，减少大列表实时过滤开销。
 */
const ListView = ({
  page, extra = '', headers, addLabel, onAdd, tick = 0, quick = false,
}: { page: string; extra?: string; headers?: string[]; addLabel?: string; onAdd?: () => void; tick?: number; quick?: boolean }) => {
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [range, setRange] = useState('')
  const [list, setList] = useState<ListItem[]>([])
  const [total, setTotal] = useState(0)
  const [sums, setSums] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    const extraFull = [extra, range ? `range=${range}` : ''].filter(Boolean).join('&')
    getListPage(page, applied, extraFull)
      .then(d => { setList(d.list || []); setTotal(d.total || 0); setSums(d.sums || []) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [page, applied, extra, range, tick])

  // 汇总行：优先服务端 sums（部署后按筛选范围下发）；未部署时按当前列表行客户端兜底求和，保证汇总行始终可见
  const computedSums = useMemo(() => {
    if (!quick || !headers || !headers.length) return [] as string[]
    if (sums && sums.length) return sums
    return headers.map((h, i) => {
      if (h === '数量') return String(list.reduce((s, it) => s + (Number((it.row || [])[i]) || 0), 0))
      if (h.includes('工资')) {
        const t = list.reduce((s, it) => s + moneyOf((it.row || [])[i]), 0)
        return t > 0 ? `¥${t.toFixed(2)}` : '—'
      }
      return ''
    })
  }, [quick, headers, list, sums])

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
      {/* 计数+快速筛选行：靠左对齐；quick 页签恒显示，点击筛选后不隐藏 */}
      {(quick || (loaded && total > 0)) && (
        <View style={{ display: 'flex', alignItems: 'center', padding: '8px 24px 0' }}>
          <Text className="muted" style={{ fontSize: 22 }}>
            共 {total} 条{total > 100 ? '，仅显示前 100 条' : ''}
          </Text>
          {quick && QUICK_RANGES.map(r => (
            <View
              key={r.key}
              style={{
                marginLeft: 12, padding: '4px 18px', fontSize: 22, borderRadius: 8,
                background: range === r.key ? '#1677ff' : '#eef1f5',
                color: range === r.key ? '#fff' : '#5a6d85',
              }}
              onClick={() => setRange(range === r.key ? '' : r.key)}
            >
              {r.label}
            </View>
          ))}
        </View>
      )}
      {loaded && list.length === 0 && <View className="empty">暂无数据</View>}
      {headers && headers.length ? (
        /* 横向表格模式：顶部字段名行 + 每条记录一行单元格 */
        <View style={{ margin: '8px 24px 0', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
          {quick && computedSums.length > 0 && (
            /* 汇总行：与列对齐，置于表头上方，展示数量/工资合计 */
            <View style={{ display: 'flex', background: '#e6f4ff', padding: '10px 0' }}>
              {computedSums.map((c, i) => (
                <Text key={i} style={{ flex: i === 0 ? 1.4 : 1, textAlign: 'center', fontSize: 24, color: '#1677ff', fontWeight: 700 }}>
                  {c || ''}
                </Text>
              ))}
            </View>
          )}
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
