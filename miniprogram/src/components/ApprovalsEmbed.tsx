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
          <View className="row">
            <Text style={{ fontWeight: 600 }}>{it.no}</Text>
            <Text className={`tag ${statusTag(it.status)}`}>{it.statusText}</Text>
          </View>
          <View className="row">
            <Text className="muted">{it.title || ((it as any).isReceipt ? '收款登记' : '付款申请')}</Text>
            <Text className="amount">¥{(it.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
          </View>
          <View className="row">
            <Text className="muted">{it.applicantName || it.applicant}</Text>
            <Text className="muted">{it.time}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

export default ApprovalsEmbed
