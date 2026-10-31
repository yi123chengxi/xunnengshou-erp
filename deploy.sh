#!/bin/bash

# ============================================================================
# 工厂管理系统 - 阿里云一键部署脚本
# 适用于 Ubuntu 22.04 LTS / CentOS 8+
# ============================================================================

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否以 root 运行
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用 sudo 运行此脚本"
        exit 1
    fi
}

# 检测操作系统
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
    else
        log_error "无法检测操作系统版本"
        exit 1
    fi
    log_info "检测到操作系统: $OS $VER"
}

# 安装 Node.js 18.x
install_nodejs() {
    log_info "安装 Node.js 18.x..."
    
    if [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    elif [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
        yum install -y nodejs
    else
        log_error "不支持的操作系统: $OS"
        exit 1
    fi
    
    log_info "Node.js 版本: $(node --version)"
    log_info "npm 版本: $(npm --version)"
}

# 安装 PM2
install_pm2() {
    log_info "安装 PM2 进程管理器..."
    npm install -g pm2
    log_info "PM2 版本: $(pm2 --version)"
}

# 安装 Nginx
install_nginx() {
    log_info "安装 Nginx..."
    
    if [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
        apt-get install -y nginx
    elif [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]]; then
        yum install -y epel-release
        yum install -y nginx
    fi
    
    systemctl enable nginx
    systemctl start nginx
    log_info "Nginx 已安装并启动"
}

# 安装 Git
install_git() {
    log_info "安装 Git..."
    
    if [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
        apt-get install -y git
    elif [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]]; then
        yum install -y git
    fi
    
    log_info "Git 版本: $(git --version)"
}

# 创建应用目录
setup_directories() {
    log_info "创建应用目录..."
    
    APP_DIR="/var/www/factory-management"
    mkdir -p "$APP_DIR"
    
    # 创建日志目录
    mkdir -p "$APP_DIR/logs"
    
    # 创建上传文件目录
    mkdir -p "$APP_DIR/server/uploads"
    
    # 设置权限
    chown -R $SUDO_USER:$SUDO_USER "$APP_DIR"
    
    log_info "目录结构创建完成"
}

# 克隆代码
clone_repository() {
    APP_DIR="/var/www/factory-management"
    
    if [ -d "$APP_DIR/.git" ]; then
        log_warn "代码仓库已存在，执行 git pull..."
        cd "$APP_DIR"
        sudo -u $SUDO_USER git pull
    else
        log_info "克隆代码仓库..."
        read -p "请输入 GitHub 仓库地址: " REPO_URL
        cd "$APP_DIR"
        sudo -u $SUDO_USER git clone "$REPO_URL" .
    fi
}

# 配置后端
setup_backend() {
    APP_DIR="/var/www/factory-management"
    
    log_info "配置后端服务..."
    cd "$APP_DIR/server"
    
    # 安装依赖
    sudo -u $SUDO_USER npm install --production
    
    # 配置环境变量
    if [ ! -f .env ]; then
        sudo -u $SUDO_USER cp .env.example .env
        log_warn "请编辑 $APP_DIR/server/.env 文件，配置实际的环境变量"
        log_warn "特别是: JWT_SECRET, ALIYUN_ACCESS_KEY_ID, VAPID_KEYS 等"
    fi
    
    # 编译 TypeScript
    log_info "编译 TypeScript..."
    cd "$APP_DIR/server"
    sudo -u $SUDO_USER npm run build
    
    log_info "后端配置完成"
}

# 构建前端
setup_frontend() {
    APP_DIR="/var/www/factory-management"
    
    log_info "构建前端..."
    cd "$APP_DIR/client"
    
    # 安装依赖
    sudo -u $SUDO_USER npm install
    
    # 构建生产版本
    sudo -u $SUDO_USER npm run build
    
    log_info "前端构建完成"
}

# 配置 Nginx
setup_nginx() {
    APP_DIR="/var/www/factory-management"
    
    log_info "配置 Nginx..."
    
    read -p "请输入域名（如: example.com）: " DOMAIN
    
    # 生成 Nginx 配置
    cat > /etc/nginx/sites-available/factory-management <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # 前端静态文件
    location / {
        root $APP_DIR/client/build;
        try_files \$uri \$uri/ /index.html;
    }

    # 后端 API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
    }

    # 上传文件
    location /uploads {
        alias $APP_DIR/server/uploads;
    }

    # 下载文件
    location /downloads {
        alias $APP_DIR/server/downloads;
    }
}
EOF

    # 启用配置
    ln -sf /etc/nginx/sites-available/factory-management /etc/nginx/sites-enabled/
    
    # 测试配置
    nginx -t
    
    # 重启 Nginx
    systemctl restart nginx
    
    log_info "Nginx 配置完成"
}

