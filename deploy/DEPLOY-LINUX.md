# Linux 部署

压缩包不含密钥、日志和测试文件，也不需要安装 npm 依赖或构建前端。

## 1. 解压并检查 Node.js

```sh
sudo unzip splendor-linux-20260906.zip -d /opt
node --version
command -v node
```

要求 Node.js 22 或更高版本。压缩包解压后路径应为 `/opt/splendor`。

如果 `command -v node` 不是 `/usr/bin/node`，请修改
`/opt/splendor/deploy/splendor.service` 中的 `ExecStart`。

## 2. 创建用户和配置

```sh
sudo useradd --system --home-dir /opt/splendor --shell /usr/sbin/nologin splendor 2>/dev/null || true
sudo chown -R splendor:splendor /opt/splendor
sudo cp /opt/splendor/.env.example /etc/splendor.env
sudo chmod 600 /etc/splendor.env
sudo nano /etc/splendor.env
```

使用 HTTPS 反向代理时设置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3030
COOKIE_SECURE=true
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_MODEL=deepseek-v4-flash
```

不使用 DeepSeek 时删除或注释密钥行即可。不要把真实密钥写回项目目录。

## 3. 启用 systemd

```sh
sudo cp /opt/splendor/deploy/splendor.service /etc/systemd/system/splendor.service
sudo systemctl daemon-reload
sudo systemctl enable --now splendor
sudo systemctl status splendor --no-pager
curl http://127.0.0.1:3030/api/health
```

健康检查应返回 `{"ok":true}`。查看日志：

```sh
sudo journalctl -u splendor -f
```

更新版本时先备份 `/etc/splendor.env`，替换 `/opt/splendor` 后执行：

```sh
sudo chown -R splendor:splendor /opt/splendor
sudo systemctl restart splendor
```

服务只应运行一个实例。房间和对局保存在内存中，重启服务会清空当前房间。
