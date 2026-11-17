import { useState, useEffect } from 'react'
import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getAttendance, postAttendance, AttendanceRecord } from '../services/api'

// 上下班打卡：上班取首次、下班取最新；记录存 attendance_<owner> 与 Web 端同步可见
const AttendanceView = ({ tick = 0 }: { tick?: number }) => {
  const [record, setRecord] = useState<AttendanceRecord | null>(null)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    getAttendance()
      .then(d => { setRecord(d.record); setDate(d.date) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
  }, [tick])

  const punch = async (type: 'in' | 'out') => {
    if (busy) return
    setBusy(type)
    try {
      const d = await postAttendance(type)
      setRecord(d.record)
      Taro.showToast({ title: type === 'in' ? `上班打卡 ${d.record.in}` : `下班打卡 ${d.record.out}`, icon: 'none' })
    } catch (e: any) {
      Taro.showToast({ title: e.message || '打卡失败', icon: 'none' })
    } finally {
      setBusy('')
    }
  }

  return (
    <View style={{ padding: '24px' }}>
      <View className="card" style={{ margin: 0, textAlign: 'center', padding: 40 }}>
        <Text className="muted" style={{ display: 'block', marginBottom: 12 }}>{date} 考勤</Text>
        <View style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <View style={{ marginRight: 60 }}>
            <Text style={{ fontSize: 44, fontWeight: 700, color: record?.in ? '#52c41a' : '#d9d9d9', display: 'block' }}>{record?.in || '--:--'}</Text>
            <Text className="muted">上班</Text>
          </View>
          <View>
            <Text style={{ fontSize: 44, fontWeight: 700, color: record?.out ? '#1677ff' : '#d9d9d9', display: 'block' }}>{record?.out || '--:--'}</Text>
            <Text className="muted">下班</Text>
          </View>
        </View>
        <View style={{ display: 'flex' }}>
          <View style={{ flex: 1, marginRight: 16 }}>
            <Button className="btn-primary" loading={busy === 'in'} disabled={!!record?.in} onClick={() => punch('in')}>
              {record?.in ? '已上班' : '上班打卡'}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button className="btn-danger" loading={busy === 'out'} onClick={() => punch('out')}>下班打卡</Button>
          </View>
        </View>
      </View>
      <View className="muted" style={{ marginTop: 24, textAlign: 'center' }}>打卡记录同步至网页端人事考勤</View>
    </View>
  )
}

export default AttendanceView
