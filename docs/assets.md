# 图形资产

`public/assets/mark.svg`、`mine.svg`、`harbor.svg`、`estate.svg` 以及 `public/app.js` 中的宝石和线条图标均为本项目原创 SVG。使用系统字体，无字体/CDN请求，无远程热链。

用户允许引入开源图片资源；此版本选择原创轻量 SVG，避免部署时下载图片和额外的资产授权依赖。没有使用原版桌游插画或第三方游戏截图。

## 音频资产

`public/assets/audio/` 中的七段 OGG 音效选自 [Kenney Casino Audio 1.1](https://kenney.nl/assets/casino-audio)，作者为 Kenney Vleugels。原素材包采用 [Creative Commons Zero（CC0 1.0）](https://creativecommons.org/publicdomain/zero/1.0/)；仓库内保留了随包提供的 `LICENSE.txt`。

| 本地文件 | 用途 |
|---|---|
| `card-shuffle.ogg` | 开始对局 |
| `chips-handle-2.ogg` | 拿取宝石 |
| `card-place-1.ogg` | 购买发展卡 |
| `card-slide-4.ogg` | 预留发展卡 |
| `cards-pack-open-1.ogg` | 贵族来访 |
| `chip-lay-2.ogg` | 轮到当前玩家 |
| `card-fan-1.ogg` | 对局结算 |

这些文件随站点本地提供，不会运行时请求第三方服务器。CC0 不要求署名；这里仍保留来源，便于审计和后续替换。
