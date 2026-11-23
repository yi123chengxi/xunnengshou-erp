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

/** 本地日期串 YYYY-MM-DD（偏移天数） */
const localDay = (offset = 0): string => {
  const d = new Date(Date.now() + offset * 86400000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 通用列表视图：服务端 /wx/lists/:page 按 Web 同页面口径映射后下发展示结构，
 * 用于补齐日常记账/生产订单/采购订单/新款进度/店铺/仓库统计/品牌/员工/客户等子菜单。
 * 搜索为「点击查询后才生效」的双态模式，减少大列表实时过滤开销。
 */
const ListView = ({
  page, extra = '', headers, addLabel, onAdd, tick = 0, quick = false, quickDate, compact = false, onRowClick, padTop = 16, card = false, square = false, detail = false,
}: { page: string; extra?: string; headers?: string[]; addLabel?: string; onAdd?: () => void; tick?: number; quick?: boolean; quickDate?: 'first' | 'last'; compact?: boolean; onRowClick?: (it: ListItem) => void; padTop?: number; card?: boolean; square?: boolean; detail?: boolean }) => {
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [range, setRange] = useState('')
  const [list, setList] = useState<ListItem[]>([])
  const [total, setTotal] = useState(0)
  const [sums, setSums] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [detailItem, setDetailItem] = useState<ListItem | null>(null)

  useEffect(() => {
    setLoaded(false)
    const extraFull = [extra, range ? `range=${range}` : ''].filter(Boolean).join('&')
    getListPage(page, applied, extraFull)
      .then(d => {
        let list = d.list || []
        let total = d.total || 0
        const serverSums = d.sums || []
        // 服务端未部署 range/sums 时客户端兜底：按 sub 中日期位置过滤，汇总由 computedSums 客户端求和
        if (range && quickDate && !serverSums.length) {
          const today = localDay()
          const ym = today.slice(0, 7)
          list = list.filter(it => {
            // sub 经 filter(Boolean) 会位移，按日期正则定位（备货/急采取首个、配货取末个）
            const dates = (it.sub || []).filter(s => /^\d{4}-\d{2}-\d{2}/.test(String(s)))
            const ds = String(quickDate === 'first' ? dates[0] : dates[dates.length - 1] || '').slice(0, 10)
            if (range === 'today') return ds === today
            if (range === 'yesterday') return ds === localDay(-1)
            return ds.slice(0, 7) === ym
          })
          total = list.length
        }
        setList(list)
        setTotal(total)
        setSums(serverSums)
      })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [page, applied, extra, range, tick, quickDate])

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
      {/* 搜索行上间距可由调用方收紧（仓库统计工资汇总页上方已有「统计月份」行，须与其贴紧） */}
      <View style={{ display: 'flex', padding: `${padTop}px 24px 0`, alignItems: 'center' }}>
        {/* 输入框同样不挂 .input 类（类里 font-size:28/padding:18 会压过行内值导致比按键高） */}
        <Input
          style={{ flex: 1, marginBottom: 0, height: 36, lineHeight: '36px', fontSize: 17, padding: '0 11px', background: '#fff', border: '1px solid #c9d1da', borderRadius: square ? 0 : 8, boxSizing: 'border-box' }}
          placeholderStyle="color:#9aa3ad;font-size:17px"
          placeholder="搜索关键字"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        {/* 行内按键：纯行内样式不带 btn-primary 类（类里 84px 行高/30px 字会压过行内覆盖导致按键过大） */}
        <View
          style={{ marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', fontSize: 15, color: '#fff', background: '#1677ff', borderRadius: square ? 0 : 8, flexShrink: 0, boxSizing: 'border-box' }}
          onClick={() => setApplied(input.trim())}
        >
          查询
        </View>
        {onAdd ? (
          <View
            style={{ marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', fontSize: 15, color: '#fff', background: '#1677ff', borderRadius: square ? 0 : 8, flexShrink: 0, boxSizing: 'border-box' }}
            onClick={onAdd}
          >
            {addLabel || '新增'}
          </View>
        ) : null}
      </View>
      {/* 计数+快速筛选同行：quick 页签强制单行（nowrap）且各元素可收缩，装不下时自动缩窄 */}
      {(quick || (loaded && total > 0)) && (
        <View style={{ display: 'flex', alignItems: 'center', flexWrap: quick ? 'nowrap' : 'wrap', padding: '8px 24px 0' }}>
          <Text
            className="muted"
            style={{
              fontSize: quick ? 13 : (compact ? 11 : 22),
              minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: quick ? 1 : 0,
            }}
          >
            共 {total} 条，显示前 {list.length} 条
          </Text>
          {quick && QUICK_RANGES.map(r => (
            <View
              key={r.key}
              style={{
                // 快捷筛选按键按真实 px 定档：13px 字 + 2/9px 内边距，可收缩以免换行
                marginLeft: 6, padding: '2px 9px', fontSize: 13, borderRadius: 6, lineHeight: '18px',
                flexShrink: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
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
      {headers && headers.length && !card ? (
        /* 横向表格模式：顶部字段名行 + 每条记录一行单元格
           行内 style 数字按真实 px 渲染，故表头 13px、单元格 15px（≈26/30rpx）才是舒适密度；
           列边线按项目表格规范逐格 borderLeft，首列不带，外框整圈灰线 */
        <View style={{ margin: '8px 24px 0', background: '#fff', borderRadius: square ? 0 : 8, overflow: 'hidden', border: '1px solid #e6e9ee' }}>
          <View style={{ display: 'flex', background: '#f2f4f7' }}>
            {headers.map((h, i) => (
              <View
                key={h}
                style={{ flex: i === 0 ? 1.4 : 1, padding: '7px 4px', borderLeft: i === 0 ? 'none' : '1px solid #e6e9ee', boxSizing: 'border-box', minWidth: 0 }}
              >
                <Text style={{ display: 'block', textAlign: 'center', fontSize: 13, color: '#5a6d85', fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {h}
                </Text>
              </View>
            ))}
          </View>
          {/* 汇总行：紧跟表头下方、数据行上方，数值对齐所属列；字号跟随单元格 15px */}
          {quick && computedSums.length > 0 && (
            <View style={{ display: 'flex', borderTop: '1px solid #e6e9ee', background: '#fafbfc' }}>
              {headers.map((h, i) => (
                <View
                  key={`sum-${h}`}
                  style={{ flex: i === 0 ? 1.4 : 1, padding: '6px 4px', borderLeft: i === 0 ? 'none' : '1px solid #e6e9ee', boxSizing: 'border-box', minWidth: 0 }}
                >
                  <Text
                    style={{
                      display: 'block', textAlign: 'center', fontSize: 15, fontWeight: 700,
                      color: i === 0 ? '#5a6d85' : String(computedSums[i] || '').includes('¥') ? '#ff4d4f' : '#1f2733',
                      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    }}
                  >
                    {i === 0 ? '合计' : (computedSums[i] || '—')}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {list.map(it => (
            /* 单元格按 headers 个数对齐渲染（行数据短于表头时补空），保证列边线上下对齐 */
            <View
              key={String(it.key)}
              style={{ display: 'flex', borderTop: '1px solid #e6e9ee', alignItems: 'stretch' }}
              onClick={onRowClick ? () => onRowClick(it) : (detail && (it.fields || []).length ? () => setDetailItem(it) : undefined)}
            >
              {headers.map((_, i) => (
                <View
                  key={i}
                  style={{ flex: i === 0 ? 1.4 : 1, padding: '9px 4px', borderLeft: i === 0 ? 'none' : '1px solid #e6e9ee', boxSizing: 'border-box', minWidth: 0 }}
                >
                  <Text style={{ display: 'block', textAlign: 'center', fontSize: 15, color: '#1f2733', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {(it.row || [])[i] || '—'}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
        list.map(it => (
        <View
          key={String(it.key)}
          className="card"
          style={{ ...(compact ? { padding: '12px 20px' } : {}), ...(square ? { borderRadius: 0 } : {}), ...(it.cardBg ? { background: it.cardBg } : {}) }}
          onClick={onRowClick ? () => onRowClick(it) : (detail && (it.fields || []).length ? () => setDetailItem(it) : undefined)}
        >
          {/* compact：标题与金额同行，副信息合成一行点分隔，降低单条高度 */}
          <View style={{ display: 'flex', alignItems: 'center' }}>
            <Text style={{ fontWeight: 600, fontSize: compact ? 12 : undefined, flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {it.title}
            </Text>
            {compact && typeof it.amount === 'number' && it.amount !== 0 ? (
              <Text style={{ marginLeft: 12, flexShrink: 0, fontWeight: 700, fontSize: 12, color: it.amount >= 0 ? '#52c41a' : '#ff4d4f' }}>
                {it.amount >= 0 ? '+' : '-'}¥{Math.abs(it.amount).toFixed(2)}
              </Text>
            ) : null}
            {it.tag ? <Text className={`tag ${TONE_CLASS[it.tone || 'blue'] || 'tag-blue'}`} style={{ marginLeft: 12, flexShrink: 0, ...(it.tagStyle || {}) }}>{it.tag}</Text> : null}
          </View>
          {/* card 模式（参考订单查询页）：把 headers 与 row 配对成「列名 值」行，首列与标题重复故跳过 */}
          {card && headers && headers.length && (it.row || []).length ? (
            <View style={{ paddingTop: 4 }}>
              {headers.map((h, i) => (i === 0 || !(it.row || [])[i] ? null : (
                <View key={h} className="muted" style={{ paddingTop: 2, fontSize: 24 }}>{h} {(it.row || [])[i]}</View>
              )))}
            </View>
          ) : null}
          {compact ? (
            (it.sub && it.sub.length > 0) ? (
              <View className="muted" style={{ paddingTop: 4, fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {it.sub.join(' · ')}
              </View>
            ) : null
          ) : (
            (it.sub || []).map((s, i) => (
              i === 0 && it.subRight ? (
                /* 首行左右分栏：左主副信息可收缩省略，右靠右对齐内容（如生产订单创建日期），字号同行跟随 subSizes */
                <View key={i} style={{ display: 'flex', alignItems: 'center', paddingTop: 4 }}>
                  <Text className="muted" style={{ flex: 1, minWidth: 0, fontSize: (it.subSizes || [])[i] || 24, color: (it.subColors || [])[i] || undefined, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{s}</Text>
                  <Text className="muted" style={{ flexShrink: 0, marginLeft: 8, fontSize: (it.subSizes || [])[i] || 24 }}>{it.subRight}</Text>
                </View>
              ) : (
                <View key={i} className="muted" style={{ paddingTop: 4, fontSize: (it.subSizes || [])[i] || 24, color: (it.subColors || [])[i] || undefined }}>{s}</View>
              )
            ))
          )}
          {!compact && typeof it.amount === 'number' && it.amount !== 0 ? (
            <View style={{ paddingTop: 8, fontWeight: 700, fontSize: 30, color: it.amount >= 0 ? '#52c41a' : '#ff4d4f' }}>
              {it.amount >= 0 ? '+' : '-'}¥{Math.abs(it.amount).toFixed(2)}
            </View>
          ) : null}
        </View>
        ))
      )}
      {/* 详情弹层：detail 模式点击行展示服务端下发的 fields（label/值） */}
      {detailItem && (
        <View>
          <View style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} onClick={() => setDetailItem(null)} />
          <View style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', padding: '16px 20px 28px', zIndex: 1001, maxHeight: '70%', boxSizing: 'border-box', overflowY: 'scroll' }}>
            <View style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>{detailItem.title}</Text>
              <Text style={{ fontSize: 18, color: '#86909c' }} onClick={() => setDetailItem(null)}>×</Text>
            </View>
            {(detailItem.fields || []).map(([label, value]) => (
              <View key={label} style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' }}>
                <Text style={{ flexShrink: 0, width: 80, fontSize: 13, color: '#86909c' }}>{label}</Text>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', wordBreak: 'break-all' }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

export default ListView
