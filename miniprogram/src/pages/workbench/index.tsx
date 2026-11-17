import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { getSummary, SummaryData } from '../../services/api'
import { getUser, getToken } from '../../services/session'
import AppTabBar from '../../components/AppTabBar'

const fmtMoney = (n: number) => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// 首页：经营概览 + 常用功能（上下班/报销置顶醒目）+ 更多入口
const Workbench = () => {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [updatedAt, setUpdatedAt] = useState('')
  const user = getUser()

  useDidShow(() => {
    if (!getToken()) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }
    getSummary()
      .then(d => {
        setSummary(d)
        setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
  })

  const todos = summary?.todos
  const pendingTotal = (todos?.reimbPending || 0) + (todos?.payPending || 0) + (todos?.recvPending || 0)
  const goModule = (key: string, child?: string) =>
    Taro.navigateTo({ url: `/pages/module?key=${key}${child ? `&child=${child}` : ''}` })

  const grid = [
    { icon: '✅', label: '审批中心', onClick: () => Taro.reLaunch({ url: '/pages/finance/index' }), badge: pendingTotal },
    { icon: '📦', label: '库存查询', onClick: () => goModule('warehouse', 'inventory') },
    { icon: '📷', label: '扫码查货', onClick: () => goModule('warehouse', 'scan') },
    { icon: '📋', label: '订单查询', onClick: () => Taro.reLaunch({ url: '/pages/order/index' }) },
    { icon: '🛒', label: '商机市场', onClick: () => Taro.reLaunch({ url: '/pages/market/index' }) },
    { icon: '➕', label: '查看更多', onClick: () => Taro.navigateTo({ url: '/pages/more/index' }) },
  ]

  return (
    <View style={{ paddingBottom: 140 }}>
      <View style={{ background: 'linear-gradient(135deg,#1677ff,#4096ff)', padding: '32px 32px 48px', color: '#fff' }}>
        <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 34, fontWeight: 600 }}>{user?.company_name || user?.name || user?.username || ''}</Text>
          <Text style={{ fontSize: 22, opacity: 0.85 }}>数据更新于 {updatedAt || '--'}</Text>
        </View>
      </View>

      {/* 本月经营卡 */}
      <View className="card" style={{ marginTop: -32, background: 'linear-gradient(135deg,#4096ff,#69b1ff)', color: '#fff' }}>
        <Text style={{ fontSize: 26, opacity: 0.9 }}>本月销售金额</Text>
        <Text style={{ fontSize: 56, fontWeight: 700, display: 'block', margin: '8px 0 16px' }}>
          {fmtMoney(summary?.month.salesAmount || 0)}
        </Text>
        <View style={{ display: 'flex' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 30, fontWeight: 600, display: 'block' }}>{summary?.month.orderCount ?? '—'}</Text>
            <Text style={{ fontSize: 22, opacity: 0.85 }}>本月订单</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 30, fontWeight: 600, display: 'block' }}>{summary?.today.orderCount ?? '—'}</Text>
            <Text style={{ fontSize: 22, opacity: 0.85 }}>今日订单</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 30, fontWeight: 600, display: 'block' }}>{fmtMoney(summary?.today.salesAmount || 0)}</Text>
            <Text style={{ fontSize: 22, opacity: 0.85 }}>今日销售额</Text>
          </View>
        </View>
      </View>

      {/* 常用功能：上下班 / 报销 置顶醒目 */}
      <View className="card">
        <View className="card-title">常用功能</View>
        <View style={{ display: 'flex', marginBottom: 8 }}>
          <View
            style={{ flex: 1, background: 'linear-gradient(135deg,#52c41a,#95de64)', borderRadius: 12, padding: '24px 0', textAlign: 'center', color: '#fff', marginRight: 12 }}
            onClick={() => goModule('hr', 'attendance')}
          >
            <Text style={{ fontSize: 44, display: 'block' }}>⏰</Text>
            <Text style={{ fontSize: 28, fontWeight: 600 }}>上下班打卡</Text>
          </View>
          <View
            style={{ flex: 1, background: 'linear-gradient(135deg,#fa8c16,#ffc069)', borderRadius: 12, padding: '24px 0', textAlign: 'center', color: '#fff' }}
            onClick={() => goModule('finance', 'reimburse')}
          >
            <Text style={{ fontSize: 44, display: 'block' }}>🧾</Text>
            <Text style={{ fontSize: 28, fontWeight: 600 }}>报销申请</Text>
          </View>
        </View>
        <View className="grid">
          {grid.map(g => (
            <View key={g.label} className="grid-item" onClick={g.onClick} style={{ position: 'relative', width: '33.33%' }}>
              <Text className="grid-icon">{g.icon}</Text>
              {!!(g as any).badge && (
                <Text style={{ position: 'absolute', top: 8, right: 40, background: '#f5222d', color: '#fff', borderRadius: 20, fontSize: 18, padding: '0 10px' }}>
                  {(g as any).badge}
                </Text>
              )}
              <View className="grid-label">{g.label}</View>
            </View>
          ))}
        </View>
      </View>

      {/* 待办 */}
      <View className="card" onClick={() => Taro.reLaunch({ url: '/pages/finance/index' })}>
        <View className="row">
          <Text className="card-title" style={{ marginBottom: 0 }}>待办事项</Text>
          <Text className={pendingTotal > 0 ? 'tag tag-red' : 'muted'}>
            {pendingTotal > 0 ? `${pendingTotal} 项待处理` : '无待办'}
          </Text>
        </View>
        <View className="row"><Text className="muted">报销待审</Text><Text>{todos?.reimbPending ?? 0}</Text></View>
        <View className="row"><Text className="muted">付款待审</Text><Text>{todos?.payPending ?? 0}</Text></View>
        <View className="row"><Text className="muted">收款待确认</Text><Text>{todos?.recvPending ?? 0}</Text></View>
      </View>

      <AppTabBar current="home" />
    </View>
  )
}

export default Workbench
