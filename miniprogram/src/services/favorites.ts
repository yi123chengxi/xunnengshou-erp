import Taro from '@tarojs/taro'

// 首页常用功能收藏列表（存储格式：`${moduleKey}:${childKey}`）
const KEY = 'wx_fav_menus'

export const DEFAULT_FAVS = [
  'finance:approvals',
  'warehouse:inventory',
  'warehouse:scan',
  'order:orders',
  'market:finished',
]

export const getFavs = (): string[] => {
  try {
    const v = Taro.getStorageSync(KEY)
    return Array.isArray(v) && v.length ? v : [...DEFAULT_FAVS]
  } catch {
    return [...DEFAULT_FAVS]
  }
}

export const setFavs = (list: string[]): void => {
  try { Taro.setStorageSync(KEY, list) } catch { /* ignore */ }
}

/** 切换收藏：返回切换后是否为收藏 */
export const toggleFav = (id: string): boolean => {
  const list = getFavs()
  const i = list.indexOf(id)
  if (i >= 0) {
    list.splice(i, 1)
    setFavs(list)
    return false
  }
  list.push(id)
  setFavs(list)
  return true
}

export const isFav = (id: string): boolean => getFavs().includes(id)