# 启动服务
start_services() {
    APP_DIR="/var/www/factory-management"
    
    log_info "启动服务..."
    
    cd "$APP_DIR"
    
    # 使用 PM2 启动
    sudo -u $SUDO_USER pm2 start ecosystem.config.js
    
    # 保存 PM2 配置
    sudo -u $SUDO_USER pm2 save
    
    # 设置开机自启
    sudo -u $SUDO_USER pm2 startup
    
    log_info "服务启动完成"
    log_info "使用 'pm2 status' 查看服务状态"
    log_info "使用 'pm2 logs' 查看日志"
}

# 配置防火墙
setup_firewall() {
    log_info "配置防火墙..."
    
    if [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
        ufw allow 80/tcp
        ufw allow 443/tcp
        ufw allow 22/tcp
        log_warn "如需启用防火墙，请运行: ufw enable"
    elif [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]]; then
        firewall-cmd --permanent --add-service=http
        firewall-cmd --permanent --add-service=https
        firewall-cmd --reload
    fi
    
    log_info "防火墙配置完成"
}

# 安装 SSL 证书（可选）
setup_ssl() {
    read -p "是否安装 SSL 证书？(y/n) " INSTALL_SSL
    
    if [ "$INSTALL_SSL" != "y" ]; then
        return
    fi
    
    log_info "安装 SSL 证书..."
    
    if [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
        apt-get install -y certbot python3-certbot-nginx
    elif [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]]; then
        yum install -y certbot python3-certbot-nginx
    fi
    
    read -p "请输入邮箱: " EMAIL
    
    certbot --nginx --non-interactive --agree-tos --email $EMAIL -d $DOMAIN
    
    log_info "SSL 证书安装完成"
    log_info "证书自动续期已配置"
}

# 主函数
main() {
    log_info "开始部署工厂管理系统..."
    
    check_root
    detect_os
    
    # 安装基础软件
    install_nodejs
    install_pm2
    install_nginx
    install_git
    
    # 设置目录
    setup_directories
    
    # 克隆代码
    clone_repository
    
    # 配置后端
    setup_backend
    
    # 构建前端
    setup_frontend
    
    # 配置 Nginx
    setup_nginx
    
    # 配置防火墙
    setup_firewall
    
    # 启动服务
    start_services
    
    # 安装 SSL（可选）
    setup_ssl
    
    log_info "=========================================="
    log_info "部署完成！"
    log_info "=========================================="
    log_info "访问地址: http://$DOMAIN"
    log_info "日志目录: /var/www/factory-management/logs"
    log_info "数据库: /var/www/factory-management/server/data/factory.db"
    log_info ""
    log_info "常用命令:"
    log_info "  pm2 status          # 查看服务状态"
    log_info "  pm2 logs            # 查看实时日志"
    log_info "  pm2 restart all     # 重启所有服务"
    log_info "  systemctl status nginx  # 查看 Nginx 状态"
    log_info "=========================================="
}

# 执行主函数
main
