#!/bin/bash
# 工厂管理系统 - 增量更新脚本（GitHub Actions 部署调用，也可服务器手动执行）
# 保留运行时数据: server/.env、server/data、server/uploads、server/downloads、logs
set -e
APP=/var/www/factory-management
SRC="$(cd "$(dirname "$0")" && pwd)"

command -v rsync >/dev/null 2>&1 || apt-get install -y rsync

mkdir -p "$APP/server" "$APP/client" "$APP/logs"

# 部署包结构自检：后端入口产物必须在外层（防 cp 嵌套致 pkg/server/server 旧包上线）
if [ ! -f "$SRC/server/dist/app.js" ]; then
  echo "FATAL: 部署包异常，缺 server/dist/app.js，中止更新" >&2
  exit 1
fi

# 备份 .env
if [ -f "$APP/server/.env" ]; then cp -a "$APP/server/.env" /tmp/factory-env.bak; fi

echo "[1/5] 同步后端代码与预编译产物..."
rsync -a --delete \
  --exclude node_modules --exclude .env --exclude data \
  --exclude uploads --exclude downloads --exclude logs \
  "$SRC/server/" "$APP/server/"

echo "[2/5] 同步前端构建产物..."
rsync -a --delete "$SRC/client/build/" "$APP/client/build/"

echo "[3/5] 同步配置..."
cp "$SRC/ecosystem.config.js" "$APP/"
# nginx 站点安装：两套链路都投递，机器上没有哪套就跳过哪套。
# 关键坑：装了宝塔面板后，nginx 跑的是 /www/server/nginx 且主配置只
# include /www/server/panel/vhost/nginx/*.conf，完全不读 /etc/nginx/sites-enabled，
# 于是仅维护 sites-available 会让“CI 全绿但线上 /api 全 404”（面板默认站点接管 80 端口）。
BT_VHOST=/www/server/panel/vhost/nginx
BT_BAK=/root/nginx-vhost-backup
if [ -d /etc/nginx/sites-available ] && [ -f "$SRC/nginx/factory-management.conf" ]; then
  cp "$SRC/nginx/factory-management.conf" /etc/nginx/sites-available/factory-management
  [ -d /etc/nginx/sites-enabled ] && ln -sf /etc/nginx/sites-available/factory-management /etc/nginx/sites-enabled/factory-management || true
fi
if [ -d "$BT_VHOST" ] && [ -f "$SRC/nginx/baota-ip-default.conf" ]; then
  mkdir -p "$BT_BAK"
  # 必须补 || true：脚本开了 set -e，首次安装时旧文件不存在会让这一行把整个部署带崩
  [ -f "$BT_VHOST/0.default.conf" ] && cp -a "$BT_VHOST/0.default.conf" "$BT_BAK/0.default.conf.$(date +%Y%m%d-%H%M%S).bak" || true
  cp "$SRC/nginx/baota-ip-default.conf" "$BT_VHOST/0.default.conf"
fi
if [ -f /tmp/factory-env.bak ]; then cp -a /tmp/factory-env.bak "$APP/server/.env"; rm -f /tmp/factory-env.bak; fi
mkdir -p "$APP/server/uploads" "$APP/server/downloads" "$APP/server/data" "$APP/logs"

echo "[4/5] 更新后端运行时依赖..."
cd "$APP/server"
# npm ci 会先删 node_modules 再装；一旦安装失败（原生模块取不到预编译包回退源码编译、
# 或与其它部署进程互踩），线上就会停在半安装状态——而 app.ts 无条件 import better-sqlite3，
# 进程下次重启（pm2 restart / 宕机自愈 / 服务器重启）就会起不来。
# 因此先把旧依赖整体挪到备份：装成功才删备份，装失败则原样回滚并中止本次部署。
if [ -d node_modules ]; then
  rm -rf .node_modules.bak
  mv node_modules .node_modules.bak
fi
if npm ci --omit=dev || npm install --omit=dev; then
  rm -rf .node_modules.bak
else
  rm -rf node_modules
  if [ -d .node_modules.bak ]; then mv .node_modules.bak node_modules; fi
  echo "FATAL: 后端依赖安装失败，已回滚上一份 node_modules，本次部署中止（服务继续跑旧进程）" >&2
  exit 1
fi

echo "[5/5] 重载服务..."
# nginx 门控：校验或 reload 失败则回滚宝塔 IP 站点（保留上一份可用配置）并中止本次部署，
# 不允许“代码已上线但 Web 入口坏掉”的半成功状态。
# 必须用“读那一份生效配置的那个 nginx 二进制”做校验：宝塔的 nginx 编译 prefix 指向
# /www/server/nginx/conf，只有它能验到面板 vhost；若误用系统 nginx 验另一份配置，
# 就会出现“校验通过但站点从未重载”的假成功。
NGINX_BIN=nginx
[ -x /www/server/nginx/sbin/nginx ] && NGINX_BIN=/www/server/nginx/sbin/nginx
reload_nginx() {
  "$NGINX_BIN" -s reload 2>/dev/null && return 0
  systemctl reload nginx 2>/dev/null && return 0
  service nginx reload >/dev/null 2>&1 && return 0
  return 1
}
NGX_ERR=/tmp/nginx-t.err
NGX_OK=1
if "$NGINX_BIN" -t 2>"$NGX_ERR"; then
  reload_nginx || NGX_OK=0
else
  NGX_OK=0
fi
if [ "$NGX_OK" -ne 1 ]; then
  LAST_BAK=$(ls -t "$BT_BAK"/0.default.conf.*.bak 2>/dev/null | head -1 || true)
  if [ -n "$LAST_BAK" ] && [ -d "$BT_VHOST" ]; then
    cp -a "$LAST_BAK" "$BT_VHOST/0.default.conf"
    "$NGINX_BIN" -t >/dev/null 2>&1 && reload_nginx || true
  fi
  echo "FATAL: nginx 配置校验/重载失败，已回滚站点配置，本次部署中止：" >&2
  cat "$NGX_ERR" >&2 || true
  exit 1
fi
cd "$APP"
if pm2 describe factory-management-server >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js
else
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup systemd -u root --hp /root > /tmp/pm2startup.sh 2>&1 && bash /tmp/pm2startup.sh || true
fi
pm2 save

# 部署后入口自检：80 端口 IP 入口的 /api 必须可达（存量客户端与旧书签都按 IP 连），
# 探不到说明面板接管了默认站点，必须让部署失败而不是静默上线
sleep 3
API_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/api/health || echo 000)
if [ "$API_CODE" != "200" ]; then
  echo "FATAL: 入口自检失败 http://127.0.0.1/api/health -> $API_CODE（预期 200）" >&2
  exit 1
fi
echo "ENTRY_OK http://<ip>/api/health -> 200"
# 域名入口由面板站点维护（不在本脚本投递范围），探测结果只作提醒不作卡点
DOM_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve www.xns114.com:443:127.0.0.1 https://www.xns114.com/api/health || echo 000)
echo "PROBE https://www.xns114.com/api/health -> $DOM_CODE"
echo "UPDATE_OK $(date '+%F %T')"
