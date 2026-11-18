import { useState, useEffect } from 'react'
import { View, Text, Input, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getLeaves, createLeave, auditLeave } from '../services/api'

const LEAVE_TYPES = ['事假', '病假', '年假', '调休', '婚假', '产假', '丧假']

const TABS = [
  { key: 'mine', label: '我的申请' },
  { key: 'pending', label: '待审批' },
  { key: 'all', label: '全部' },
] as const

const statusTag = (status: string) => {
  if (status === 'pending') return 'tag-orange'
  if (status === 'approved') return 'tag-green'
  return 'tag-red'
}
const statusText = (status: string) =>
  (status === 'pending' ? '待审批' : status === 'approved' ? '已通过' : '已拒绝')

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 请假管理：与 Web LeavePage 同口径（hr_leaves_<owner>，status pending/approved/rejected）
const LeaveView = ({ tick = 0 }: { tick?: number }) => {
  const [tab, setTab] = useState<'mine' | 'pending' | 'all'>('mine')
  const [list, setList] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [formVisible, setFormVisible] = useState(false)
  const [typeIdx, setTypeIdx] = useState(0)
  const [start, setStart] = useState(todayStr())
  const [end, setEnd] = useState(todayStr())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    setLoaded(false)
    getLeaves(tab)
      .then(d => setList(d.list))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [tab, tick])

  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1

  const submit = async () => {
    if (busy) return
    if (!(days > 0)) {
      Taro.showToast({ title: '结束日期不能早于开始日期', icon: 'none' })
      return
    }
    setBusy('submit')
    try {
      await createLeave({ type: LEAVE_TYPES[typeIdx], startDate: start, endDate: end, reason: reason.trim() })
      Taro.showToast({ title: '请假申请已提交', icon: 'success' })
      setFormVisible(false)
      setReason('')
      setTab('mine')
      const d = await getLeaves('mine')
      setList(d.list)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '提交失败', icon: 'none' })
    } finally {
      setBusy('')
    }
  }

  const audit = async (key: string, approved: boolean) => {
    if (busy) return
    setBusy(key)
    try {
      await auditLeave(key, approved)
      Taro.showToast({ title: approved ? '已通过' : '已拒绝', icon: 'success' })
      const d = await getLeaves(tab)
      setList(d.list)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      setBusy('')
    }
  }

  return (
    <View>
      <View className="segment" style={{ margin: '16px 24px 0' }}>
        {TABS.map(t => (
          <View key={t.key} className={`segment-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </View>
        ))}
      </View>
      <View style={{ padding: '16px 24px 0' }}>
        <Button className="btn-primary" style={{ lineHeight: '72px' }} onClick={() => setFormVisible(v => !v)}>
          {formVisible ? '收起表单' : '＋ 新增请假申请'}
        </Button>
      </View>

      {formVisible && (
        <View className="card">
          <Picker mode="selector" range={LEAVE_TYPES} value={typeIdx} onChange={e => setTypeIdx(Number(e.detail.value))}>
            <View className="row">
              <Text className="muted">请假类型</Text>
              <Text style={{ color: '#1677ff' }}>{LEAVE_TYPES[typeIdx]} ▾</Text>
            </View>
          </Picker>
          <Picker mode="date" value={start} onChange={e => setStart(e.detail.value)}>
            <View className="row">
              <Text className="muted">开始日期</Text>
              <Text style={{ color: '#1677ff' }}>{start} ▾</Text>
            </View>
          </Picker>
          <Picker mode="date" value={end} onChange={e => setEnd(e.detail.value)}>
            <View className="row">
              <Text className="muted">结束日期</Text>
              <Text style={{ color: '#1677ff' }}>{end} ▾</Text>
            </View>
          </Picker>
          <View className="row">
            <Text className="muted">天数</Text>
            <Text style={{ fontWeight: 600 }}>{days > 0 ? days : '—'} 天（自动计算）</Text>
          </View>
          <Input className="input" style={{ marginTop: 12 }} placeholder="请假事由（选填）" value={reason} onInput={e => setReason(e.detail.value)} />
          <Button className="btn-primary" loading={busy === 'submit'} onClick={submit}>提交申请</Button>
        </View>
      )}

      {loaded && list.length === 0 && <View className="empty">暂无请假记录</View>}
      {list.map((r: any) => (
        <View key={String(r.key)} className="card">
          <View className="row">
            <Text style={{ fontWeight: 600 }}>{r.employeeName || r.employeeUsername}</Text>
            <Text className={`tag ${statusTag(r.status)}`}>{statusText(r.status)}</Text>
          </View>
          <View className="row">
            <Text className="muted">{r.type}　{r.startDate} ~ {r.endDate}</Text>
            <Text style={{ fontWeight: 600 }}>{r.days} 天</Text>
          </View>
          {r.reason ? <View className="muted" style={{ paddingTop: 4 }}>事由：{r.reason}</View> : null}
          {r.status === 'pending' && (
            <View style={{ display: 'flex', marginTop: 12 }}>
              <View style={{ flex: 1, marginRight: 16 }}>
                <Button size="mini" className="btn-danger" style={{ lineHeight: '56px' }} loading={busy === r.key} onClick={() => audit(r.key, false)}>拒绝</Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button size="mini" className="btn-primary" style={{ lineHeight: '56px' }} loading={busy === r.key} onClick={() => audit(r.key, true)}>通过</Button>
              </View>
            </View>
          )}
          {r.status !== 'pending' && r.approvedBy ? (
            <View className="muted" style={{ paddingTop: 4 }}>审批人：{r.approvedBy}　{String(r.approvedAt || '').slice(0, 10)}</View>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export default LeaveView
