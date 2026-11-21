import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getInventory, getProductCost } from '../services/api'

// —— 行内样式常量（weapp 中类选择器会压过行内样式，故字号/颜色一律纯行内，不挂 .muted/.tag 类）——
// 本窗口按用户要求整体缩小字号：页头在 ModuleView 已 32→16；正文 50% 后低于可读下限的统一取 10px
const SEARCH_BAR = { display: 'flex', alignItems: 'center', padding: '8px 24px 0' } as const
const SEARCH_INPUT = { flex: 1, height: 28, background: '#ffffff', border: '1px solid #c9d4e3', borderRadius: 6, padding: '0 8px', fontSize: 10, boxSizing: 'border-box' } as const
const SEARCH_BTN = { marginLeft: 6, height: 28, lineHeight: '28px', padding: '0 10px', background: '#1677ff', color: '#ffffff', fontSize: 10, borderRadius: 6, textAlign: 'center', flexShrink: 0 } as const
const CARD = { background: '#fff', borderRadius: 10, padding: '8px 12px', margin: '8px 24px' } as const
const ROW = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as const
const MUTED = { color: '#8a94a6', fontSize: 10 } as const

interface CostLine { name: string; unit: string; price: number; qty: number; amount: number }
interface CostData { semi: CostLine[]; raw: CostLine[]; proc: CostLine[]; fees: CostLine[]; totalCost: number; hasBom: boolean }

// 库存查询内嵌视图：款号/简称/编码模糊搜索；点击卡片展开与 Web「物料明细」同口径的成本明细
const InventoryEmbed = ({ tick = 0, initialQ = '' }: { tick?: number; initialQ?: string }) => {
  const [q, setQ] = useState(initialQ)
  const [keyword, setKeyword] = useState(initialQ)
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [cost, setCost] = useState<Record<string, CostData | 'loading'>>({})

  useEffect(() => {
    setLoaded(false)
    getInventory(keyword)
      .then(d => { setList(d.list); setTotal(d.total) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [keyword, tick])

  // 点击卡片展开/收起成本明细；首次展开才拉取，之后缓存
  const toggleCost = (key: string) => {
    const open = !expanded[key]
    setExpanded(v => ({ ...v, [key]: open }))
    if (open && !cost[key]) {
      setCost(v => ({ ...v, [key]: 'loading' }))
      getProductCost(key)
        .then(d => setCost(v => ({ ...v, [key]: d })))
        .catch(() => setCost(v => ({ ...v, [key]: { semi: [], raw: [], proc: [], fees: [], totalCost: 0, hasBom: false } })))
    }
  }

  const CostSection = ({ title, color, lines }: { title: string; color: string; lines: CostLine[] }) => (
    lines.length === 0 ? null : (
      <View style={{ marginTop: 4 }}>
        <Text style={{ fontSize: 10, color, fontWeight: 600 }}>{title}（{lines.length}项）</Text>
        {lines.map((l, i) => (
          <View key={i} style={{ ...ROW, padding: '2px 0' }}>
            <Text style={{ fontSize: 10 }}>{l.name}{l.unit ? ` (${l.unit})` : ''}</Text>
            <Text style={{ fontSize: 10, color: '#5a6d85' }}>¥{l.price.toFixed(2)} × {l.qty} = ¥{l.amount.toFixed(2)}</Text>
          </View>
        ))}
      </View>
    )
  )

  return (
    <View>
      <View style={{ ...SEARCH_BAR }}>
        <Input
          style={{ ...SEARCH_INPUT }}
          placeholder="搜索款号 / 商品简称 / 编码"
          placeholderStyle="color:#b0bcca;font-size:10px"
          value={q}
          onInput={e => setQ(e.detail.value)}
          onConfirm={() => setKeyword(q.trim())}
          confirmType="search"
        />
        {/* 查询按键：输入后点击/回车才搜索 */}
        <View style={{ ...SEARCH_BTN }} onClick={() => setKeyword(q.trim())}>查询</View>
      </View>
      {loaded && <View style={{ ...MUTED, padding: '0 24px 4px' }}>共 {total} 条，显示前 {list.length} 条</View>}
      {loaded && list.length === 0 && <View style={{ ...MUTED, textAlign: 'center', padding: '24px 0' }}>暂无匹配商品</View>}
      {list.map((r: any) => {
        const key = String(r.key)
        const c = cost[key]
        return (
          <View key={key} style={{ ...CARD }} onClick={() => toggleCost(key)}>
            <View style={{ ...ROW }}>
              <Text style={{ fontSize: 11, fontWeight: 600 }}>{r.shortName || r.productCode || '—'}</Text>
              {r.productStatus ? (
                <Text style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: r.productStatus === '在售' ? '#f6ffed' : '#f0f0f0', color: r.productStatus === '在售' ? '#52c41a' : '#8c8c8c' }}>
                  {r.productStatus}
                </Text>
              ) : null}
            </View>
            <View style={{ ...ROW, marginTop: 2 }}>
              <Text style={{ ...MUTED }}>款号 {r.styleCode || '—'}　编码 {r.productCode || '—'}</Text>
            </View>
            <View style={{ ...ROW, marginTop: 2 }}>
              <Text style={{ ...MUTED }}>{r.productType || ''}{r.unit ? ` · 单位 ${r.unit}` : ''}</Text>
              {/* 实际库存：服务端 /wx/inventory 已改读 actualStock，恒为数字 */}
              <Text style={{ fontSize: 10, fontWeight: 600, color: (Number(r.stock) || 0) <= 0 ? '#f5222d' : '#1677ff' }}>库存 {Number(r.stock) || 0}</Text>
            </View>
            {expanded[key] ? (
              <View style={{ marginTop: 6, borderTop: '1px solid #eef1f5', paddingTop: 4 }} onClick={e => e.stopPropagation()}>
                {c === 'loading' ? (
                  <Text style={{ ...MUTED }}>成本明细加载中…</Text>
                ) : c && c.hasBom ? (
                  <View>
                    <CostSection title="半成品" color="#1677ff" lines={c.semi} />
                    <CostSection title="原材料" color="#52c41a" lines={c.raw} />
                    <CostSection title="工艺" color="#fa8c16" lines={c.proc} />
                    <CostSection title="生产费用" color="#722ed1" lines={c.fees} />
                    <View style={{ ...ROW, marginTop: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: 600, color: '#722ed1' }}>合计成本</Text>
                      <Text style={{ fontSize: 11, fontWeight: 600, color: '#722ed1' }}>¥{c.totalCost.toFixed(2)}</Text>
                    </View>
                  </View>
                ) : (
                  <Text style={{ ...MUTED }}>暂无成本明细</Text>
                )}
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

export default InventoryEmbed
