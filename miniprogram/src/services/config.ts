// API 基址：H5 端一律同源相对 /api（预览服务/nginx 负责反代）；
// weapp 生产走已备案 HTTPS 域名（微信小程序 request 合法域名要求），
// weapp 开发期在微信开发者工具勾选「不校验合法域名」后直连生产 IP 调试
export const API_BASE =
  process.env.TARO_ENV === 'h5'
    ? '/api'
    : process.env.NODE_ENV === 'production'
      ? 'https://www.xns114.com/api'
      : 'http://120.27.143.175/api'
