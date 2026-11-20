import { API_BASE } from '../services/config'

const ORIGIN = API_BASE.replace(/\/api$/, '')

/**
 * 把记录里各种历史形态的图片地址（相对路径 / http+IP / 裸域绝对 URL / data: / 微信临时文件）
 * 统一归一为 weapp 可加载的完整 HTTPS 地址：
 * - 自有二进制（/uploads/images/ 与 /api/images/file/）一律走 /api/images/file/<去扩展名> 同源通道
 * - 其余同源相对/绝对路径拼回生产域名；data:/blob:/wxfile: 原样返回
 */
export const fullImageUrl = (u: string): string => {
  if (!u) return ''
  if (/^(data:|blob:|wxfile:\/\/|http:\/\/tmp\/)/i.test(u)) return u
  let path = u
  if (/^https?:\/\//i.test(path)) path = path.replace(/^https?:\/\/[^/]+/i, '')
  const m = path.match(/^\/(?:uploads\/images|api\/images\/file)\/(.+)$/)
  if (m) return `${API_BASE}/images/file/${m[1].replace(/\.[a-z0-9]+$/i, '')}`
  if (path.startsWith('/')) return ORIGIN + path
  return u
}
