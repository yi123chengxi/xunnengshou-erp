import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getApprovals, ApprovalItem } from '../services/api'

const TABS = [
  { key: 'pending', label: '待我审' },
  { key: 'processed', label: '已处理' },
  { key: 'mine', label: '我发起' },
]
const TYPES = [
  { key: 'reimbursement', label: '报销' },
  { key: 'payment', label: '收/付款' },
] as const

const statusTag = (status: string) => {
  if (status === 'pending_review' || status === 'pending_confirm') return 'tag-orange'
  if (status === 'approved' || status === 'confirmed') return 'tag-blue'
  if (status === 'rejected') return 'tag-red'
  if (status === 'paid') return 'tag-green'
  return 'tag-gray'
}

// 审批中心内嵌视图：报销 / 收付款 两类单据的待审、已处理、我发起
const ApprovalsEmbed = ({ tick = 0 }: { tick?: number }) => {
  const [tab, setTab] = useState('pending')
  const [type, setType] = useState<'reimbursement' | 'payment'>('reimbursement')
  const [list, setList] = useState<ApprovalItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    getApprovals(type, tab)
      .then(d => setList(d.list))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [tab, type, tick])

  return (
    <View>
      <View className="segment" style={{ margin: '16px 24px 0' }}>
        {TABS.map(t => (
          <View key={t.key} className={`segment-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </View>
        ))}
      </View>
      <View style={{ display: 'flex', padding: '16px 24px 0' }}>
        {TYPES.map(t => (
          <Text
            key={t.key}
            className={`tag ${type === t.key ? 'tag-blue' : 'tag-gray'}`}
            style={{ marginRight: 16 }}
            onClick={() => setType(t.key)}
          >
            {t.label}
          </Text>
        ))}
      </View>

      {loaded && list.length === 0 && <View className="empty">暂无记录</View>}
      {list.map(it => (
        <View
          key={`${it.type}-${it.key}`}
          className="card"
          onClick={() => Taro.navigateTo({ url: `/pages/approval-detail/index?type=${it.type}&key=${encodeURIComponent(it.key)}` })}
        >
          {/* 横向四列：报销标题 | 金额 | 申请人 | 申请时间（单号与状态标签挂在首/末列） */}
          <View style={{ display: 'flex', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
              <Text style={{ display: 'block', fontWeight: 600, fontSize: 28, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.title || ((it as any).isReceipt ? '收款登记' : '付款申请')}
              </Text>
              <Text className="muted" style={{ display: 'block', fontSize: 22, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.no}</Text>
            </View>
            <Text className="amount" style={{ marginRight: 12, whiteSpace: 'nowrap' }}>¥{(it.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
            <Text className="muted" style={{ marginRight: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.applicantName || it.applicant}</Text>
            <View style={{ textAlign: 'right', flexShrink: 0 }}>
              <Text className="muted" style={{ display: 'block', fontSize: 22, whiteSpace: 'nowrap' }}>{it.time}</Text>
              <Text className={`tag ${statusTag(it.status)}`} style={{ marginTop: 4 }}>{it.statusText}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

export default ApprovalsEmbed
