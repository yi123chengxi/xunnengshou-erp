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
if [ -f "$SRC/nginx/factory-management.conf" ]; then
  cp "$SRC/nginx/factory-management.conf" /etc/nginx/sites-available/factory-management
fi
if [ -f /tmp/factory-env.bak ]; then cp -a /tmp/factory-env.bak "$APP/server/.env"; rm -f /tmp/factory-env.bak; fi
mkdir -p "$APP/server/uploads" "$APP/server/downloads" "$APP/server/data" "$APP/logs"

echo "[4/5] 更新后端运行时依赖..."
cd "$APP/server"
npm ci --omit=dev || npm install --omit=dev

echo "[5/5] 重载服务..."
nginx -t && systemctl reload nginx
cd "$APP"
if pm2 describe factory-management-server >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js
else
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup systemd -u root --hp /root > /tmp/pm2startup.sh 2>&1 && bash /tmp/pm2startup.sh || true
fi
pm2 save
echo "UPDATE_OK $(date '+%F %T')"
