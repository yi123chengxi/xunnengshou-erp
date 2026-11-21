import { useState, useEffect } from 'react'
import { View, Text, Input, Picker, Button, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getLeaves, createLeave, auditLeave } from '../services/api'

const LEAVE_TYPES = ['事假', '病假', '年假', '调休', '婚假', '产假', '丧假']

// —— 行内样式常量（weapp 中行内数字按真实 px 渲染，且全局类尺寸会压过行内，故自带全部视觉属性）——
// 新增入口：原挂 .btn-primary（84rpx 高）+ 行内 lineHeight 72px（≈144rpx）显得过大，去类后定高 40px
const ADD_BTN = { height: 40, lineHeight: '40px', fontSize: 15, fontWeight: 500, color: '#ffffff', background: '#1677ff', borderRadius: 8, textAlign: 'center', boxSizing: 'border-box' } as const
const MASK = { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const
const DIALOG = { width: '80%', background: '#ffffff', borderRadius: 12, padding: '18px 16px 14px', boxSizing: 'border-box' } as const
const DLG_TITLE = { fontSize: 16, fontWeight: 600, color: '#1f2733', display: 'block' } as const
const DLG_SUB = { marginTop: 6, fontSize: 13, color: '#8a94a6', lineHeight: '19px', display: 'block' } as const
const DLG_INPUT = { marginTop: 12, height: 76, padding: '8px 10px', background: '#f7f9fb', border: '1px solid #c9d4e3', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' } as const
const DLG_ROW = { display: 'flex', marginTop: 14 } as const
const DLG_BTN = { flex: 1, height: 38, lineHeight: '38px', textAlign: 'center', fontSize: 15, borderRadius: 8 } as const

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
  // 拒绝弹层：拒绝必须填原因（与网页版 PaymentRequestPage 拒绝弹窗同口径，字段名统一 rejectReason）
  const [rejectTarget, setRejectTarget] = useState<any | null>(null)
  const [rejectReason, setRejectReason] = useState('')

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

  const audit = async (key: string, approved: boolean, reasonText = '') => {
    if (busy) return
    setBusy(key)
    try {
      await auditLeave(key, approved, reasonText)
      Taro.showToast({ title: approved ? '已通过' : '已拒绝', icon: 'success' })
      const d = await getLeaves(tab)
      setList(d.list)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      setBusy('')
    }
  }

  /** 通过前二次确认：避免在列表卡片上手滑误操作（审批后不可撤销） */
  const onApprove = (r: any) => {
    Taro.showModal({
      title: '确认通过',
      content: `确定通过 ${r.employeeName || r.employeeUsername} 的 ${r.days} 天${r.type || ''}吗？通过后不可撤销。`,
      confirmText: '通过',
      cancelText: '取消',
      success: res => { if (res.confirm) void audit(String(r.key), true) },
    })
  }

  const openReject = (r: any) => { setRejectTarget(r); setRejectReason('') }

  const confirmReject = async () => {
    const t = rejectReason.trim()
    if (!t) {
      Taro.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    const r = rejectTarget
    setRejectTarget(null)
    await audit(String(r.key), false, t)
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
        <View style={{ ...ADD_BTN }} onClick={() => setFormVisible(v => !v)}>
          {formVisible ? '收起表单' : '＋ 新增请假申请'}
        </View>
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
                <Button size="mini" className="btn-danger" style={{ lineHeight: '56px' }} loading={busy === r.key} onClick={() => openReject(r)}>拒绝</Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button size="mini" className="btn-primary" style={{ lineHeight: '56px' }} loading={busy === r.key} onClick={() => onApprove(r)}>通过</Button>
              </View>
            </View>
          )}
          {r.status !== 'pending' && r.approvedBy ? (
            <View className="muted" style={{ paddingTop: 4 }}>审批人：{r.approvedBy}　{String(r.approvedAt || '').slice(0, 10)}</View>
          ) : null}
          {r.status === 'rejected' && r.rejectReason ? (
            <View style={{ paddingTop: 4, color: '#f5222d' }}>拒绝原因：{r.rejectReason}</View>
          ) : null}
        </View>
      ))}

      {/* 拒绝弹层：原因必填，不填不提交 */}
      {rejectTarget && (
        <View style={{ ...MASK }} onClick={() => setRejectTarget(null)}>
          <View style={{ ...DIALOG }} onClick={e => e.stopPropagation()}>
            <Text style={{ ...DLG_TITLE }}>拒绝请假申请</Text>
            <Text style={{ ...DLG_SUB }}>
              {`${rejectTarget.employeeName || rejectTarget.employeeUsername}　${rejectTarget.days} 天${rejectTarget.type || ''}`}
            </Text>
            <Textarea
              style={{ ...DLG_INPUT }}
              placeholder="请输入拒绝原因（必填，申请人可见）"
              placeholderStyle="color:#9aa3ad;font-size:15px"
              maxlength={200}
              value={rejectReason}
              onInput={e => setRejectReason(e.detail.value)}
            />
            <View style={{ ...DLG_ROW }}>
              <View style={{ ...DLG_BTN, marginRight: 10, color: '#5a6d85', background: '#f2f4f7' }} onClick={() => setRejectTarget(null)}>取消</View>
              <View style={{ ...DLG_BTN, marginLeft: 10, color: '#ffffff', background: rejectReason.trim() ? '#f5222d' : '#f0a5a5' }} onClick={confirmReject}>确认拒绝</View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default LeaveView
