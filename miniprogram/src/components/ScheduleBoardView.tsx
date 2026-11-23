import { useState, useEffect } from 'react'
import { View, Text, Picker, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getScheduleBoard, postSchedule, putSchedule, ScheduleBoardData, ScheduleOrderItem, ScheduleRec } from '../services/api'
import { fullImageUrl } from '../utils/imageUrl'

// 班次与默认生产线（与 Web ScheduleBoard 同口径）
const SHIFTS = [
  { key: 'morning', label: '上午', range: '08:00-12:00' },
  { key: 'afternoon', label: '下午', range: '13:00-17:00' },
  { key: 'evening', label: '晚上', range: '18:00-22:00' },
]
const DEFAULT_LINES = ['生产线1', '生产线2', '生产线3']

const fmtDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const shiftDate = (date: string, off: number) => fmtDay(new Date(new Date(`${date}T00:00:00`).getTime() + off * 86400000))

// 日期行/网格字号按用户要求整体缩小 50%（行内数字为真实 px）
const chip = { marginLeft: 6, padding: '2px 9px', fontSize: 11, borderRadius: 6, background: '#eef1f5', color: '#5a6d85' }

/**
 * 生产排期：与 Web ScheduleBoard 同构的移动版看板——
 * 生产线 × 上午/下午/晚上 格子矩阵恒渲染（无排期也显示空网格）；
 * 待排产订单区筛 pending>0；下方「生产订单」为全量列表（含已排产），卡片格式与待排产区一致，
 * 支持关键词搜索。点击卡片弹出详情 + 排期记录（可逐条修改）+ 新增排期表单，
 * 新增走 POST /wx/schedule、修改走 PUT /wx/schedule/:key，与 Web 拖拽落库同源。
 */
