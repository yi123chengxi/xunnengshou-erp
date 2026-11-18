import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { MODULES, CHILD_ICONS, openMenuChild } from '../../config/menu'
import { isFav, toggleFav } from '../../services/favorites'
import AppTabBar from '../../components/AppTabBar'

// 更多：全部功能卡片式展示；卡片右上角 + 号加入/移出首页常用功能
const More = () => {
  const [, setTick] = useState(0)

  const onToggle = (id: string, title: string) => {
    const added = toggleFav(id)
    Taro.showToast({ title: added ? `已加入常用：${title}` : `已从常用移除：${title}`, icon: 'none' })
    setTick(t => t + 1)
  }

  return (
    <View style={{ paddingBottom: 140 }}>
      {MODULES.map(m => (
        <View key={m.key} style={{ padding: '20px 24px 0' }}>
          <Text style={{ fontWeight: 600, fontSize: 30 }}>{m.icon} {m.title}</Text>
          <View style={{ display: 'flex', flexWrap: 'wrap', marginTop: 12 }}>
            {m.children.map(c => {
              const id = `${m.key}:${c.key}`
              const fav = isFav(id)
              return (
                <View key={c.key} style={{ width: '33.33%', boxSizing: 'border-box', padding: '0 12px 14px 0' }}>
                  <View
                    style={{ position: 'relative', background: '#fff', borderRadius: 12, padding: '22px 0', textAlign: 'center', boxShadow: '0 2px 8px rgba(31,39,51,0.06)' }}
                    onClick={() => openMenuChild(m.key, c.key)}
                  >
                    <Text style={{ fontSize: 40, display: 'block', lineHeight: '48px' }}>{CHILD_ICONS[c.key] || '📌'}</Text>
                    <Text style={{ fontSize: 24, color: '#5a6d85' }}>{c.title}</Text>
                    <Text
                      style={{ position: 'absolute', top: 4, right: 6, fontSize: 30, lineHeight: '36px', width: 40, textAlign: 'center', color: fav ? '#52c41a' : '#1677ff', fontWeight: 700 }}
                      onClick={(e: any) => { e.stopPropagation(); onToggle(id, c.title) }}
                    >
                      {fav ? '✓' : '+'}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        </View>
      ))}
      <View className="muted" style={{ textAlign: 'center', padding: '8px 0 0' }}>
        点卡片打开功能；点右上角 + 加入/移出首页常用
      </View>
      <AppTabBar />
    </View>
  )
}

export default More
