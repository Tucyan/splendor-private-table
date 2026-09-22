# 本地 AI 难度算法

本地 AI 难度算法位于 `src/local-ai.js`，简单、普通、困难、地狱四档已接入房间与邀请菜单。四档模式分别为 `local-simple`、`local-normal`、`local-hard`、`local-hell`：简单档继续调用 `src/ai.js` 的原 `localAction`；普通、困难和地狱调用本文件中的评估算法。`src/ai.js` 保持不变，LLM 基础仍走原 `aiChoose` 路径。

LLM · 高级由独立 `src/ai-advanced.js` 入口处理，使用公开战术上下文和有界结构化计划；也支持通过 `advancedChoose` 注入测试或部署适配器。高级失败时回退到独立本地战术动作，不改写基础 chooser。

## 调用

```js
import { chooseLocalDifficultyAction, analyzeLocalDifficulty } from '../src/local-ai.js';
import { legalActions } from '../src/game.js';

const playerId = game.players[game.turn].id;
const actions = legalActions(game, playerId);
const action = chooseLocalDifficultyAction(game, playerId, actions, {
  difficulty: 'hard', // normal / hard / hell；默认 normal
  seed: 42,
  maxNodes: 4000,
  maxTimeMs: 150,
});

// 诊断接口提供同样的决策，以及预算与搜索完成情况。
const analysis = analyzeLocalDifficulty(game, playerId, actions, { difficulty: 'hell' });
// { action, difficulty, nodes, completedSamples, completedRollouts, truncated }
```

输入完整服务端局面和该玩家的合法动作列表，输出列表中的原始动作对象。函数不会改变输入局面、动作列表或基础卡池。该接口也支持独立的返还筹码和选择贵族步骤。空动作、未知难度、非当前行动玩家、无效预算会抛出错误。

## 本地策略档位

简单档使用原有快速规则策略，不运行本文件中的搜索。其余三档算法如下：

| 难度 | 信息 | 决策 |
| --- | --- | --- |
| 普通 normal | 公开局面、自身预留、其他玩家预留等级和数量、牌堆数量 | 对未知牌生成 3 个一致的抽样局面，模拟每个候选行动和必要后续步骤，比较平均局面价值 |
| 困难 hard | 与普通相同 | 从普通评分中挑选前 6 个行动，并保留直接达标的购牌、阻止对手达标的预留；逐个模拟其他玩家回应，直至自己再行动一次或游戏结束 |
| 地狱 hell | 额外读取三个牌堆的完整真实顺序 | 使用真实补牌和盲抽结果进行同样的有限推演；其他玩家预留身份仍不直接读取 |

共同评分考虑当前分数、结束分数、终局阶段、永久折扣的边际价值、市场颜色需求、最接近的贵族、购牌所需拿取次数、单色资源瓶颈、黄金、无效预留负担和领先对手。结束局面以真实胜负评价，同分少卡和共享胜利直接复用规则引擎。

困难和地狱采用截断候选动作的启发式推演，并非穷举或保证最优的 minimax/MCTS。模拟玩家分别最大化自己的收益；每次回应先通过轻量评分筛到最多 5 个动作，再使用真实规则模拟。普通模拟对手不会根据尚未翻出的补牌或盲抽结果择优。贵族选择和超限返还在模拟中完成后才进入下一个玩家回合。

## 隐藏信息隔离

普通和困难不会读取真实牌堆卡牌身份或对手预留卡身份。抽样从基础卡池中排除市场、已购牌、自身预留后进行，按对手预留等级分配未知牌，再填入相同数量的模拟牌堆。对局日志不参与决策。三个抽样对所有根动作共用，避免动作间采样差异影响比较。

地狱牌堆按规则引擎的 `pop()` 顺序使用，即数组最后一张先发出。不直接查看对手当前预留牌；由于知晓完整牌堆及公开牌，可以从剩余卡池推断部分隐藏信息。这是预知牌序自然带来的额外优势。实现无跨回合记忆。

## 计算预算与退化

- 默认最多 4,000 次规则状态转换、150 毫秒；调用方可调整，上限分别为 50,000 和 5,000 毫秒。
- 时间限制在状态转换前检查，属于协作式时间预算，单次评价或排序可能令总耗时略超预算。
- 每完成一整轮候选比较才发布搜索结果，中途停止不会偏向已经算到的动作。
- 推演超限时保留最近一次完整比较的结果；连第一轮都没完成时，使用现有简单策略。
- `completedSamples` 是完成的根动作抽样比较轮数；`completedRollouts` 是完成的候选推演比较轮数；`truncated` 表示预算已用尽。
- 固定 seed 且完成相同搜索轮次时结果可复现；受时间预算影响，不同机器可能完成不同轮次。
- 接口是同步计算；房间调度会同步调用普通、困难和地狱档，使用默认的 4,000 节点和 150 毫秒预算。时间预算是协作式的，计算期间会占用服务事件循环；若实测需要更长搜索，应考虑工作线程。

