import { API_BASE } from '../services/config'

const ORIGIN = API_BASE.replace(/\/api$/, '')

/**
 * 是否本站 host。
 * 判定只认「生产域名 + 纯 IPv4（含历史数据里的裸 IP 与本机调试地址）」，
 * 其余一律视为外部 CDN，必须原样保留。
 */
const isOwnHost = (h: string): boolean => {
  const host = String(h || '').split(':')[0].toLowerCase()
  if (!host) return true // 无 host（相对路径）按本站处理
  if (/(^|\.)xns114\.com$/.test(host)) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/** 自有二进制统一改写到 /api/images/file/<去扩展名> 同源通道：
 *  面板 vhost 缺 /uploads 静态别名，且对 .jpg/.png 结尾的 URL 有正则拦截（一律劫持到站点根），
 *  带扩展名的历史地址必须去掉扩展名才能出图 */
const viaFileChannel = (rest: string): string =>
  `${API_BASE}/images/file/${rest.replace(/\.[a-z0-9]+$/i, '')}`

/**
 * 把记录里各种历史形态的图片地址统一归一为 weapp 可加载的地址：
 * - 本站（xns114.com / 裸 IP）：/uploads/images 与 /api/images/file 一律走同源 /api/images/file 通道并去扩展名
 * - 外部 CDN（阿里 1688 cbu01.alicdn.com、聚水潭 images.sursung.com 等）：**原样保留**
 * - data: / blob: / wxfile: 原样返回
 *
 * 外部 CDN 绝不能剥 host：发布记录里 20/31 的图片是直接引用电商平台的外链，
 * 曾经无条件 `replace(/^https?:\/\/[^/]+/, '')` 把它们改写成 https://www.xns114.com/img/...，
 * 线上表现为「网页版图片全部正常、小程序全部加载失败」，且与协议/白名单/云端缺失都无关。
 */
export const fullImageUrl = (u: string): string => {
  if (!u) return ''
  if (/^(data:|blob:|wxfile:\/\/|http:\/\/tmp\/)/i.test(u)) return u

  if (/^https?:\/\//i.test(u)) {
    // 必须用 match 取捕获组：replace 只替换匹配段，会把后面的路径留在字符串里，
    // 导致 host 变成 "xns114.com/api/images/file/..." 而判不进本站分支
    const hm = u.match(/^(https?:\/\/)([^/?#]*)(.*)$/i)
    const host = hm ? hm[2] : ''
    const rest = hm ? hm[3] : u
    if (!isOwnHost(host)) {
      // weapp 媒体通道禁止 http 明文外链，能升 https 的先升 https
      return /^http:\/\//i.test(u) ? `https://${host}${rest}` : u
    }
    const p = rest.split(/[?#]/)[0]
    const m = p.match(/^\/(?:uploads\/images|api\/images\/file)\/(.+)$/)
    if (m) return viaFileChannel(m[1])
    return ORIGIN + p
  }

  const m = u.match(/^\/(?:uploads\/images|api\/images\/file)\/(.+)$/)
  if (m) return viaFileChannel(m[1])
  if (u.startsWith('/')) return ORIGIN + u
  return u
}
