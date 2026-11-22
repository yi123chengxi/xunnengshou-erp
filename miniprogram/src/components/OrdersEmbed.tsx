import { useState, useEffect } from 'react'
import { View, Text, Input, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getOrders } from '../services/api'

// 货品明细字段显示控制：可选字段清单与默认勾选（对齐 Web 端订单管理货品明细弹窗，默认 商品编码/数量/单价/成交金额）
const ITEM_FIELDS: { key: string; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'productCode', label: '商品编码' },
  { key: 'shortName', label: '商品简称' },
  { key: 'styleCode', label: '款式编码' },
  { key: 'color', label: '颜色' },
  { key: 'spec', label: '规格' },
  { key: 'quantity', label: '数量' },
  { key: 'price', label: '单价' },
  { key: 'amount', label: '成交金额' },
]
const ITEM_FIELDS_DEFAULT = ['productCode', 'quantity', 'price', 'amount']
const ITEM_FIELD_KEYS = ITEM_FIELDS.map(f => f.key)
// 各列伸展权重；图片列为固定宽（不伸展）
const ITEM_COL_FLEX: Record<string, number> = {
  productCode: 1.6, shortName: 1.1, styleCode: 1.2, color: 0.8, spec: 0.8, quantity: 0.7, price: 0.8, amount: 1.1,
}
const ITEM_COL_ALIGN: Record<string, string> = { quantity: 'right', price: 'right', amount: 'right' }

// 订单状态色标：逐条照抄 Web 端 orderStatusColors，并补上审核流转派生标签的实心底色
// （Web 的「订单状态」列文案由 auditStatus 派生，服务端 /wx/orders 已同口径下发，两端必须同色）
const STATUS_COLORS: Record<string, string> = {
  '待付款': '#fa8c16', '部分付款': '#fa8c16', '待处理': '#fa8c16', '待确认': '#fa8c16', '生产完成待收款': '#fa8c16',
  '待发货': '#faad14', '待打单': '#faad14', '待拣货': '#faad14',
  '已付款': '#1677ff', '待财务审核': '#1677ff', '进行中': '#1677ff', '已拆分': '#1677ff', '生产排期': '#1677ff',
  '已发货': '#52c41a', '已完成': '#52c41a', '已入库': '#52c41a', '已出库': '#52c41a', '已财务审核': '#52c41a',
  '已审核': '#52c41a', '已审核待发货': '#52c41a', '已审核待生产': '#52c41a', '已打单': '#52c41a', '已拣货': '#52c41a',
  '已审核待财审': '#722ed1',
  '已取消': '#8c8c8c', '已合并': '#8c8c8c',
  '已驳回': '#ff4d4f', '驳回': '#ff4d4f', '已拒绝': '#ff4d4f', '缺货': '#ff4d4f',
  '异常': '#a08050',
}
const statusColorOf = (s: string): string => STATUS_COLORS[s] || '#5a6d85'

// 明细字段勾选持久化：读取失败或为空时回默认四列
const loadItemFields = (): string[] => {
  try {
    const saved = Taro.getStorageSync('wx_order_items_fields')
    if (Array.isArray(saved) && saved.length > 0) return saved.filter((k: string) => ITEM_FIELD_KEYS.includes(k))
  } catch { /* ignore */ }
  return ITEM_FIELDS_DEFAULT
}

const fmtMoney = (v: any): string => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })

