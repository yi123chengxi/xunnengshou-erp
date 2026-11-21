// API 基址：H5 端一律同源相对 /api（预览服务/nginx 负责反代）；
// weapp 一律走已备案 HTTPS 域名——开发期同样如此，不再用「http + 裸 IP」直连：
// 小程序的媒体资源（image/video/预览）通道要求 HTTPS 且域名可加白，IP 无法进合法域名列表，
// 开发者工具关掉校验也只豁免 wx.request，图片仍会静默加载失败；
// 同一台服务器（120.27.143.175）的 443 已验证可用（/api/health 返回 200），改走域名不改变数据环境
export const API_BASE =
  process.env.TARO_ENV === 'h5'
    ? '/api'
    : 'https://www.xns114.com/api'
