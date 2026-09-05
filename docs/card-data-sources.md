# 基础版数据来源

`src/data.js` 包含基础版 90 张发展卡（40/30/20）和 10 张贵族的结构化数值。发展卡的点数与五色成本来自公开的逐卡核验表：

<https://raw.githubusercontent.com/anicolao/splendor/main/data/verified_card_properties.csv>

该表的卡牌 ID 形如 `white-L1-01`：首段是卡牌奖励颜色，第二段是等级；本项目将表头的五列成本映射为 `white, blue, green, red, black`。贵族成本按基础版实体贵族牌逐项转录，并以官方规则书的基础版组件数量、贵族触发和结算规则交叉核对：

<https://cdn.svc.asmodee.net/production-unboxnowcom/uploads/2022/02/Splendor-EN.pdf>

实现没有复制任何第三方程序代码；CSV 仅用于核验数值，运行时数据保存在 `src/data.js` 中，避免服务器依赖网络。
