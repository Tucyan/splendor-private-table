# 璀璨宝石 · 私人桌游室

面向朋友小聚的中文 Splendor 基础版 Web 服务。单个 Node.js 进程即可运行，无运行时依赖、无数据库、无需构建前端。适合同时在线不超过 10 人的小规模使用，每桌 2–4 位玩家。

## 启动

安装 **Node.js 22+**（本项目在 Node.js 24.11.1 验证）。进入本目录：

```powershell
npm start
```

打开 **http://localhost:3030**。无需 `npm install`，不需要下载依赖。

同一局域网的朋友打开 `http://你的电脑局域网IP:3030`，创建房间后分享六位房间号或邀请链接。默认监听 `0.0.0.0`，需要允许操作系统防火墙的对应入站端口。跨互联网访问需要有可达的服务器或自行配置组网/反向代理；本项目不会自动把电脑暴露到公网。局域网邀请请从局域网 IP 地址打开页面后复制链接，`localhost` 链接只适用于本机。

可选配置：复制 `.env.example` 为 `.env`。端口冲突时修改 `PORT`。按 `Ctrl+C` 结束前台服务。`npm run dev` 可在修改后自动重启（重启清空房间）。

## 功能

- 创建房间、六位房号加入、复制邀请链接，2–4 人基础对局。
- 昵称保存在浏览器 localStorage，可随时在右上角修改。随机会话令牌使用 HttpOnly Cookie，刷新恢复原座位；同一浏览器的多个标签页属于同一玩家。测试不同玩家请使用另一浏览器或隐私窗口。
- 房主邀请/移出 AI 或真人、开始游戏，结束后返回大厅再开一局。
- 实时显示在线/离线，自动重连。断线保留席位，轮到离线玩家时等待；房主可移出该玩家，由本地策略接管正在进行的席位。主动离开也会托管。房主离开后转交下一位真人；最后一位真人离开时关闭房间。
- 90 张基础发展卡、10 位贵族、按人数配置宝石与贵族、三种颜色/同色两枚取宝石、折扣购买、黄金替代支付、市场/盲抽预留、返还至十枚筹码、贵族选择、15 分完成当前轮、同分少卡优先及共享胜利。
- 横屏紧凑布局：左栏仅显示玩家头像、昵称和在线状态；右侧宝石库依次为拿取/返还区、持有宝石、永久折扣、等效宝石及预留手牌。等效宝石为各色持有筹码加永久折扣，黄金单列。已购牌全集和对局记录通过弹窗查看。1280×720、1366×768、1920×1080 主桌面无需滚动；手机自动转为上下排列。
- 卡牌根据自身筹码、黄金和永久折扣持续高亮：自己的可行动回合显示“可购买”，其他回合显示“可负担”。悬停资源不足的卡牌会显示颜色缺口、黄金可抵扣量与最终仍缺总数；足够购买时不弹提示。
- “所需支付”显示只扣除永久折扣的五色成本，不会把未持有的宝石擅自显示成黄金。实际支付方案单独展开，黄金依然可以合法替代颜色。
- 私人桌补充规则：无法拿取任何普通宝石且无法购买时，可以手动跳过，即使仍能预留；所有玩家连续跳过一圈后按当前声望及同分少卡规则结算。任意其他行动或贵族来访会重置连续跳过计数。
- 房主可点击“结束本局”，确认后停止当前对局与正在等待的 AI 请求，按当前排名结算；房间和席位保留，返回大厅可再开一局。
- 隐藏其他玩家预留牌、盲抽日志的牌身份及全部牌堆顺序。所有操作由服务端验证，版本检查防止过期/重复提交。
- 原创 SVG 矿场、港口、庄园与宝石图标，全部随服务提供，不依赖外部图片/CDN。

## DeepSeek AI

服务端按以下优先级读取密钥：

1. 本机环境变量 `deepseekkey`（用户现有名称）。
2. `DEEPSEEK_API_KEY`，可通过环境变量或 `.env` 配置。