const ScheduleBoardView = ({ tick = 0 }: { tick?: number }) => {
  const [date, setDate] = useState(fmtDay(new Date()))
  const [data, setData] = useState<ScheduleBoardData | null>(null)
  const [kw, setKw] = useState('')
  // 详情+排期弹层：active 为当前订单
  const [active, setActive] = useState<ScheduleOrderItem | null>(null)
  // 新增排期表单
  const [formDate, setFormDate] = useState(date)
  const [lineIdx, setLineIdx] = useState(0)
  const [shiftIdx, setShiftIdx] = useState(0)
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)
  // 修改排期：editKey 标记正在编辑的记录，四项为该记录的编辑态
  const [editKey, setEditKey] = useState('')
  const [efDate, setEfDate] = useState(date)
  const [efLineIdx, setEfLineIdx] = useState(0)
  const [efShiftIdx, setEfShiftIdx] = useState(0)
  const [efQty, setEfQty] = useState('')

  const load = () => getScheduleBoard(date)
    .then(d => { setData(d || null); return d })
    .catch(e => { Taro.showToast({ title: e.message, icon: 'none' }); return null })
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, tick])

  const lines = data?.lines?.length ? data.lines : DEFAULT_LINES
  const shifts = data?.shifts?.length ? data.shifts : SHIFTS
  const cells = data?.cells || {}
  const orders = data?.orders || []
  const pendingOrders = orders.filter(o => (o.pending || 0) > 0)
  // 下方全量列表：按单号/产品名/模具/款式关键词过滤（含已排产订单）
  const k = kw.trim().toLowerCase()
  const listedOrders = k
    ? orders.filter(o => [o.id, o.productName, o.moldCode, o.styleQty].some(v => String(v || '').toLowerCase().includes(k)))
    : orders

  // 数据刷新后同步 active（使弹层内的排期记录、待排量随最新数据更新）
  const syncActive = (d: ScheduleBoardData | null, id: string) => {
    const found = (d?.orders || []).find(o => o.id === id) || null
    setActive(found)
    setEditKey('')
  }

  const openOrder = (o: ScheduleOrderItem) => {
    setActive(o)
    setFormDate(date)
    setLineIdx(0)
    setShiftIdx(0)
    setQty(String(o.pending || ''))
    setEditKey('')
  }
  const submit = () => {
    if (!active || saving) return
    const q = Number(qty)
    if (!(q > 0)) { Taro.showToast({ title: '排期数量需大于 0', icon: 'none' }); return }
    setSaving(true)
    postSchedule({ productionOrderId: active.id, date: formDate, line: lines[lineIdx], shift: shifts[shiftIdx].key, qty: q })
      .then(() => Taro.showToast({ title: '排期成功', icon: 'success' }))
      .then(() => load())
      .then(d => syncActive(d, active.id))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setSaving(false))
  }
  const startEdit = (rec: ScheduleRec) => {
    setEditKey(rec.key)
    setEfDate(rec.startDate || date)
    const li = lines.indexOf(rec.line); setEfLineIdx(li >= 0 ? li : 0)
    const si = shifts.findIndex(s => s.key === rec.shift); setEfShiftIdx(si >= 0 ? si : 0)
    setEfQty(String(rec.planQty || ''))
  }
  const submitEdit = () => {
    if (!active || saving || !editKey) return
    const q = Number(efQty)
    if (!(q > 0)) { Taro.showToast({ title: '排期数量需大于 0', icon: 'none' }); return }
    setSaving(true)
    putSchedule(editKey, { date: efDate, line: lines[efLineIdx], shift: shifts[efShiftIdx].key, qty: q })
      .then(() => Taro.showToast({ title: '修改成功', icon: 'success' }))
      .then(() => load())
      .then(d => syncActive(d, active.id))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setSaving(false))
  }

  const shiftLabel = (key: string) => (shifts.find(s => s.key === key)?.label || key)

  // 订单卡片：待排产区与下方全量列表共用；右上角显示排产状态 tag（已排产蓝 / 待排产橙）
  const renderCard = (o: ScheduleOrderItem) => {
    const done = o.statusText === '已排产'
    return (
      <View key={o.id} style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', marginTop: 8 }} onClick={() => openOrder(o)}>
        <View style={{ display: 'flex', alignItems: 'center' }}>
          <Text style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: '#1677ff' }}>{o.id}</Text>
          <Text style={{
            flexShrink: 0, fontSize: 11, borderRadius: 4, padding: '1px 8px', marginLeft: 8,
            color: done ? '#1677ff' : '#fa8c16',
            border: `1px solid ${done ? '#91caff' : '#ffd591'}`,
            background: done ? '#e6f4ff' : '#fff7e6',
          }}>{o.statusText || (done ? '已排产' : '待排产')}</Text>
        </View>
        <Text style={{ display: 'block', fontSize: 13, color: '#1677ff', marginTop: 4 }}>模具编号： {o.moldCode || '—'}</Text>
        <Text style={{ display: 'block', fontSize: 13, color: '#1677ff', marginTop: 2 }}>款式编码： {o.styleQty || '—'}</Text>
        {o.image ? (
          <Image src={fullImageUrl(o.image)} mode="aspectFill" style={{ width: 44, height: 44, borderRadius: 4, marginTop: 6, display: 'block' }} />
        ) : null}
        <View style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
          <Text style={{ fontSize: 12, color: '#1677ff', border: '1px solid #91caff', background: '#e6f4ff', borderRadius: 4, padding: '1px 8px' }}>计划 {o.planQty}</Text>
          <Text style={{ fontSize: 12, color: '#fa8c16', border: '1px solid #ffd591', background: '#fff7e6', borderRadius: 4, padding: '1px 8px', marginLeft: 8 }}>待排 {o.pending}</Text>
          {(o.scheduledQty || 0) > 0 && (
            <Text style={{ fontSize: 12, color: '#52c41a', border: '1px solid #b7eb8f', background: '#f6ffed', borderRadius: 4, padding: '1px 8px', marginLeft: 8 }}>已排 {o.scheduledQty}</Text>
          )}
        </View>
        <Text style={{ display: 'block', fontSize: 12, color: '#5a6d85', marginTop: 6 }}>半成品加工： {o.semiText}</Text>
      </View>
    )
  }

  return (
    <View>
      {/* 日期导航：前一天/日期选择/今天/后一天 + 当日排产合计（字号减半） */}
      <View style={{ display: 'flex', alignItems: 'center', padding: '8px 24px 0' }}>
        <View style={chip} onClick={() => setDate(shiftDate(date, -1))}>‹</View>
        <Picker mode="date" value={date} onChange={e => setDate(e.detail.value)}>
          <Text style={{ marginLeft: 6, fontSize: 13, fontWeight: 600 }}>{date} ▾</Text>
        </Picker>
        <View style={chip} onClick={() => setDate(fmtDay(new Date()))}>今天</View>
        <View style={chip} onClick={() => setDate(shiftDate(date, 1))}>›</View>
        <Text style={{ marginLeft: 'auto', fontSize: 11, color: '#5a6d85' }}>
          当日合计 <Text style={{ color: '#ff4d4f', fontWeight: 700, fontSize: 12 }}>{data?.dayTotal || 0}</Text>
        </Text>
      </View>
      {/* 生产线 × 三班网格：恒渲染，空格显示 —（表头/线名/格内字号减半） */}
      <View style={{ margin: '6px 24px 0', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        <View style={{ display: 'flex', background: '#eef1f5', padding: '6px 0' }}>
          <Text style={{ flex: 0.9, textAlign: 'center', fontSize: 12, color: '#5a6d85', fontWeight: 600 }}>生产线</Text>
          {shifts.map(s => (
            <Text key={s.key} style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#5a6d85', fontWeight: 600 }}>
              {s.label} {s.range}
            </Text>
          ))}
        </View>
        {lines.map(l => (
          <View key={l} style={{ display: 'flex', borderTop: '1px solid #f0f2f5', padding: '6px 0', alignItems: 'stretch' }}>
            <Text style={{ flex: 0.9, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#1e4a7e' }}>{l}</Text>
            {shifts.map(s => {
              const c = cells[`${l}|${s.key}`]
              return (
                <View key={s.key} style={{ flex: 1, borderLeft: '1px solid #f0f2f5', padding: '0 4px', textAlign: 'center' }}>
                  {c && c.items.length ? (
                    <View>
                      <Text style={{ fontSize: 12, color: '#1677ff', fontWeight: 700 }}>需 {c.total}</Text>
                      {c.items.map((it, i) => (
                        <View key={i} style={{ fontSize: 10, color: '#5a6d85', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {it.no}{it.qty ? `×${it.qty}` : ''}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ fontSize: 11, color: '#c0c6cf' }}>—</Text>
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </View>

      {/* 待排产订单区：仅 pending>0 */}
      <View style={{ padding: '10px 24px 0', fontSize: 13, fontWeight: 600, color: '#1e4a7e' }}>待排产订单（{pendingOrders.length}）</View>
      {pendingOrders.length === 0 && <View className="empty">暂无待排产订单</View>}
      <View style={{ padding: '0 24px' }}>
        {pendingOrders.map(renderCard)}
      </View>

      {/* 生产订单全量列表：卡片格式与待排产区一致，支持搜索；含已排产订单供查看/改排期 */}
      <View style={{ padding: '14px 24px 0', fontSize: 13, fontWeight: 600, color: '#1e4a7e' }}>生产订单（{listedOrders.length}）</View>
      <View style={{ padding: '6px 24px 0' }}>
        <Input
          value={kw}
          onInput={e => setKw(e.detail.value)}
          placeholder="搜索单号 / 产品 / 模具 / 款式"
          placeholderStyle="color:#b0bcca;font-size:13px"
          style={{ height: 34, lineHeight: '34px', fontSize: 13, padding: '0 10px', background: '#fff', border: '1px solid #e6e9ee', borderRadius: 8, boxSizing: 'border-box' }}
        />
      </View>
      {listedOrders.length === 0 && <View className="empty">无匹配订单</View>}
      <View style={{ padding: '0 24px 12px' }}>
        {listedOrders.map(renderCard)}
      </View>

      {/* 订单详情 + 排期弹层 */}
      {active && (
        <View>
          <View style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} onClick={() => setActive(null)} />
          <View style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', padding: '16px 20px 28px', zIndex: 1001, maxHeight: '82%', boxSizing: 'border-box', overflowY: 'scroll' }}>
            <View style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>{active.id}</Text>
              <Text style={{ fontSize: 18, color: '#86909c' }} onClick={() => setActive(null)}>×</Text>
            </View>
            {/* 详情字段 */}
            {(active.fields || []).map(([label, value]) => (
              <View key={label} style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' }}>
                <Text style={{ flexShrink: 0, width: 80, fontSize: 13, color: '#86909c' }}>{label}</Text>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', wordBreak: 'break-all' }}>{value}</Text>
              </View>
            ))}

            {/* 已排期记录：逐条展示，可内联修改（日期/生产线/班次/数量） */}
            <View style={{ fontSize: 14, fontWeight: 600, margin: '14px 0 6px', color: '#1e4a7e' }}>排期记录（{active.schedules?.length || 0}）</View>
            {(!active.schedules || active.schedules.length === 0) && (
              <Text style={{ display: 'block', fontSize: 12, color: '#b0bcca', padding: '4px 0' }}>暂无排期记录</Text>
            )}
            {(active.schedules || []).map(rec => (
              editKey === rec.key ? (
                <View key={rec.key} style={{ border: '1px solid #91caff', background: '#f5faff', borderRadius: 8, padding: '8px 10px', marginTop: 6 }}>
                  <Text style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1677ff', marginBottom: 4 }}>{rec.id}</Text>
                  <View style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                    <Text style={{ width: 62, fontSize: 12, color: '#5a6d85', flexShrink: 0 }}>日期</Text>
                    <Picker mode="date" value={efDate} onChange={e => setEfDate(e.detail.value)} style={{ flex: 1 }}>
                      <View style={{ fontSize: 12, color: '#1677ff' }}>{efDate} ▾</View>
                    </Picker>
                  </View>
                  <View style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                    <Text style={{ width: 62, fontSize: 12, color: '#5a6d85', flexShrink: 0 }}>生产线</Text>
                    <Picker mode="selector" range={lines} value={efLineIdx} onChange={e => setEfLineIdx(Number(e.detail.value))} style={{ flex: 1 }}>
                      <View style={{ fontSize: 12, color: '#1677ff' }}>{lines[efLineIdx]} ▾</View>
                    </Picker>
                  </View>
                  <View style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                    <Text style={{ width: 62, fontSize: 12, color: '#5a6d85', flexShrink: 0 }}>班次</Text>
                    <Picker mode="selector" range={shifts.map(s => `${s.label} ${s.range}`)} value={efShiftIdx} onChange={e => setEfShiftIdx(Number(e.detail.value))} style={{ flex: 1 }}>
                      <View style={{ fontSize: 12, color: '#1677ff' }}>{shifts[efShiftIdx].label} ▾</View>
                    </Picker>
                  </View>
                  <View style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                    <Text style={{ width: 62, fontSize: 12, color: '#5a6d85', flexShrink: 0 }}>数量</Text>
                    <Input type="number" value={efQty} onInput={e => setEfQty(e.detail.value)}
                      style={{ flex: 1, height: 30, lineHeight: '30px', fontSize: 12, padding: '0 8px', background: '#fff', border: '1px solid #c9d1da', borderRadius: 6, boxSizing: 'border-box' }} />
                  </View>
                  <View style={{ display: 'flex', marginTop: 8 }}>
                    <View style={{ flex: 1, height: 32, lineHeight: '32px', textAlign: 'center', fontSize: 13, color: '#5a6d85', background: '#eef1f5', borderRadius: 6 }} onClick={() => setEditKey('')}>取消</View>
                    <View style={{ flex: 1, marginLeft: 8, height: 32, lineHeight: '32px', textAlign: 'center', fontSize: 13, color: '#fff', background: saving ? '#9ec9ff' : '#1677ff', borderRadius: 6 }} onClick={submitEdit}>{saving ? '保存中…' : '保存'}</View>
                  </View>
                </View>
              ) : (
                <View key={rec.key} style={{ display: 'flex', alignItems: 'center', background: '#fafbfc', borderRadius: 8, padding: '8px 10px', marginTop: 6 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ display: 'block', fontSize: 13, color: '#1f2733', fontWeight: 600 }}>{rec.id}</Text>
                    <Text style={{ display: 'block', fontSize: 12, color: '#5a6d85', marginTop: 2 }}>
                      {rec.startDate} · {rec.line} · {shiftLabel(rec.shift)} · 数量 {rec.planQty}
                    </Text>
                  </View>
                  <Text style={{ flexShrink: 0, fontSize: 12, color: '#1677ff', border: '1px solid #91caff', background: '#e6f4ff', borderRadius: 6, padding: '2px 10px', marginLeft: 8 }} onClick={() => startEdit(rec)}>修改</Text>
                </View>
              )
            ))}

            {/* 新增排期：仅当仍有待排数量时显示 */}
            {(active.pending || 0) > 0 && (
              <View>
                <View style={{ fontSize: 14, fontWeight: 600, margin: '14px 0 6px', color: '#1e4a7e' }}>新增排期</View>
                <View style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                  <Text style={{ width: 70, fontSize: 13, color: '#5a6d85', flexShrink: 0 }}>排期日期</Text>
                  <Picker mode="date" value={formDate} onChange={e => setFormDate(e.detail.value)} style={{ flex: 1 }}>
                    <View style={{ fontSize: 13, color: '#1677ff' }}>{formDate} ▾</View>
                  </Picker>
                </View>
                <View style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                  <Text style={{ width: 70, fontSize: 13, color: '#5a6d85', flexShrink: 0 }}>生产线</Text>
                  <Picker mode="selector" range={lines} value={lineIdx} onChange={e => setLineIdx(Number(e.detail.value))} style={{ flex: 1 }}>
                    <View style={{ fontSize: 13, color: '#1677ff' }}>{lines[lineIdx]} ▾</View>
                  </Picker>
                </View>
                <View style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                  <Text style={{ width: 70, fontSize: 13, color: '#5a6d85', flexShrink: 0 }}>班次</Text>
                  <Picker mode="selector" range={shifts.map(s => `${s.label} ${s.range}`)} value={shiftIdx} onChange={e => setShiftIdx(Number(e.detail.value))} style={{ flex: 1 }}>
                    <View style={{ fontSize: 13, color: '#1677ff' }}>{shifts[shiftIdx].label} {shifts[shiftIdx].range} ▾</View>
                  </Picker>
                </View>
                <View style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                  <Text style={{ width: 70, fontSize: 13, color: '#5a6d85', flexShrink: 0 }}>排期数量</Text>
                  <Input type="number" value={qty} onInput={e => setQty(e.detail.value)}
                    style={{ flex: 1, height: 32, lineHeight: '32px', fontSize: 13, padding: '0 8px', background: '#f5f7fa', borderRadius: 6, boxSizing: 'border-box' }} />
                </View>
                <View
                  style={{ marginTop: 12, height: 36, lineHeight: '36px', textAlign: 'center', fontSize: 14, color: '#fff', background: saving ? '#9ec9ff' : '#1677ff', borderRadius: 8 }}
                  onClick={submit}
                >
                  {saving ? '提交中…' : '确认排期'}
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}

export default ScheduleBoardView
