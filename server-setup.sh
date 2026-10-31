#!/bin/bash
# 工厂管理系统 - 服务器一键部署脚本（Ubuntu 24.04）
# 用法: bash server-setup.sh   （部署包已解压到 /root/factory-deploy 或当前目录）
set -e
APP_DIR=/var/www/factory-management
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/8] 安装系统依赖..."
apt-get update -y
apt-get install -y nginx curl ca-certificates gnupg python3 make g++ rsync

echo "[2/8] 安装 Node.js 20.x ..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v; npm -v
npm install -g pm2

echo "[3/8] 部署应用到 $APP_DIR ..."
mkdir -p "$APP_DIR"
cp -r "$SRC_DIR/." "$APP_DIR/"
mkdir -p "$APP_DIR/logs" "$APP_DIR/server/uploads" "$APP_DIR/server/downloads" "$APP_DIR/server/data"

echo "[4/8] 安装后端运行时依赖..."
cd "$APP_DIR/server"
npm ci --omit=dev || npm install --omit=dev

echo "[5/8] 初始化环境变量..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ! 已生成 .env，请稍后编辑填入真实密钥: $APP_DIR/server/.env"
else
  echo "  .env 已随包携带"
fi

echo "[6/8] 配置 Nginx..."
cp "$APP_DIR/nginx/factory-management.conf" /etc/nginx/sites-available/factory-management
ln -sf /etc/nginx/sites-available/factory-management /etc/nginx/sites-enabled/factory-management
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "[7/8] PM2 启动后端..."
cd "$APP_DIR"
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root > /tmp/pm2startup.sh 2>&1 && bash /tmp/pm2startup.sh || true

echo "[8/8] 完成。服务状态:"
pm2 ls
systemctl is-active nginx
IP=$(curl -s --max-time 5 ifconfig.me || echo "<公网IP>")
echo ""
echo "部署完成! 访问: http://$IP"
echo "后端日志: pm2 logs factory-management-server"