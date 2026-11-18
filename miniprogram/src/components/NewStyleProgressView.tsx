import { useState } from 'react'
import { View } from '@tarojs/components'
import ListView from './ListView'

// 与 Web NewStyleProgressPage 四页签同构：主表单/回传图片/到货款式/商品属性
const TABS = [
  { key: 'progress', label: '主表单', page: 'progress' },
  { key: 'photo', label: '回传图片', page: 'newstylePhoto' },
  { key: 'arrival', label: '到货款式', page: 'newstyleArrival' },
  { key: 'listing', label: '商品属性', page: 'newstyleListing' },
] as const

type TabKey = (typeof TABS)[number]['key']

// 各页签横向表头（与服务器下发 row 单元格顺序对应）
const HEADERS: Record<TabKey, string[]> = {
  progress: ['货号', '品牌', '数据完善', '创建人'],
  photo: ['货号', '图片接收', '预计上架', '创建人'],
  arrival: ['货号', '日期', '到货情况', '创建人'],
  listing: ['货号', '数据完善', '上架平台', '创建人'],
}

/**
 * 新款进度：与 Web NewStyleProgressPage 同结构的多子页签移动版，
 * 每个页签以横向表头表格展示与网页软件同一份数据。
 */
const NewStyleProgressView = ({ tick = 0 }: { tick?: number }) => {
  const [tab, setTab] = useState<TabKey>('progress')
  const cur = TABS.find(t => t.key === tab) || TABS[0]

  return (
    <View>
      <View className="segment" style={{ margin: '16px 24px 0' }}>
        {TABS.map(t => (
          <View
            key={t.key}
            className={`segment-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </View>
        ))}
      </View>
      <ListView page={cur.page} headers={HEADERS[tab]} tick={tick} />
    </View>
  )
}

export default NewStyleProgressView
