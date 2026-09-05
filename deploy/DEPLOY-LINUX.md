# Linux 部署

仓库：https://github.com/Tucyan/splendor-private-table

当前部署地址：https://taskstream.xyz/splendor/

项目无需安装 npm 依赖或构建前端。应用目录为 `/opt/splendor`，配置文件为 `/etc/splendor.env`，systemd 服务为 `splendor`。以下首次安装步骤不要在已部署服务器上重复执行，以免覆盖已有配置。

## 1. 获取代码并检查 Node.js

新服务器可以直接从 GitHub 获取代码（需已安装 Git）：

```sh
sudo git clone https://github.com/Tucyan/splendor-private-table.git /opt/splendor
```

也可使用已有发布压缩包，二选一：

```sh
sudo unzip splendor-linux-subpath-20260906.zip -d /opt
```

检查运行环境：

```sh
node --version
command -v node
```

要求 Node.js 22 或更高版本。压缩包解压后路径应为 `/opt/splendor`。

本服务器部署使用 `/opt/node-v24.11.1-linux-x64/bin/node`，以免影响现有服务使用的 Node.js 版本。`deploy/splendor.service` 的 `ExecStart` 使用这个绝对路径；新服务器若使用其他安装位置，应在安装服务前修改它。服务启用了 `ProtectHome=true`，不要使用 `/root/.nvm/` 下的 Node。

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
curl --noproxy '*' -fsS http://127.0.0.1:3030/api/health
```

健康检查应返回 `{"ok":true}`。`Type=simple` 的服务状态变为 active 时，HTTP 端口可能尚未监听，检查应在应用完成启动后执行。查看日志：

```sh
sudo journalctl -u splendor -f
```

## 4. 配置 Nginx

当前站点配置为 `/etc/nginx/conf.d/task-stream.conf`，沿用已有证书。在该域名的 **HTTPS server 块内部**添加以下配置；不要把只有 `location` 的文件直接放入 `conf.d/*.conf`，该目录通常在 `http` 层加载。

```nginx
location = /splendor {
    return 308 /splendor/;
}

location ^~ /splendor/ {
    proxy_pass http://127.0.0.1:3030/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

`proxy_pass` 末尾的 `/` 用于去掉请求中的 `/splendor/` 前缀。保留现有站点的其他 location，并在备份配置后修改。验证通过才重载：

```sh
sudo nginx -t && sudo systemctl reload nginx
curl --noproxy '*' -fsS https://taskstream.xyz/splendor/api/health
```

浏览器访问 `/splendor/`，检查样式、创建房间和“已连接”状态。应用只监听回环地址，公网无需开放 3030；沿用站点的 80/443 端口。

## 5. 更新代码与密钥

从 GitHub 克隆安装的服务器可以更新代码。先确认 `git status --short` 没有本地改动，再拉取；发生冲突时停止并检查，不强制覆盖：

```sh
cd /opt/splendor
sudo -u splendor git status --short
sudo -u splendor git pull --ff-only
/opt/node-v24.11.1-linux-x64/bin/node --test
```

**当前服务器是压缩包安装，没有 `.git`，不能直接执行 `git pull`。** 从 GitHub 下载新版代码或上传更新包到独立目录，检查目录结构并备份旧应用后再替换 `/opt/splendor`。不要把 `.env` 或真实密钥放进仓库；保留独立的 `/etc/splendor.env`。更新后执行：

```sh
sudo chown -R splendor:splendor /opt/splendor
sudo systemctl restart splendor
```

若修改了服务单元，应重新安装 `deploy/splendor.service` 并执行 `sudo systemctl daemon-reload`，随后重启服务。

仅修改密钥或模型时，编辑 `/etc/splendor.env` 后执行 `sudo systemctl restart splendor` 即可，不需要重启 Nginx。环境变量在进程启动时读取；已写入密钥不代表已经验证 API 的权限、余额或模型可用性。

服务只应运行一个实例。房间和对局保存在内存中，重启服务会清空当前房间。
