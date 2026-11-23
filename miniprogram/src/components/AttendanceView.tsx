import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getAttendance, postAttendance, AttendanceRecord, AttendanceShift } from '../services/api'
import { chooseAndUploadImage } from '../services/upload'

// 两点球面距离（米），wgs84 经纬度；与服务端 haversineMeters 同公式
const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const p2 = (n: number) => String(n).padStart(2, '0')
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 上下班打卡（企业微信式）：
 * - 顶部班次信息 + 定位状态（是否在打卡范围内）
 * - 中央黄色圆环大按钮：实时时钟 + 上班/下班打卡；requirePhoto 时先拍照再提交
 * - 打卡范围与拍照要求由 Web 端班次设置下发（GET /wx/attendance 的 shift 配置）
 * - 上班取首次、下班取最新；记录落 hr_attendance_<owner> 与 Web 端同步可见
 */
const AttendanceView = ({ tick = 0 }: { tick?: number }) => {
  const [record, setRecord] = useState<AttendanceRecord | null>(null)
  const [date, setDate] = useState('')
  const [shift, setShift] = useState<AttendanceShift | null>(null)
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [locState, setLocState] = useState<'loading' | 'ok' | 'fail'>('loading')
  const [now, setNow] = useState(new Date())
  const [busy, setBusy] = useState(false)

  // 实时时钟
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // 加载今日记录与班次配置
  useEffect(() => {
    getAttendance()
      .then(d => { setRecord(d.record); setDate(d.date); setShift(d.shift) })
      .catch(e => Taro.showToast({ title: e.message || '加载失败', icon: 'none' }))
  }, [tick])

  // 获取当前定位（wgs84，与 Web 端班次坐标同系）
  const loadLoc = () => {
    setLocState('loading')
    Taro.getLocation({ type: 'wgs84', isHighAccuracy: true })
      .then(r => { setLoc({ lat: r.latitude, lng: r.longitude }); setLocState('ok') })
      .catch(() => { setLoc(null); setLocState('fail') })
  }
  useEffect(() => { loadLoc() }, [tick])

  // 打卡范围判定
  const hasRange = !!shift && typeof shift.punchLat === 'number' && typeof shift.punchLng === 'number'
  const dist = hasRange && loc ? haversine(loc.lat, loc.lng, shift!.punchLat as number, shift!.punchLng as number) : null
  const radius = shift?.punchRadius || 300
  const inRange = !hasRange || (dist !== null && dist <= radius)

  const nextType: 'in' | 'out' = record?.in ? 'out' : 'in'
  const canPunch = inRange && locState !== 'loading' && !busy

  const punch = async () => {
    if (busy) return
    if (hasRange && locState === 'fail') { Taro.showToast({ title: '定位失败，无法打卡，请重试', icon: 'none' }); return }
    if (hasRange && !loc) { Taro.showToast({ title: '正在获取定位，请稍候', icon: 'none' }); return }
    if (!inRange) { Taro.showToast({ title: `不在打卡范围内（距打卡点约 ${Math.round(dist as number)} 米）`, icon: 'none' }); return }
    setBusy(true)
    try {
      let photo: string | undefined
      if (shift?.requirePhoto) {
        photo = await chooseAndUploadImage(['camera'])
      }
      const d = await postAttendance({ type: nextType, lat: loc?.lat, lng: loc?.lng, photo })
      setRecord(d.record)
      Taro.showToast({ title: nextType === 'in' ? `上班打卡 ${d.record.in}` : `下班打卡 ${d.record.out}`, icon: 'success' })
    } catch (e: any) {
      const msg = e?.message || e?.errMsg || ''
      // 用户取消拍照/定位授权时静默
      if (/cancel|取消/i.test(msg)) { /* noop */ }
      else Taro.showToast({ title: msg || '打卡失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const clockStr = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`
  const wd = WD[now.getDay()]
  const btnActive = canPunch
  const ringBg = btnActive
    ? 'linear-gradient(135deg,#ffd66b 0%,#ff9f43 100%)'
    : 'linear-gradient(135deg,#d8dbe0 0%,#b6bac2 100%)'

  // 定位状态文案
  let locText = ''
  let locColor = '#86909c'
  if (!hasRange) { locText = '未设置打卡范围 · 任意地点可打卡'; locColor = '#86909c' }
  else if (locState === 'loading') { locText = '正在获取定位…'; locColor = '#86909c' }
  else if (locState === 'fail') { locText = '定位失败，请点击刷新'; locColor = '#f5222d' }
  else if (inRange) { locText = `在打卡范围内${dist !== null ? `（距打卡点约 ${Math.round(dist)} 米）` : ''}`; locColor = '#52c41a' }
  else { locText = `不在打卡范围内（距打卡点约 ${Math.round(dist as number)} 米，允许 ${radius} 米）`; locColor = '#f5222d' }

  return (
    <View style={{ minHeight: '100vh', background: '#f5f6f8', padding: '16px 16px 40px', boxSizing: 'border-box' }}>
      {/* 班次与地点信息卡 */}
      <View style={{ background: '#fff', borderRadius: 12, padding: '16px 18px' }}>
        <View style={{ display: 'flex', alignItems: 'baseline' }}>
          <Text style={{ fontSize: 20, fontWeight: 700, color: '#1f2733' }}>{date || `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`}</Text>
          <Text style={{ marginLeft: 8, fontSize: 14, color: '#86909c' }}>{wd}</Text>
        </View>
        <View style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: 600, color: '#1677ff' }}>{shift?.name || '标准班'}</Text>
          {(shift?.startTime || shift?.endTime) && (
            <Text style={{ marginLeft: 10, fontSize: 13, color: '#5a6d85' }}>
              {shift?.startTime || '--:--'} ~ {shift?.endTime || '--:--'}
            </Text>
          )}
        </View>
        {(shift?.clockInLocation || shift?.clockInAddress) && (
          <Text style={{ display: 'block', marginTop: 6, fontSize: 13, color: '#5a6d85' }}>
            📍 {shift?.clockInLocation || ''}{shift?.clockInAddress ? ` · ${shift.clockInAddress}` : ''}
          </Text>
        )}
        {shift?.requirePhoto && (
          <Text style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#fa8c16', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '2px 8px' }}>
            📷 本次打卡需拍照
          </Text>
        )}
      </View>

      {/* 中央圆环打卡按钮 */}
      <View style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 36 }}>
        <View
          onClick={punch}
          style={{
            width: 200, height: 200, borderRadius: 100, background: ringBg,
            boxShadow: btnActive ? '0 8px 24px rgba(255,159,67,0.45)' : '0 4px 12px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            opacity: busy ? 0.7 : 1,
          }}
        >
          <Text style={{ fontSize: 34, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>{clockStr}</Text>
          <Text style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: '#fff' }}>
            {busy ? '提交中…' : (nextType === 'in' ? '上班打卡' : '下班打卡')}
          </Text>
          {shift?.requirePhoto && !busy && (
            <Text style={{ marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>点击拍照打卡</Text>
          )}
        </View>

        {/* 定位状态 */}
        <View style={{ marginTop: 20, display: 'flex', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: locColor }}>{locText}</Text>
          {hasRange && (
            <Text onClick={loadLoc} style={{ marginLeft: 10, fontSize: 13, color: '#1677ff' }}>刷新定位</Text>
          )}
        </View>
      </View>

      {/* 上下班时间 */}
      <View style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
        <View style={{ flex: 1, maxWidth: 150, background: '#fff', borderRadius: 10, padding: '14px 0', textAlign: 'center', marginRight: 12 }}>
          <Text style={{ display: 'block', fontSize: 26, fontWeight: 700, color: record?.in ? '#52c41a' : '#d9d9d9' }}>{record?.in ? record.in.slice(0, 5) : '--:--'}</Text>
          <Text style={{ fontSize: 13, color: '#86909c' }}>上班</Text>
        </View>
        <View style={{ flex: 1, maxWidth: 150, background: '#fff', borderRadius: 10, padding: '14px 0', textAlign: 'center' }}>
          <Text style={{ display: 'block', fontSize: 26, fontWeight: 700, color: record?.out ? '#1677ff' : '#d9d9d9' }}>{record?.out ? record.out.slice(0, 5) : '--:--'}</Text>
          <Text style={{ fontSize: 13, color: '#86909c' }}>下班</Text>
        </View>
      </View>

      <Text style={{ display: 'block', marginTop: 24, textAlign: 'center', fontSize: 12, color: '#a6a6a6' }}>打卡记录同步至网页端人事考勤</Text>
    </View>
  )
}

export default AttendanceView
