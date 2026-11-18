import { useState, useEffect } from 'react'
import { View, Text, ScrollView, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { findModule } from '../config/menu'
import ApprovalsEmbed from './ApprovalsEmbed'
import InventoryEmbed from './InventoryEmbed'
import OrdersEmbed from './OrdersEmbed'
import ReimburseForm from './ReimburseForm'
import AttendanceView from './AttendanceView'
import LeaveView from './LeaveView'
import ListView from './ListView'
import BookkeepingView from './BookkeepingView'
import WarehouseStatsView from './WarehouseStatsView'
import NewStyleProgressView from './NewStyleProgressView'
import MarketView from './MarketView'

// 扫码入口视图：扫码后回调把关键字交给库存查询子菜单
const ScanLauncher = ({ onScanned }: { onScanned: (code: string) => void }) => {
  const onScan = async () => {
    try {
      const res = await Taro.scanCode({ scanType: ['barCode', 'qrCode'] })
      const code = String(res.result || '').trim()
      if (!code) {
        Taro.showToast({ title: '未识别到内容', icon: 'none' })
        return
      }
      onScanned(code)
    } catch { /* 用户取消 */ }
  }
  return (
    <View style={{ padding: '80px 48px', textAlign: 'center' }}>
      <Text style={{ fontSize: 96, display: 'block' }}>📷</Text>
      <Text className="muted" style={{ display: 'block', margin: '24px 0 48px' }}>扫描商品条码或款号二维码，快速查询商品与库存</Text>
      <Button className="btn-primary" onClick={onScan}>开始扫码</Button>
    </View>
  )
}

/**
 * 模块容器：主菜单 → 默认第一子菜单；底部子菜单条切换。
 * 子菜单条固定在底部 Tab 栏上方，任何子菜单页面都在同一容器内切换。
 */
const ModuleView = ({
  moduleKey, initialChild, initialQ, tick = 0,
}: { moduleKey: string; initialChild?: string; initialQ?: string; tick?: number }) => {
  const mod = findModule(moduleKey)
  const [child, setChild] = useState(() =>
    initialChild && mod?.children.some(c => c.key === initialChild) ? initialChild : (mod?.children[0]?.key || ''))
  const [scanQ, setScanQ] = useState(initialQ || '')
  // 底部子菜单条须钉在 Tab 栏正上方：Tab 栏实际高度受字号/安全区影响，
  // 硬编码偏移会在部分端被遮挡，改为挂载后实测 .app-tab-bar 高度再定位
  const [tabBarH, setTabBarH] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => {
      Taro.createSelectorQuery()
        .select('.app-tab-bar')
        .boundingClientRect((rect: any) => {
          if (rect && rect.height) setTabBarH(rect.height)
        })
        .exec()
    }, 60)
    return () => clearTimeout(t)
  }, [])

  // 模块页 params 晚于首次挂载到达：惰性初始化器拿不到，须在其后同步一次
  useEffect(() => {
    const m = findModule(moduleKey)
    if (initialChild && m?.children.some(c => c.key === initialChild)) setChild(initialChild)
    else if (m && !m.children.some(c => c.key === child)) setChild(m.children[0]?.key || '')
    if (initialQ) setScanQ(initialQ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey, initialChild, initialQ])

  if (!mod) return <View className="empty">菜单不存在</View>

  const renderChild = () => {
    switch (child) {
      case 'approvals': return <ApprovalsEmbed tick={tick} />
      case 'reimburse': return <ReimburseForm embedded />
      case 'orders': return <OrdersEmbed tick={tick} />
      case 'inventory':
      case 'products': return <InventoryEmbed tick={tick} initialQ={scanQ} />
      case 'scan': return <ScanLauncher onScanned={code => { setScanQ(code); setChild('inventory') }} />
      case 'attendance': return <AttendanceView tick={tick} />
      case 'leave': return <LeaveView tick={tick} />
      // 以下子菜单与 Web 同页面同源数据，服务端 /wx/lists/:page 映射展示结构
      case 'bookkeeping': return <BookkeepingView tick={tick} />
      case 'production': return <ListView page="production" tick={tick} />
      case 'purchase': return <ListView page="purchase" tick={tick} />
      case 'progress': return <NewStyleProgressView tick={tick} />
      case 'shop-management': return <ListView page="shops" tick={tick} />
      case 'warehouse-stats': return <WarehouseStatsView tick={tick} />
      case 'manage': return <ListView page="brands" tick={tick} />
      case 'staff': return <ListView page="staff" tick={tick} />
      case 'customers': return <ListView page="customers" tick={tick} />
      case 'opportunity': return <MarketView tick={tick} />
      case 'finished':
      case 'semi':
      case 'mold': return <MarketView fixedType={child as 'finished' | 'semi' | 'mold'} tick={tick} />
      default: return <View className="empty">「{mod.children.find(c => c.key === child)?.title || child}」功能迁移中，请先使用网页端</View>
    }
  }

  return (
    <View style={{ paddingBottom: 340 }}>
      <View style={{ padding: '20px 24px 0', fontWeight: 600, fontSize: 32 }}>{mod.icon} {mod.title}</View>
      {renderChild()}
      {/* 底部子菜单条：固定在 Tab 栏上方（实测高度定位，未测得前用 96px 兜底） */}
      <View
        style={{
          position: 'fixed', left: 0, right: 0, bottom: tabBarH ? `${tabBarH}px` : 'calc(96px + env(safe-area-inset-bottom))', zIndex: 190,
          background: '#fff', borderTop: '1px solid #ebedf0', boxShadow: '0 -2px 8px rgba(31,39,51,0.05)',
        }}
      >
        <ScrollView scrollX style={{ whiteSpace: 'nowrap', padding: '12px 16px' }}>
          {mod.children.map(c => (
            <Text
              key={c.key}
              className={`tag ${child === c.key ? 'tag-blue' : 'tag-gray'}`}
              style={{ marginRight: 12, fontSize: 26, lineHeight: '48px', padding: '0 24px' }}
              onClick={() => setChild(c.key)}
            >
              {c.title}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

export default ModuleView
