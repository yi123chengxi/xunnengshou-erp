import { useState, useEffect } from 'react'
import { View, Text, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getScheduleBoard, ScheduleBoardData } from '../services/api'
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

const chip = { marginLeft: 12, padding: '4px 18px', fontSize: 22, borderRadius: 8, background: '#eef1f5', color: '#5a6d85' }

/**
 * 生产排期：与 Web ScheduleBoard 同构的移动版看板——
 * 生产线 × 上午/下午/晚上 格子矩阵恒渲染（无排期也显示空网格），
 * 格内显示该线该班排入单号与需生产合计；下方接排期记录全字段明细。
 */
const ScheduleBoardView = ({ tick = 0 }: { tick?: number }) => {
  const [date, setDate] = useState(fmtDay(new Date()))
  const [data, setData] = useState<ScheduleBoardData | null>(null)

  useEffect(() => {
    getScheduleBoard(date)
      .then(d => setData(d || null))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
  }, [date, tick])

  const lines = data?.lines?.length ? data.lines : DEFAULT_LINES
  const shifts = data?.shifts?.length ? data.shifts : SHIFTS
  const cells = data?.cells || {}

  return (
    <View>
      {/* 日期导航：前一天/日期选择/今天/后一天 + 当日排产合计 */}
      <View style={{ display: 'flex', alignItems: 'center', padding: '16px 24px 0' }}>
        <View style={chip} onClick={() => setDate(shiftDate(date, -1))}>‹</View>
        <Picker mode="date" value={date} onChange={e => setDate(e.detail.value)}>
          <Text style={{ marginLeft: 12, fontSize: 26, fontWeight: 600 }}>{date} ▾</Text>
        </Picker>
        <View style={chip} onClick={() => setDate(fmtDay(new Date()))}>今天</View>
        <View style={chip} onClick={() => setDate(shiftDate(date, 1))}>›</View>
        <Text style={{ marginLeft: 'auto', fontSize: 22, color: '#5a6d85' }}>
          当日合计 <Text style={{ color: '#ff4d4f', fontWeight: 700, fontSize: 24 }}>{data?.dayTotal || 0}</Text>
        </Text>
      </View>
      {/* 生产线 × 三班网格：恒渲染，空格显示 — */}
      <View style={{ margin: '12px 24px 0', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        <View style={{ display: 'flex', background: '#eef1f5', padding: '12px 0' }}>
          <Text style={{ flex: 0.9, textAlign: 'center', fontSize: 24, color: '#5a6d85', fontWeight: 600 }}>生产线</Text>
          {shifts.map(s => (
            <Text key={s.key} style={{ flex: 1, textAlign: 'center', fontSize: 24, color: '#5a6d85', fontWeight: 600 }}>
              {s.label} {s.range}
            </Text>
          ))}
        </View>
        {lines.map(l => (
          <View key={l} style={{ display: 'flex', borderTop: '1px solid #f0f2f5', padding: '12px 0', alignItems: 'stretch' }}>
            <Text style={{ flex: 0.9, textAlign: 'center', fontSize: 26, fontWeight: 600, color: '#1e4a7e' }}>{l}</Text>
            {shifts.map(s => {
              const c = cells[`${l}|${s.key}`]
              return (
                <View key={s.key} style={{ flex: 1, borderLeft: '1px solid #f0f2f5', padding: '0 8px', textAlign: 'center' }}>
                  {c && c.items.length ? (
                    <View>
                      <Text style={{ fontSize: 24, color: '#1677ff', fontWeight: 700 }}>需 {c.total}</Text>
                      {c.items.map((it, i) => (
                        <View key={i} style={{ fontSize: 20, color: '#5a6d85', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {it.no}{it.qty ? `×${it.qty}` : ''}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ fontSize: 22, color: '#c0c6cf' }}>—</Text>
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </View>
      {/* 排期记录全字段明细（卡片式） */}
      <ListView page="production-schedule" tick={tick} />
    </View>
  )
}

export default ScheduleBoardView
