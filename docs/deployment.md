# 部署自己的飞行棋

1. 安装 Node.js24、pnpm10.34.9，执行 pnpm install --frozen-lockfile、pnpm build。
2. 复制 .env.example 为 .env。设置 NODE_ENV=production、WEB_ORIGIN=https://ludo.example.com，并将 DATABASE_PATH 指向服务用户可写的持久目录绝对路径。
3. 使用全新数据库运行 pnpm db:migrate，再用 pnpm start 或进程管理器运行后端，默认127.0.0.1:3007。
4. 使用 Caddy 等代理提供可信HTTPS，静态根目录 apps/web/dist，将 /api/* 转发给后端。见 Caddyfile.example；替换示例域名和路径，并给自己服务器配置DNS与80/443访问。
5. 验证健康、注册登录退出、2–4账号建房加入、轮流掷骰/起飞和刷新恢复。普通标签页共享Cookie，不能模拟不同账号。

服务器生成骰子，客户端不能指定点数。页面约每1.2秒拉取权威状态，不依赖WebSocket。WEB_ORIGIN必须与浏览器访问地址完全一致。

升级前备份SQLite和旧程序；不要覆盖真实用户数据库。此项目数据库从迁移1开始，不兼容直接放入原平台数据库。node_modules、dist、data、.env和生产日志不应提交GitHub。
