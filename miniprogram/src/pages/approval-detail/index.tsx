import { useState } from 'react'
import './index.scss'
import { View, Text, Image, Textarea, Button } from '@tarojs/components'
import Taro, { useLoad } from '@tarojs/taro'
import { getApprovalDetail, auditApproval, ApprovalDetail as ApprovalDetailData } from '../../services/api'
import { fullImageUrl } from '../../utils/imageUrl'
import AppTabBar from '../../components/AppTabBar'

const MAIN_CATEGORIES = ['销售费用', '管理费用', '财务费用']

// 审批详情：明细 + 票据预览 + 同意/驳回（与网页审核写入口径一致）
const ApprovalDetail = () => {
  const [type, setType] = useState('reimbursement')
  const [key, setKey] = useState('')
  const [detail, setDetail] = useState<ApprovalDetailData | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useLoad(params => {
    const t = params.type === 'payment' ? 'payment' : 'reimbursement'
    const k = String(params.key || '')
    setType(t)
    setKey(k)
    getApprovalDetail(t, k).then(setDetail).catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
  })

  const rec = detail?.record || {}
  const doAudit = async (approved: boolean, mainCategory?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await auditApproval(type, key, { approved, comment: comment.trim(), mainCategory })
      Taro.showToast({ title: approved ? '已同意' : '已驳回', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 600)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const onApprove = async () => {
    if (type === 'reimbursement') {
      // 与网页一致：报销审核通过必选主分类（入日常记账凭证用）
      try {
        const r = await Taro.showActionSheet({ itemList: MAIN_CATEGORIES })
        await doAudit(true, MAIN_CATEGORIES[r.tapIndex])
      } catch { /* 取消 */ }
      return
    }
    await doAudit(true)
  }

  const onReject = async () => {
    if (!comment.trim()) {
      Taro.showToast({ title: '请填写拒绝原因', icon: 'none' })
      return
    }
    await doAudit(false)
  }

  if (!detail) return <View className="empty">加载中…</View>

  const rows: [string, string][] = type === 'reimbursement'
    ? [
      ['报销编号', rec.reimbursementNo || '—'],
      ['报销标题', rec.title || '—'],
      ['费用分类', rec.category || '—'],
      ['金额', `¥${(Number(rec.amount) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`],
      ['申请人', rec.applicantName || rec.applicant || '—'],
      ['申请日期', rec.applyDate || '—'],
      ['费用说明', rec.description || '—'],
      ['状态', detail.item.statusText],
      ['审核人', rec.financeReviewer || '—'],
      ['审核意见', rec.financeComment || '—'],
    ]
    : [
      ['单号', detail.item.no],
      ['类型', rec.recordType === 'receipt' ? '收款登记' : '付款申请'],
      ['事由', rec.description || '—'],
      ['金额', `¥${(Number(rec.amount) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`],
      ['申请人', rec.applicantName || rec.applicant || '—'],
      ['申请日期', rec.applyDate || '—'],
      ['状态', detail.item.statusText],
      ['审核人', rec.reviewer || '—'],
      ['拒绝原因', rec.rejectReason || '—'],
    ]

  // 票据地址归一：网页端上传存的是相对/旧形态绝对 URL，weapp 直接加载会空白，统一转完整 HTTPS 通道地址
  const receipts: string[] = (Array.isArray(rec.receipts) ? rec.receipts : []).map((s: string) => fullImageUrl(s)).filter(Boolean)

  return (
    <View style={{ paddingBottom: 300 }}>
      <View className="card">
        {rows.map(([label, value]) => (
          <View key={label} className="row">
            <Text className="muted">{label}</Text>
            <Text style={{ maxWidth: 420, textAlign: 'right' }}>{value}</Text>
          </View>
        ))}
      </View>

      {receipts.length > 0 && (
        <View className="card">
          <View className="card-title">票据（{receipts.length}）</View>
          <View style={{ display: 'flex', flexWrap: 'wrap' }}>
            {receipts.map((src, i) => (
              <Image
                key={i}
                src={src}
                mode="aspectFill"
                style={{ width: 200, height: 200, margin: '0 12px 12px 0', borderRadius: 8 }}
                onClick={() => Taro.previewImage({ urls: receipts, current: i })}
              />
            ))}
          </View>
        </View>
      )}

      {detail.pending && detail.canAudit && (
        <View style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(96px + env(safe-area-inset-bottom))', zIndex: 190, background: '#fff', padding: '20px 24px', boxShadow: '0 -2px 8px rgba(31,39,51,0.06)' }}>
          <Textarea className="textarea" placeholder={type === 'reimbursement' ? '审核意见（拒绝时必填）' : '审核意见（拒绝时必填）'} value={comment} onInput={e => setComment(e.detail.value)} />
          <View style={{ display: 'flex', marginTop: 16 }}>
            <View style={{ flex: 1, marginRight: 16 }}>
              <Button className="btn-danger" loading={busy} onClick={onReject}>驳回</Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button className="btn-primary" loading={busy} onClick={onApprove}>同意</Button>
            </View>
          </View>
        </View>
      )}
      {detail.pending && !detail.canAudit && (
        <View className="empty">您不是该模块负责人，仅可查看</View>
      )}
      <AppTabBar />
    </View>
  )
}

export default ApprovalDetail