// —— 行内样式常量（weapp 中类选择器会压过行内样式，精细控件统一纯行内）——
const SEARCH_BAR = { display: 'flex', alignItems: 'center', padding: '16px 24px 0' } as const
const SEARCH_INPUT = { flex: 1, height: 36, background: '#ffffff', border: '1px solid #c9d4e3', borderRadius: 0, padding: '0 12px', fontSize: 15, boxSizing: 'border-box' } as const
const SEARCH_BTN = { marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', background: '#1677ff', color: '#ffffff', fontSize: 15, borderRadius: 0, textAlign: 'center', flexShrink: 0 } as const
const COUNT_LINE = { padding: '0 24px 8px', fontSize: 12, color: '#86909c' } as const
// 订单状态快速筛选芯片（空串=全部）；取值与服务端 /wx/orders 派生状态文案一致
const STATUS_CHIPS = ['', '待付款', '已审核待发货', '已发货', '已完成', '已取消'] as const
const CHIP_ROW = { whiteSpace: 'nowrap', padding: '8px 24px 0' } as const
const CHIP = { display: 'inline-block', marginRight: 8, padding: '2px 12px', fontSize: 13, lineHeight: '20px', borderRadius: 12, background: '#eef1f5', color: '#5a6d85' } as const
const CHIP_ON = { background: '#1677ff', color: '#ffffff' } as const
const CARD = { background: '#ffffff', borderRadius: 0, margin: '12px 24px 0', padding: '12px 16px', boxShadow: '0 1px 4px rgba(31,39,51,0.04)' } as const
const ROW = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, overflow: 'hidden' } as const
const STYLE_LINE = { flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: '#1f2733' } as const
const AMT = { flexShrink: 0, marginLeft: 8, fontSize: 15, fontWeight: 600, color: '#e5533c' } as const
const SUB = { fontSize: 13, color: '#5a6d85', overflow: 'hidden' } as const
const DATE = { flexShrink: 0, marginLeft: 8, fontSize: 12, color: '#86909c' } as const
const STATUS_TAG = { flexShrink: 0, padding: '2px 10px', borderRadius: 10, fontSize: 12, lineHeight: '18px', color: '#ffffff' } as const
const MASK = { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 } as const
const SHEET = { position: 'fixed', left: 0, right: 0, bottom: 0, background: '#f7f9fb', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '0 20px 28px', zIndex: 1001, maxHeight: '78%', boxSizing: 'border-box', overflowY: 'scroll' } as const
const SHEET_HEAD = { display: 'flex', alignItems: 'center', paddingTop: 16 } as const
const SHEET_TITLE = { flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: '#1f2733', overflow: 'hidden' } as const
const FIELD_BTN = { flexShrink: 0, marginLeft: 10, padding: '4px 12px', borderRadius: 14, border: '1px solid #c9d4e3', background: '#ffffff', fontSize: 13, color: '#1677ff', lineHeight: '18px' } as const
const CLOSE_X = { flexShrink: 0, marginLeft: 12, fontSize: 20, color: '#86909c', lineHeight: '22px' } as const
const INFO_BLOCK = { marginTop: 12, background: '#ffffff', borderRadius: 10, padding: '4px 12px', overflow: 'hidden' } as const
const INFO_ROW = { display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' } as const
const INFO_LBL = { flexShrink: 0, width: 66, fontSize: 13, color: '#86909c', lineHeight: '19px' } as const
const INFO_VAL = { flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', lineHeight: '19px', wordBreak: 'break-all' } as const
const SEC_TITLE = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' } as const
const SEC_TXT = { fontSize: 14, fontWeight: 600, color: '#1f2733' } as const
const TABLE_BOX = { background: '#ffffff', borderRadius: 10, overflow: 'hidden' } as const
const T_HEAD = { display: 'flex', alignItems: 'center', background: '#f2f5f9', padding: '7px 10px' } as const
const T_ROW = { display: 'flex', alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid #f2f4f7' } as const
const TH = { fontSize: 12, fontWeight: 600, color: '#5a6d85' } as const
const TD = { fontSize: 12, color: '#1f2733', overflow: 'hidden' } as const
const IMG_CELL = { width: 40, height: 40, borderRadius: 4, background: '#eef2f6', flexShrink: 0 } as const
const EMPTY_ITEMS = { padding: '18px 0', textAlign: 'center', fontSize: 13, color: '#86909c' } as const
const PICKER_MASK = { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.25)', zIndex: 1100 } as const
const PICKER = { position: 'fixed', left: 0, right: 0, bottom: 0, background: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '16px 20px 28px', zIndex: 1101 } as const
const PICK_ROW = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 42, borderBottom: '1px solid #f2f4f7' } as const
const PICK_LBL = { fontSize: 15, color: '#1f2733' } as const
const PICK_CHK_ON = { fontSize: 15, color: '#1677ff', fontWeight: 600 } as const
const PICK_CHK_OFF = { fontSize: 15, color: '#c9d4e3' } as const
const LOG_BOX = { background: '#ffffff', borderRadius: 10, padding: '2px 12px' } as const
const LOG_ROW = { padding: '8px 0', borderBottom: '1px solid #f2f4f7' } as const
const LOG_HEAD = { display: 'flex', alignItems: 'center' } as const
const LOG_ACTION = { fontSize: 13, fontWeight: 600, color: '#1677ff', flexShrink: 0 } as const
const LOG_TIME = { fontSize: 12, color: '#86909c', marginLeft: 8, flexShrink: 0 } as const
const LOG_OP = { fontSize: 12, color: '#5a6d85', marginLeft: 8, overflow: 'hidden' } as const
const LOG_DETAIL = { display: 'block', fontSize: 12, color: '#5a6d85', marginTop: 2, lineHeight: '18px' } as const

// 订单查询内嵌视图：输入后点「查询」再搜索；卡片显示款式x数量/商品总额/订单状态/收件人；点卡片看详情（货品明细+字段显示控制）
const OrdersEmbed = ({ tick = 0 }: { tick?: number }) => {
  const [q, setQ] = useState('')
  const [keyword, setKeyword] = useState('')
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [fields, setFields] = useState<string[]>(() => loadItemFields())
  const [fieldPicker, setFieldPicker] = useState(false)

  useEffect(() => {
    setLoaded(false)
    getOrders(keyword, statusFilter)
      .then(d => { setList(d.list); setTotal(d.total) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [keyword, statusFilter, tick])

  const doSearch = () => setKeyword(q.trim())

  // 勾选切换：至少保留一个字段；勾选结果立即持久化
  const toggleField = (k: string) => {
    setFields(prev => {
      const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]
      if (next.length === 0) { Taro.showToast({ title: '至少保留一个字段', icon: 'none' }); return prev }
      try { Taro.setStorageSync('wx_order_items_fields', next) } catch { /* ignore */ }
      return next
    })
  }

  // 款式编码前缀提取（对齐 Web 端 ScheduleBoard 口径：剥掉「-颜色-规格」后缀，6851-黑色-35 → 6851）
  const stylePrefixOf = (raw: any): string => {
    const s = String(raw || '')
    const m = s.match(/^[^-]+(?:-[^-]+)*?(?=\s*-\s*[\u4e00-\u9fff])/)
    if (m) return m[0]
    const numOnly = s.match(/^\d+/)
    return numOnly ? numOnly[0] : s
  }

  // 第一行：按款式编码聚合数量（款式编码x汇总数量，多款式依次拼接并追加总数）
  const styleLineOf = (r: any): string => {
    const items: any[] = Array.isArray(r.items) ? r.items : []
    if (items.length === 0) return ''
    const byStyle = new Map<string, number>()
    items.forEach((it: any) => {
      const k = stylePrefixOf(it.styleCode || it.productCode) || '—'
      byStyle.set(k, (byStyle.get(k) || 0) + (Number(it.quantity) || 0))
    })
    const parts = Array.from(byStyle.entries()).map(([k, n]) => `${k}x${n}`)
    return parts.join(' ') + (byStyle.size > 1 ? ` 共${r.totalQty}` : '')
  }

  // 明细行单元格：图片列固定宽，其余按权重伸展、按字段配置对齐
  const colStyleOf = (f: string) => (f === 'image'
    ? { ...IMG_CELL, marginLeft: 0 }
    : { flex: ITEM_COL_FLEX[f] || 1, minWidth: 0, textAlign: (ITEM_COL_ALIGN[f] || 'left') as any })

  const renderCell = (it: any, f: string) => {
    if (f === 'image') {
      const src = String(it.image || '')
      return src.startsWith('http')
        ? <Image src={src} mode="aspectFill" style={{ ...IMG_CELL }} />
        : <View style={{ ...IMG_CELL }} />
    }
    const v = String((it as any)[f] ?? '')
    return <Text style={{ ...TD, textAlign: (ITEM_COL_ALIGN[f] || 'left') as any }} numberOfLines={1}>{f === 'price' || f === 'amount' ? (v ? fmtMoney(v) : '—') : (v || '—')}</Text>
  }

  const activeFields = ITEM_FIELDS.filter(f => fields.includes(f.key))
  const detailItems: any[] = Array.isArray(detail?.items) ? detail.items : []
  const detailLogs: any[] = Array.isArray(detail?.logs) ? detail.logs : []
  // 状态筛选客户端兑底：服务端 status 参数未部署时线上会忽略它返回全量，
  // 这里按已下发的派生状态 orderStatus 再过滤一次（部署后与服务端过滤叠加仍幂等）
  const shown = statusFilter ? list.filter((r: any) => String(r.orderStatus || '') === statusFilter) : list

  return (
    <View>
      <View style={{ ...SEARCH_BAR }}>
        <Input
          style={{ ...SEARCH_INPUT }}
          placeholder="搜索订单号 / 客户 / 款式编码"
          placeholderStyle="color:#b0bcca"
          value={q}
          onInput={e => setQ(e.detail.value)}
          onConfirm={doSearch}
          confirmType="search"
        />
        <View style={{ ...SEARCH_BTN }} onClick={doSearch}>查询</View>
      </View>
      {/* 订单状态快速筛选：点芯片即按派生状态服务端过滤 */}
      <ScrollView scrollX style={{ ...CHIP_ROW }}>
        {STATUS_CHIPS.map(s => (
          <Text key={s || 'all'} style={{ ...CHIP, ...(statusFilter === s ? CHIP_ON : {}) }} onClick={() => setStatusFilter(s)}>
            {s || '全部'}
          </Text>
        ))}
      </ScrollView>
      {loaded && <View style={{ ...COUNT_LINE }}>共 {statusFilter ? shown.length : total} 条，显示前 {shown.length} 条</View>}
      {loaded && shown.length === 0 && <View className="empty">暂无匹配订单</View>}
      {shown.map((r: any) => (
        <View key={String(r.key)} style={{ ...CARD }} onClick={() => setDetail(r)}>
          {/* 行1：订单编号（与原款式行位置互换）+ 金额 */}
          <View style={{ ...ROW }}>
            <Text style={{ ...STYLE_LINE }} numberOfLines={1}>{r.orderNo || '—'}</Text>
            <Text style={{ ...AMT }}>¥{fmtMoney(r.productAmount)}</Text>
          </View>
          {/* 行2：款式编码×数量 + 收件人（与原客户名称位置互换）+ 日期 */}
          <View style={{ ...ROW }}>
            <Text style={{ ...SUB, flex: 1, minWidth: 0 }} numberOfLines={1}>{styleLineOf(r) || '—'}{r.receiverName ? `　收件人 ${r.receiverName}` : ''}</Text>
            <Text style={{ ...DATE }}>{String(r.createTime || '').slice(0, 10)}</Text>
          </View>
          {/* 行3：客户名称（与原收件人位置互换）+ 状态标签 */}
          <View style={{ ...ROW }}>
            <Text style={{ ...SUB, flex: 1, minWidth: 0 }} numberOfLines={1}>{r.customerName || '—'}</Text>
            {r.orderStatus ? <Text style={{ ...STATUS_TAG, background: statusColorOf(String(r.orderStatus)) }}>{r.orderStatus}</Text> : null}
          </View>
        </View>
      ))}

      {/* 订单详情底部弹层：订单信息 + 货品明细（字段显示控制） */}
      {detail && (
        <View>
          <View style={{ ...MASK }} onClick={() => setDetail(null)} />
          <View style={{ ...SHEET }}>
            <View style={{ ...SHEET_HEAD }}>
              <Text style={{ ...SHEET_TITLE }} numberOfLines={1}>{detail.orderNo || '订单详情'}</Text>
              <View style={{ ...FIELD_BTN }} onClick={() => setFieldPicker(true)}>字段</View>
              <Text style={{ ...CLOSE_X }} onClick={() => setDetail(null)}>×</Text>
            </View>

            <View style={{ ...INFO_BLOCK }}>
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>订单状态</Text>
                <Text style={{ ...INFO_VAL, color: statusColorOf(String(detail.orderStatus || '')), fontWeight: 600 }}>{detail.orderStatus || '—'}</Text>
              </View>
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>客户</Text>
                <Text style={{ ...INFO_VAL }}>{detail.customerName || '—'}</Text>
              </View>
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>收件人</Text>
                <Text style={{ ...INFO_VAL }}>{detail.receiverName || '—'}{detail.receiverPhone ? ` ${detail.receiverPhone}` : ''}</Text>
              </View>
              {detail.receiverAddress ? (
                <View style={{ ...INFO_ROW }}>
                  <Text style={{ ...INFO_LBL }}>收货地址</Text>
                  <Text style={{ ...INFO_VAL }}>{detail.receiverAddress}</Text>
                </View>
              ) : null}
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>下单时间</Text>
                <Text style={{ ...INFO_VAL }}>{detail.createTime || '—'}</Text>
              </View>
              <View style={{ ...INFO_ROW, borderBottom: 'none' }}>
                <Text style={{ ...INFO_LBL }}>商品总额</Text>
                <Text style={{ ...INFO_VAL, color: '#e5533c', fontWeight: 600 }}>¥{fmtMoney(detail.productAmount)}</Text>
              </View>
            </View>

            <View style={{ ...SEC_TITLE }}>
              <Text style={{ ...SEC_TXT }}>货品明细（{detailItems.length}）</Text>
            </View>
            {detailItems.length === 0 ? (
              <View style={{ ...TABLE_BOX }}><View style={{ ...EMPTY_ITEMS }}>暂无货品明细</View></View>
            ) : (
              <View style={{ ...TABLE_BOX }}>
                <View style={{ ...T_HEAD }}>
                  {activeFields.map(f => (
                    <View key={f.key} style={{ ...colStyleOf(f.key), display: 'flex' }}>
                      <Text style={{ ...TH, textAlign: (ITEM_COL_ALIGN[f.key] || 'left') as any }}>{f.label}</Text>
                    </View>
                  ))}
                </View>
                {detailItems.map((it: any, idx: number) => (
                  <View key={idx} style={{ ...T_ROW }}>
                    {activeFields.map(f => (
                      <View key={f.key} style={{ ...colStyleOf(f.key) }}>{renderCell(it, f.key)}</View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {/* 订单日志：与 Web 端订单管理详情同源（orderLog 时间线，按发生顺序正序展示） */}
            <View style={{ ...SEC_TITLE }}>
              <Text style={{ ...SEC_TXT }}>订单日志</Text>
            </View>
            <View style={{ ...LOG_BOX }}>
              {detailLogs.length === 0 ? (
                <View style={{ ...EMPTY_ITEMS }}>暂无操作记录</View>
              ) : (
                detailLogs.map((lg: any, i: number) => (
                  <View key={i} style={{ ...LOG_ROW, borderBottom: i === detailLogs.length - 1 ? 'none' : '1px solid #f2f4f7' }}>
                    <View style={{ ...LOG_HEAD }}>
                      <Text style={{ ...LOG_ACTION }}>{lg.action || '—'}</Text>
                      {!!lg.time && <Text style={{ ...LOG_TIME }}>{lg.time}</Text>}
                      {!!lg.operator && <Text style={{ ...LOG_OP }} numberOfLines={1}>{lg.operator}</Text>}
                    </View>
                    {!!lg.detail && <Text style={{ ...LOG_DETAIL }}>{lg.detail}</Text>}
                  </View>
                ))
              )}
            </View>
          </View>
        </View>
      )}

      {/* 明细字段显示控制弹层：勾选字段立即生效并持久化 */}
      {fieldPicker && (
        <View>
          <View style={{ ...PICKER_MASK }} onClick={() => setFieldPicker(false)} />
          <View style={{ ...PICKER }}>
            <View style={{ ...PICK_ROW, borderBottom: 'none', height: 36 }}>
              <Text style={{ fontSize: 16, fontWeight: 600, color: '#1f2733' }}>显示字段</Text>
              <Text style={{ fontSize: 14, color: '#86909c' }} onClick={() => setFieldPicker(false)}>完成</Text>
            </View>
            {ITEM_FIELDS.map(f => (
              <View key={f.key} style={{ ...PICK_ROW }} onClick={() => toggleField(f.key)}>
                <Text style={{ ...PICK_LBL }}>{f.label}</Text>
                <Text style={fields.includes(f.key) ? { ...PICK_CHK_ON } : { ...PICK_CHK_OFF }}>{fields.includes(f.key) ? '✓' : '○'}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

export default OrdersEmbed
