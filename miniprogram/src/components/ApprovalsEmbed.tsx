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
          style={{ padding: '16px 24px' }}
          onClick={() => Taro.navigateTo({ url: `/pages/approval-detail/index?type=${it.type}&key=${encodeURIComponent(it.key)}` })}
        >
          {/* 两行卡：第一行 标题左（最多5个中文字，多余隐藏）+ 金额右；第二行 时间·申请人·单号 + 状态标签；字体与金额一致 */}
          <View style={{ display: 'flex', alignItems: 'center' }}>
            <Text style={{ flex: 1, minWidth: 0, maxWidth: 105, fontWeight: 600, fontSize: 21, lineHeight: '28px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.title || ((it as any).isReceipt ? '收款登记' : '付款申请')}
            </Text>
            <Text className="amount" style={{ fontSize: 21, marginLeft: 12, whiteSpace: 'nowrap' }}>¥{(it.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
          </View>
          <View style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
            <Text className="muted" style={{ flex: 1, minWidth: 0, fontSize: 21, lineHeight: '28px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.time}{(it.applicantName || it.applicant) ? ` · ${it.applicantName || it.applicant}` : ''}{it.no ? ` · ${it.no}` : ''}
            </Text>
            <Text className={`tag ${statusTag(it.status)}`} style={{ marginLeft: 12, flexShrink: 0, fontSize: 21, lineHeight: '28px', padding: '0 8px' }}>{it.statusText}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

export default ApprovalsEmbed
