/* 小程序 H5 预览服务：静态托管 dist/h5（SPA fallback）+ /api 反代到生产后端。
   仅本地预览用，不进 CI/生产。启动：node scripts/preview-server.js → http://localhost:8090 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'dist', 'h5')
const TARGET_HOST = '120.27.143.175'
const PORT = 8090

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    // /api 反代到生产后端（保留方法/头/请求体）
    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      const headers = { ...req.headers, host: TARGET_HOST }
      delete headers['content-length']
      const pr = http.request(
        { host: TARGET_HOST, port: 80, path: req.url, method: req.method, headers },
        (r) => {
          res.writeHead(r.statusCode || 502, r.headers)
          r.pipe(res)
        },
      )
      pr.on('error', (e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`proxy error: ${e.message}`)
      })
      req.pipe(pr)
      return
    }
    // 静态文件 + SPA fallback
    let file = path.join(ROOT, urlPath)
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html')
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(PORT, () => console.log(`[preview] http://localhost:${PORT}`))
