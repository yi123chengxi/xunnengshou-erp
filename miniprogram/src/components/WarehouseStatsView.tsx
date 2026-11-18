import { useState } from 'react'
import { View, Text, Input } from '@tarojs/components'
import ListView from './ListView'

const TABS = [
  { key: 'stock', label: '备货', page: 'warehouseStock' },
  { key: 'pick', label: '配货', page: 'warehousePick' },
  { key: 'urgent', label: '急采', page: 'warehouseUrgent' },
  { key: 'note', label: '奖惩', page: 'warehouseNote' },
  { key: 'salary', label: '工资汇总', page: 'warehouseSalary' },
] as const

type TabKey = (typeof TABS)[number]['key']

const curMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 仓库统计：与 Web WarehouseStatsPage 同结构的多子页签移动版
 * （备货单统计/配货统计/急采统计/奖惩记录/工资汇总，工资汇总按月份聚合）
 */
const WarehouseStatsView = ({ tick = 0 }: { tick?: number }) => {
  const [tab, setTab] = useState<TabKey>('stock')
  const [month, setMonth] = useState(curMonth())
  const cur = TABS.find(t => t.key === tab) || TABS[0]
  return (
    <View>
      <View className="segment" style={{ margin: '16px 24px 0' }}>
        {TABS.map(t => (
          <View key={t.key} className={`segment-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </View>
        ))}
      </View>
      {tab === 'salary' && (
        <View style={{ display: 'flex', padding: '16px 24px 0', alignItems: 'center' }}>
          <Text className="muted" style={{ marginRight: 12, flexShrink: 0 }}>统计月份</Text>
          <Input
            className="input"
            style={{ flex: 1, marginBottom: 0 }}
            placeholder="YYYY-MM"
            value={month}
            onInput={e => setMonth(e.detail.value)}
          />
        </View>
      )}
      <ListView
        page={cur.page}
        extra={tab === 'salary' ? `m=${encodeURIComponent(month)}` : ''}
        tick={tick}
      />
    </View>
  )
}

export default WarehouseStatsView
