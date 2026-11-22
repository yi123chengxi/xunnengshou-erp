import { useState, useEffect } from 'react'
import './index.scss'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { getSummary, getDashboard, SummaryData, DashboardData, BoardMetrics } from '../../services/api'
import { getUser, getToken } from '../../services/session'
import { isPreviewMode } from '../../services/auth'
import { getFavs } from '../../services/favorites'
import { CHILD_ICONS, childTitle, openMenuChild, loadMenuPerms, childAllowed } from '../../config/menu'
import AppTabBar from '../../components/AppTabBar'
import PendingStatsCard from '../../components/PendingStatsCard'

/** 看板数值：服务端对无权限指标下发 null → 显示 — 而不是 0，避免「看起来像 0 业绩」；
    行内 style 数字在真机按真实 px 渲染，格宽有限，十万以上折成「万」防止长数字撑破格子 */
const fmtNum = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const v = Number(n) || 0
  if (Math.abs(v) >= 100000) return `${(v / 10000).toFixed(1)}万`
  return v.toLocaleString('zh-CN')
}
/** 金额短写：万元以上用「万」，卡片宽度有限时保证不折行 */
const fmtAmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const v = Number(n) || 0
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(2)}万`
  return `¥${v.toFixed(2)}`
}

/** 看板指标格：字号一律用 rpx 字符串（行内数字按真实 px 渲染且不随窗口缩放，rpx 才随屏宽自适应）；
    两列排布下六字中文标签在 24rpx 可完整一行显示 */
const BoardCell = ({ label, value, sub, onClick }: {
  label: string; value: string; sub?: string; onClick?: () => void
}) => (
  <View
    style={{ width: '50%', minWidth: 0, boxSizing: 'border-box', paddingRight: 16, marginBottom: 14 }}
    onClick={onClick}
  >
    <Text style={{ fontSize: '40rpx', fontWeight: 700, display: 'block', lineHeight: '52rpx', whiteSpace: 'nowrap' }}>{value}</Text>
    <Text style={{ fontSize: '24rpx', opacity: 0.9, display: 'block', marginTop: 2, whiteSpace: 'nowrap' }}>{label}</Text>
    {sub ? <Text style={{ fontSize: '22rpx', opacity: 0.72, display: 'block', whiteSpace: 'nowrap' }}>{sub}</Text> : null}
  </View>
)
/** 展开项：单列整行两端对齐；字号同样走 rpx 随窗口缩放 */
const BoardPair = ({ label, value }: { label: string; value: string }) => (
  <View style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0' }}>
    <Text style={{ fontSize: '26rpx', opacity: 0.85, flex: 1, minWidth: 0 }}>{label}</Text>
    <Text style={{ fontSize: '28rpx', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 12 }}>{value}</Text>
  </View>
)

// 首页：经营概览 + 常用功能（上下班/报销置顶醒目）+ 更多入口
const Workbench = () => {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [dash, setDash] = useState<DashboardData | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')
  // 菜单点权限：常用功能宫格中无权限的收藏入口隐藏（与网页版菜单可见性同源）
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    loadMenuPerms().then(setPerms)
  }, [])
  const user = getUser()

  useDidShow(() => {
    if (!getToken()) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }
    // 待办数沿用 /wx/summary；经营看板走 /wx/dashboard（服务端按网页版同口径计算并做权限裁剪）
    getSummary()
      .then(d => {
        setSummary(d)
        setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      })
      .catch(e => {
        // 布局预览模式（后端 /api/wx 未部署）不弹报错，仅展示结构
        if (!isPreviewMode()) Taro.showToast({ title: e.message, icon: 'none' })
      })
    getDashboard()
      .then(d => setDash(d && d.metrics ? d : null))
      .catch(() => {
        // 看板接口异常/未部署时静默：指标显示 —，不阻塞首页其他模块
      })
  })

  const todos = summary?.todos
  const m: BoardMetrics | undefined = dash?.metrics
  const pendingTotal = (todos?.reimbPending || 0) + (todos?.payPending || 0) + (todos?.recvPending || 0)
  const goModule = (key: string, child?: string) =>
    Taro.navigateTo({ url: `/pages/module/index?key=${key}${child ? `&child=${child}` : ''}` })

  // 常用功能宫格：收藏列表驱动（查看更多里 + 号添加），每行 4 个，末尾固定查看更多
  const favGrid: { id: string; icon: string; label: string; onClick: () => void; badge: number }[] =
    getFavs()
      .filter(id => childAllowed(perms || {}, id.split(':')[1] || ''))
      .map(id => {
      const [mk, ck] = id.split(':')
      return {
        id,
        icon: CHILD_ICONS[ck] || '📌',
        label: childTitle(id),
        onClick: () => openMenuChild(mk, ck),
        badge: ck === 'approvals' ? pendingTotal : 0,
      }
    })
  favGrid.push({ id: 'more', icon: '➕', label: '查看更多', onClick: () => Taro.navigateTo({ url: '/pages/more/index' }), badge: 0 })

  return (
    <View style={{ paddingBottom: 140 }}>
      {isPreviewMode() && (
        <View style={{ background: '#fff7e6', color: '#fa8c16', fontSize: 22, textAlign: 'center', padding: '8px 0' }}>
          布局预览模式：数据接口待部署后自动接入真实数据
        </View>
      )}
      <View style={{ background: 'linear-gradient(135deg,#1677ff,#4096ff)', padding: '24px 32px 52px', color: '#fff' }}>
        <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 32, fontWeight: 600 }}>{user?.company_name || user?.name || user?.username || ''}</Text>
          <Text style={{ fontSize: 20, opacity: 0.8 }}>更新于 {updatedAt || '--'}</Text>
        </View>
      </View>

      {/* 经营看板：生产（待生产/今日完工）+ 销售（今日已付款）+ 资金（银行流水收支）
          指标值全部由服务端计算下发，无权限的指标为 null → 显示 —；手机端不重复算口径，避免与网页版两个数 */}
      <View className="card" style={{ marginTop: -36, padding: '20px 24px', background: 'linear-gradient(135deg,#4096ff,#69b1ff)', color: '#fff' }}>
        <Text style={{ fontSize: '30rpx', opacity: 0.9 }}>经营看板（今日）</Text>
        <View style={{ display: 'flex', flexWrap: 'wrap', marginTop: 12 }}>
          <BoardCell
            label="待生产数量"
            value={fmtNum(m?.pendingQty)}
            sub={m?.pendingCount === null || m?.pendingCount === undefined ? undefined : `${m.pendingCount} 单待生产`}
            onClick={dash?.perm.productionOrder ? () => openMenuChild('production-mgmt', 'production-order') : undefined}
          />
          <BoardCell
            label="今日生产数量"
            value={fmtNum(m?.todayDoneQty)}
            sub={m?.todayDoneCount === null || m?.todayDoneCount === undefined ? undefined : `完工 ${m.todayDoneCount} 单`}
            onClick={dash?.perm.productionOrder ? () => openMenuChild('production-mgmt', 'production-order') : undefined}
          />
          <BoardCell
            label="今日销售数量"
            value={fmtNum(m?.todaySalesQty)}
            sub={m?.todaySalesCount === null || m?.todaySalesCount === undefined ? undefined : `${m.todaySalesCount} 单已付款`}
            onClick={dash?.perm.salesOrder ? () => openMenuChild('order', 'orders') : undefined}
          />
          <BoardCell
            label="今日收入金额"
            value={fmtAmt(m?.todayIncome)}
            onClick={dash?.perm.bankAccount ? () => openMenuChild('finance', 'bank-account') : undefined}
          />
          <BoardCell
            label="今日支出金额"
            value={fmtAmt(m?.todayExpense)}
            onClick={dash?.perm.bankAccount ? () => openMenuChild('finance', 'bank-account') : undefined}
          />
          <BoardCell
            label="本月销售金额"
            value={fmtAmt(m?.monthSalesAmount)}
            onClick={dash?.perm.salesOrder ? () => openMenuChild('order', 'orders') : undefined}
          />
        </View>
        <View
          style={{ borderTop: '1px solid rgba(255,255,255,0.25)', paddingTop: 8, display: 'flex', alignItems: 'center' }}
          onClick={() => setMoreOpen(v => !v)}
        >
          <Text style={{ fontSize: '26rpx', opacity: 0.9 }}>生产超期 {fmtNum(m?.overdueCount)} 单</Text>
          <Text style={{ fontSize: '24rpx', opacity: 0.75, marginLeft: 'auto' }}>{moreOpen ? '收起 ▲' : '更多指标 ▼'}</Text>
        </View>
        {moreOpen && (
          <View style={{ marginTop: 4 }}>
            <BoardPair label="本月销售额" value={fmtAmt(m?.monthSalesAmount)} />
            <BoardPair label="本月订单" value={m?.monthSalesCount === null || m?.monthSalesCount === undefined ? '—' : `${m.monthSalesCount} 单`} />
            <BoardPair label="本月收入" value={fmtAmt(m?.monthIncome)} />
            <BoardPair label="本月支出" value={fmtAmt(m?.monthExpense)} />
            <BoardPair label="账户余额" value={fmtAmt(m?.balanceTotal)} />
            <BoardPair label="银行账户" value={m?.accountCount === null || m?.accountCount === undefined ? '—' : `${m.accountCount} 户`} />
            <BoardPair label="超期订单" value={m?.overdueCount === null || m?.overdueCount === undefined ? '—' : `${m.overdueCount}单 / ${m.overdueRate}%`} />
            <BoardPair label="未排期数量" value={fmtNum(m?.unscheduledQty)} />
            <BoardPair label="近30天完工" value={fmtNum(m?.done30Qty)} />
            <BoardPair label="全部生产单" value={m?.allOrderCount === null || m?.allOrderCount === undefined ? '—' : `${m.allOrderCount} 单`} />
            <BoardPair label="计划总量" value={fmtNum(m?.planQtyAll)} />
          </View>
        )}
      </View>

      {/* 常用功能：上下班 / 报销 置顶（横向矮卡） */}
      <View className="card" style={{ padding: '20px 24px' }}>
        <View className="card-title" style={{ fontSize: 28, marginBottom: 12 }}>常用功能</View>
        <View style={{ display: 'flex', marginBottom: 4 }}>
          <View
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#52c41a,#95de64)', borderRadius: 12, padding: '16px 0', color: '#fff', marginRight: 12 }}
            onClick={() => goModule('hr', 'attendance')}
          >
            <Text style={{ fontSize: 26, fontWeight: 600, lineHeight: '40px' }}>上下班打卡</Text>
          </View>
          <View
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#fa8c16,#ffc069)', borderRadius: 12, padding: '16px 0', color: '#fff' }}
            onClick={() => goModule('finance', 'reimburse')}
          >
            <Text style={{ fontSize: 26, fontWeight: 600, lineHeight: '40px' }}>报销申请</Text>
          </View>
        </View>
        <View className="grid">
          {favGrid.map(g => (
            <View
              key={g.id}
              className="grid-item"
              onClick={g.onClick}
              style={{
                position: 'relative',
                width: 'calc(25% - 12px)',
                margin: '0 6px 10px',
                border: '1px solid #e5e6eb',
                borderRadius: 8,
                boxSizing: 'border-box',
              }}
            >
              {g.icon.includes('.') ? (
                /* 图片图标对齐表情图标：表情 .grid-icon 为 font-size 36 / line-height 44（scss px 即 rpx），
                   行内 style 的数字按真实 px 渲染（约 2 倍），故此处必须显式带 rpx 单位才能同高 */
                <View style={{ height: '44rpx', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Image src={g.icon} style={{ width: '36rpx', height: '36rpx', display: 'block' }} mode="aspectFit" />
                </View>
              ) : (
                <Text className="grid-icon">{g.icon}</Text>
              )}
              {!!g.badge && (
                <Text style={{ position: 'absolute', top: 4, right: 4, background: '#f5222d', color: '#fff', borderRadius: 10, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
                  {g.badge}
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

      {/* 生产管理-待生产数据统计（与网页版同口径同配色）；无权限时服务端不下发，整块不渲染 */}
      <PendingStatsCard data={dash?.pendingStats ?? null} />

      <AppTabBar current="home" />
    </View>
  )
}

export default Workbench
