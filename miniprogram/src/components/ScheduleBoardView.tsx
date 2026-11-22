import { useState, useEffect } from 'react'
import { View, Text, Picker, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getScheduleBoard, postSchedule, ScheduleBoardData, ScheduleOrderItem } from '../services/api'
import { fullImageUrl } from '../utils/imageUrl'
import ListView from './ListView'

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
 * 下方待排产订单卡与 Web 待排产面板同结构（单号/模具/款式/图片/计划·待排/半成品加工），
 * 点击卡片弹出详情 + 排期表单（日期/生产线/班次/数量），提交走 POST /wx/schedule 与 Web 拖拽落库同源。
 */
const ScheduleBoardView = ({ tick = 0 }: { tick?: number }) => {
  const [date, setDate] = useState(fmtDay(new Date()))
  const [data, setData] = useState<ScheduleBoardData | null>(null)
  // 详情+排期弹层：active 为当前订单，表单四项默认值在打开时重置
  const [active, setActive] = useState<ScheduleOrderItem | null>(null)
  const [formDate, setFormDate] = useState(date)
  const [lineIdx, setLineIdx] = useState(0)
  const [shiftIdx, setShiftIdx] = useState(0)
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    getScheduleBoard(date)
      .then(d => setData(d || null))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, tick])

  const lines = data?.lines?.length ? data.lines : DEFAULT_LINES
  const shifts = data?.shifts?.length ? data.shifts : SHIFTS
  const cells = data?.cells || {}
  const orders = data?.orders || []

  const openOrder = (o: ScheduleOrderItem) => {
    setActive(o)
    setFormDate(date)
    setLineIdx(0)
    setShiftIdx(0)
    setQty(String(o.pending || ''))
  }
  const submit = () => {
    if (!active || saving) return
    const q = Number(qty)
    if (!(q > 0)) { Taro.showToast({ title: '排期数量需大于 0', icon: 'none' }); return }
    setSaving(true)
    postSchedule({ productionOrderId: active.id, date: formDate, line: lines[lineIdx], shift: shifts[shiftIdx].key, qty: q })
      .then(() => { Taro.showToast({ title: '排期成功', icon: 'success' }); setActive(null); load() })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setSaving(false))
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
      {/* 待排产订单：与 Web ScheduleBoard 待排产面板同结构卡片；点击弹详情+排期 */}
      <View style={{ padding: '10px 24px 0', fontSize: 13, fontWeight: 600, color: '#1e4a7e' }}>待排产订单（{orders.length}）</View>
      {orders.length === 0 && <View className="empty">暂无待排产订单</View>}
      <View style={{ padding: '0 24px' }}>
        {orders.map(o => (
          <View key={o.id} style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', marginTop: 8 }} onClick={() => openOrder(o)}>
            <Text style={{ display: 'block', fontSize: 15, fontWeight: 600, color: '#1677ff' }}>{o.id}</Text>
            <Text style={{ display: 'block', fontSize: 13, color: '#1677ff', marginTop: 4 }}>模具编号： {o.moldCode || '—'}</Text>
            <Text style={{ display: 'block', fontSize: 13, color: '#1677ff', marginTop: 2 }}>款式编码： {o.styleQty || '—'}</Text>
            {o.image ? (
              <Image src={fullImageUrl(o.image)} mode="aspectFill" style={{ width: 44, height: 44, borderRadius: 4, marginTop: 6, display: 'block' }} />
            ) : null}
            <View style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
              <Text style={{ fontSize: 12, color: '#1677ff', border: '1px solid #91caff', background: '#e6f4ff', borderRadius: 4, padding: '1px 8px' }}>计划 {o.planQty}</Text>
              <Text style={{ fontSize: 12, color: '#fa8c16', border: '1px solid #ffd591', background: '#fff7e6', borderRadius: 4, padding: '1px 8px', marginLeft: 8 }}>待排 {o.pending}</Text>
            </View>
            <Text style={{ display: 'block', fontSize: 12, color: '#5a6d85', marginTop: 6 }}>半成品加工： {o.semiText}</Text>
          </View>
        ))}
      </View>
      {/* 排期记录全字段明细（卡片式） */}
      <ListView page="production-schedule" tick={tick} />

      {/* 订单详情 + 排期弹层：字段对由服务端 fields 下发，排期表单与 Web 登记窗同字段 */}
      {active && (
        <View>
          <View style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} onClick={() => setActive(null)} />
          <View style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', padding: '16px 20px 28px', zIndex: 1001, maxHeight: '78%', boxSizing: 'border-box', overflowY: 'scroll' }}>
            <View style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>{active.id}</Text>
              <Text style={{ fontSize: 18, color: '#86909c' }} onClick={() => setActive(null)}>×</Text>
            </View>
            {(active.fields || []).map(([label, value]) => (
              <View key={label} style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' }}>
                <Text style={{ flexShrink: 0, width: 80, fontSize: 13, color: '#86909c' }}>{label}</Text>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', wordBreak: 'break-all' }}>{value}</Text>
              </View>
            ))}
            <View style={{ fontSize: 14, fontWeight: 600, margin: '12px 0 8px', color: '#1e4a7e' }}>排期</View>
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
              <Input
                type="number"
                value={qty}
                onInput={e => setQty(e.detail.value)}
                style={{ flex: 1, height: 32, lineHeight: '32px', fontSize: 13, padding: '0 8px', background: '#f5f7fa', borderRadius: 6, boxSizing: 'border-box' }}
              />
            </View>
            <View
              style={{ marginTop: 12, height: 36, lineHeight: '36px', textAlign: 'center', fontSize: 14, color: '#fff', background: saving ? '#9ec9ff' : '#1677ff', borderRadius: 8 }}
              onClick={submit}
            >
              {saving ? '提交中…' : '确认排期'}
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default ScheduleBoardView