## 验证与边界

`node --test test/local-ai.test.js` 覆盖合法动作、不修改输入、自定义结束分数与座位、同分少卡、贵族、弃牌、停滞跳过、隐藏信息隔离、确定牌序盲抽、避免给对手送出制胜补牌、立即获胜与阻止对手获胜、预算退化，以及 2–4 人完整对局和宝石守恒。

房间路由、pending 返还/贵族选择和本地难度入口另由 `test/llm-basic-compat.test.js`、`test/rooms.test.js` 与 `test/server.test.js` 覆盖。固定牌序的对战基准可用于观察结果，不等同于证明胜率梯度。

## 本地对战基准

仓库根目录运行 `npm run benchmark:local-ai` 可执行快速基准：12 局，每种人数（2、3、4 人）各使用一个固定牌序，再对该牌序运行四次模式座位轮换。因此 quick 总计 3 个唯一牌序和 3 个配对区块，每个区块复用 4 局；同一区块内仅模式座位映射变化。每次搜索最多 120 个节点或 10 毫秒，每局最多 240 步，整个基准默认最多运行 30 秒。输出为 JSON。它不联网，也不需要 API 密钥。每局使用公开基础卡池和固定种子生成确定牌序；轮换让四档在各个座位上的样本数相同。

可以显式修改种子和预算，例如：

```sh
node scripts/benchmark-local-ai.js --seed 42 --games-per-player-count 8 --max-games 24 --max-steps 120 --max-nodes 400 --max-time-ms 30
```

完整基准必须明确选择 `--profile full`，会穷举每种人数下四档 AI 的不同座位排列，共 60 局。它同样只有 3 个唯一牌序，每种人数一个；2 人区块复用 12 局，3 人和 4 人区块各复用 24 局。因此这 60 局不是 60 个独立牌序：同人数区块共享牌序，用于成对比较座位排列。

```sh
node scripts/benchmark-local-ai.js --profile full --max-games 60 --max-steps 500 --max-nodes 1500 --max-time-ms 150 --max-total-time-ms 600000
```

`maxTotalTimeMs` 默认 30,000 毫秒，允许的硬上限为 600,000 毫秒；完整基准可像上例一样显式提高。支持的总局数、每局步数、每次搜索节点和时间也都有安全上限；CLI 会拒绝无效参数或无法容纳整个计划的 `maxGames`。总时限到达时当前对局标记 `timeout`，未开始的局标记 `skipped`；两类都计入样本总数。检查发生在开局及每次行动前，无法中断正在运行的单次同步搜索，因此实际耗时最多可能超过时限一个 `maxTimeMs` 加少量收尾开销。

`config` 和 `summary` 都报告 `uniqueSeedCount`、`pairedScheduleBlocks`、各人数下的 `seedReusePerBlockByPlayerCount` 与 `maxTotalTimeMs`；逐局样本含 `blockId` 与 `rotation`，可检查配对关系。报告逐局记录种子、人数、模式座位、步数及完成/截断/错误/超时/跳过状态；汇总包括独胜与共享胜、按分数及购牌数计算的平均终局名次、按已尝试局数计算的平均行动数（`avgActionsPerAttemptedGame`）、每次 AI 行动的平均耗时（`avgDecisionMsPerAction`）、已完成搜索样本/推演次数与截断率。胜率只以已完成对局中的出场次数为分母；共享名次按并列者占据名次的平均值计算。

`normal` 与 `hard` 只能使用公开局面和一致抽样；`hell` 会读完整真实牌堆顺序，因此有信息优势。默认 quick 每次搜索仅给 10 毫秒，hard/hell 较高的截断率表示搜索深度受限，不代表完整深度下的策略表现。默认 quick 实测一组固定参数得到 12 局完成、0 局超时/不完整，搜索截断率约 90.5%；该结果只有 3 个唯一牌序。胜率还可能受种子、座位和对手组合影响，样本结果不保证出现稳定的 simple → normal → hard → hell 强度梯度。需要比较策略调整时，应保留同一完整命令和种子，并增加独立牌序样本后再解释结果。
