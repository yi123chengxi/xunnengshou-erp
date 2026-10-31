# 工厂管理系统

一套面向中小型制造企业的生产管理系统，涵盖产品管理、销售订单、采购、生产、库存、财务等核心业务流程。

## 技术栈

### 前端（client）
- React 18 + TypeScript
- Ant Design 5.x 组件库
- React Router 6.x 路由管理
- Zustand 状态管理
- ECharts 数据可视化
- XLSX 报表导出

### 后端（server）
- Node.js + Express
- TypeScript
- SQLite（better-sqlite3）
- JWT 身份认证
- WebSocket（ws）
- 阿里云短信服务
- Web Push 推送

### 打印客户端（print-client）
- Electron 桌面应用
- 自动更新（electron-updater）
- 热敏标签打印

## 项目结构

```
├── client/          # 前端 React 应用
├── server/          # 后端 Express 服务
├── print-client/    # Electron 打印客户端
└── README.md
```

## 本地开发

### 环境要求
- Node.js >= 16
- npm 或 yarn

### 启动前端
```bash
cd client
npm install
npm start
```
访问 http://localhost:3000

### 启动后端
```bash
cd server
npm install
cp .env.example .env  # 复制并修改环境变量
npm run dev
```
服务运行在 http://localhost:3000

### 启动打印客户端
```bash
cd print-client
npm install
npm start
```

## 阿里云部署指南

### 推荐配置（单实例部署）
- **实例规格**：ECS t6-c1m2.large（2核4G）
- **系统盘**：40GB ESSD
- **带宽**：3-5Mbps
- **系统**：Ubuntu 22.04 LTS / CentOS 8
- **预算**：约 170-220 元/月

### 部署步骤

#### 1. 服务器初始化
```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 PM2 进程管理
sudo npm install -g pm2

# 安装 Nginx
sudo apt install -y nginx

# 安装 Git
sudo apt install -y git
```

#### 2. 拉取代码
```bash
cd /var/www
sudo git clone https://github.com/YOUR_USERNAME/factory-management.git
cd factory-management
```

#### 3. 配置后端
```bash
cd server
sudo npm install --production
sudo cp .env.example .env
sudo nano .env  # 修改为实际配置
```

**关键配置项**：
- `JWT_SECRET`：生成随机字符串（`openssl rand -base64 32`）
- `ALIYUN_ACCESS_KEY_ID/SECRET`：阿里云控制台获取
- `VAPID_PUBLIC_KEY/PRIVATE_KEY`：运行 `npx web-push generate-vapid-keys`

#### 4. 构建前端
```bash
cd ../client
sudo npm install
sudo npm run build
```

#### 5. 配置 Nginx
```bash
sudo nano /etc/nginx/sites-available/factory-management
```

添加以下配置：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /var/www/factory-management/client/build;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

    # 上传文件
    location /uploads {
        alias /var/www/factory-management/server/uploads;
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/factory-management /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 6. 启动服务
```bash
cd /var/www/factory-management/server
sudo pm2 start ecosystem.config.js
sudo pm2 save
sudo pm2 startup  # 开机自启
```

#### 7. 配置 HTTPS（可选，推荐）
```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 使用部署脚本（一键部署）
```bash
cd /var/www/factory-management
chmod +x deploy.sh
sudo ./deploy.sh
```

## 后期迁移（SQLite → MySQL）

当用户规模增长到 50+ 人时，可考虑迁移到 MySQL：

1. **安装 MySQL**：`sudo apt install mysql-server`
2. **修改配置**：`server/.env` 中启用 MySQL 配置
3. **数据迁移**：使用 `server/src/database/migrate.ts` 脚本
4. **预计工期**：7-9 天（前端零改动）

## 常见问题

### Q: 如何备份数据？
A: SQLite 数据库文件位于 `server/data/factory.db`，定期备份此文件即可。

### Q: 如何查看日志？
A: `pm2 logs` 查看实时日志，`pm2 logs --lines 100` 查看最近 100 行。

### Q: 如何重启服务？
A: `pm2 restart factory-management-server`

### Q: 上传文件大小限制？
A: 默认 10MB，可在 `.env` 中修改 `MAX_FILE_SIZE`。

## 许可证

MIT License

## 联系方式

如有问题，请联系：admin@your-domain.com
