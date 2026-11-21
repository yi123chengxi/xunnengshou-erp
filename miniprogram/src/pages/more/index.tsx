import { useState } from 'react'
import './index.scss'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { MODULES, CHILD_ICONS, openMenuChild } from '../../config/menu'
import { isFav, toggleFav } from '../../services/favorites'
import AppTabBar from '../../components/AppTabBar'

// 更多：全部功能卡片式展示；卡片右上角 + 号加入/移出首页常用功能
// 字号按用户要求整体缩小 30%：行内数字在 weapp 按真实 px 渲染（不挂定义字号的类，否则类会压过行内值）
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
          <Text style={{ fontWeight: 600, fontSize: 21 }}>{m.icon} {m.title}</Text>
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
                    {(CHILD_ICONS[c.key] || '').includes('.') ? (
                      /* 与表情图标等高对齐：表情行高 34，图形本体 25 居中（随字号同步缩小 30%） */
                      <View style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                        <Image src={CHILD_ICONS[c.key]} style={{ width: 25, height: 25, display: 'block' }} mode="aspectFit" />
                      </View>
                    ) : (
                      <Text style={{ fontSize: 28, display: 'block', lineHeight: '34px' }}>{CHILD_ICONS[c.key] || '📌'}</Text>
                    )}
                    <Text style={{ fontSize: 17, color: '#5a6d85' }}>{c.title}</Text>
                    <Text
                      style={{ position: 'absolute', top: 4, right: 6, fontSize: 21, lineHeight: '25px', width: 28, textAlign: 'center', color: fav ? '#52c41a' : '#1677ff', fontWeight: 700 }}
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
