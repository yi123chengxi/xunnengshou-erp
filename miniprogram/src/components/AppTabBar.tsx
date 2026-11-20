import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { onChatUnread } from '../services/chatBadge'

// 底部固定 Tab：任何页面都渲染同一组按键（首页/财务/市场/订单/我的）
const TABS = [
  { key: 'home', label: '首页', icon: '🏠', path: '/pages/workbench/index' },
  { key: 'finance', label: '财务', icon: '💰', path: '/pages/finance/index' },
  { key: 'market', label: '市场', icon: '🛒', path: '/pages/market/index' },
  { key: 'order', label: '订单', icon: '📋', path: '/pages/order/index' },
  { key: 'mine', label: '我的', icon: '👤', path: '/pages/mine/index' },
]

// 「我的」键未读气泡：订阅 chatBadge 广播（接口未部署/未登录时静默为 0）
const AppTabBar = ({ current }: { current?: string }) => {
  const [unread, setUnread] = useState(0)
  useEffect(() => onChatUnread(setUnread), [])

  return (
    <View
      className="app-tab-bar"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 200,
        background: '#fff', borderTop: '1px solid #ebedf0',
        display: 'flex', padding: '6px 0 calc(6px + env(safe-area-inset-bottom))',
      }}
    >
      {TABS.map(t => (
        <View
          key={t.key}
          style={{ position: 'relative', flex: 1, textAlign: 'center' }}
          onClick={() => { if (t.key !== current) Taro.reLaunch({ url: t.path }) }}
        >
          {t.key === 'mine' && unread > 0 ? (
            <Text
              style={{
                position: 'absolute', top: -3, left: '50%', marginLeft: 6, zIndex: 2,
                minWidth: 17, height: 17, lineHeight: '17px', padding: '0 4px',
                borderRadius: 9, background: '#ff4d4f', color: '#fff', fontSize: 10,
                textAlign: 'center', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap',
              }}
            >
              {unread > 99 ? '99+' : unread}
            </Text>
          ) : null}
          <Text style={{ fontSize: 32, display: 'block', lineHeight: '34px' }}>{t.icon}</Text>
          <Text style={{ fontSize: 18, lineHeight: '24px', color: current === t.key ? '#1677ff' : '#8a94a6', fontWeight: current === t.key ? 600 : 400 }}>
            {t.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

export default AppTabBar