密钥仅在服务端读取，不会发送到前端、写入房间、打印到日志或加入 AI 上下文。仅作为 Authorization 头发送到 `https://api.deepseek.com/chat/completions`。

默认模型 `deepseek-v4-flash`，可设置 `DEEPSEEK_MODEL`。模型默认值依据开发时的 [DeepSeek Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)；账户可用模型不同可修改配置。

每次决策只有两条消息：

```text
system: 固定规则与策略提示词（跨玩家/房间不变）
user:   self → table → bank → opponentGems → legalActions
```

自身包括持有筹码、永久折扣、已购牌、预留牌、贵族和分数；场上包括市场、贵族、剩余牌数与对手公开状态。不提供牌堆顺序、对手预留身份、聊天记录、过去回合或 AI 上次回答。卡牌按稳定顺序序列化，没有时间戳与玩家昵称等无关内容。缓存依赖共同前缀，固定规则放在最前，频繁变化的信息和合法动作放在后面；实际命中量由 DeepSeek 决定，详见 [上下文缓存说明](https://api-docs.deepseek.com/guides/kv_cache/)。

AI 使用 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 返回严格的动作索引，例如：

```json
{"actionIndex": 12}
```

服务端从 `legalActions[12]` 获取标准动作，再交给规则引擎验证。例如 `{"type":"buy","cardId":"white-L1-01"}` 或 `{"type":"take","gems":{"white":1,"blue":1,"green":1}}`。这个结构减少输出 token 和无效操作，同时保留购买、拿取、预留的完整选择。

每个 AI 回合只有一次请求，20 秒超时，关闭 thinking 以降低决策等待。异常、超时、无效 JSON 或越界索引均不自动重试；本回合改用本地策略并显示提示。返还筹码/选择贵族等后续步骤由本地规则策略处理。没有任何真人在线时不发起新 AI 回合。未配置密钥时仍可添加明确标记的“本地练习 AI”。本地策略用于练习和故障兜底，强度有限。

## 部署

直接在一台 Node.js 22+ 服务器运行 `npm start`，由 systemd、PM2 或你习惯的进程管理器保持运行即可。**只启动一个实例**：房间使用内存，不跨进程共享。需要公开访问时建议使用 HTTPS 和访问保护（例如私有组网或反向代理密码），避免他人消耗你的 AI 额度。

Nginx 示例（域名、证书由你自己的环境提供）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3030;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

HTTPS 部署时设置 `COOKIE_SECURE=true`；本地 HTTP 保持 `false`。SSE 需要关闭代理缓冲，心跳每 15 秒发送。

也可使用附带的 Dockerfile：

```sh
docker build -t splendor-private .
docker run -d --name splendor-private --restart unless-stopped \
  -p 3030:3030 -e DEEPSEEK_API_KEY -e DEEPSEEK_MODEL=deepseek-v4-flash splendor-private
```

Docker 方式需要下载基础镜像；本机直接运行无需任何下载。本项目没有在本机执行 Docker 构建。

## 验证与文件结构

```sh
npm test
npm run check
```

`src/game.js` 是纯规则引擎；`src/data.js` 保存卡池事实数据；`src/rooms.js` 管理房间、在线与 AI 调度；`src/ai.js` 构建无记忆请求；`src/server.js` 提供 HTTP/SSE；`public/` 为原生响应式页面。

规则与卡池来源见 [卡牌数据说明](docs/card-data-sources.md)，美术说明见 [资产说明](docs/assets.md)。本项目使用原创美术，未复制原桌游插画；名称与基础规则用于私人游玩。

## 当前边界

房间、对局和会话只保存在进程内存；服务重启后需要重新开房。无人在线达 12 小时的房间自动清理。没有账户、公开大厅、观战、聊天、对局存档与 DLC。这是小规模私人服务，并非多实例或公共商业平台。
