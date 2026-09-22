import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { RoomStore } from '../src/rooms.js';
import { createGame, legalActions, applyAction } from '../src/game.js';
import { localAction } from '../src/ai.js';
import { chooseLocalDifficultyAction } from '../src/local-ai.js';

const disabledLlmConfig = Object.freeze({ enabled: false, model: undefined, advancedModel: undefined, reflectionModel: undefined });
const llmConfig = Object.freeze({
  enabled:true,apiKey:'fixture-key',apiUrl:'https://llm.example/v1/chat/completions',
  model:'base-model',advancedModel:'advanced-model',reflectionModel:'reflection-model',timeoutMs:321,extraBody:{},
});

class Stream extends EventEmitter {
  write() {}
  end() { this.destroyed = true; this.emit('close'); }
}

function setup(t, options = {}) {
  const store = new RoomStore(options);
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  return { store, host, guest, room: store.room(host) };
}

async function waitFor(predicate, message = 'AI did not finish') {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(message);
}

async function runBotTurn(t, mode, options = {}) {
  const { store, host, guest, room } = setup(t, { aiDelay: 1, ...options });
  store.leave(guest);
  store.addAI(host, mode);
  store.attach(host, new Stream());
  store.start(host);
  store.action(host, { version: room.version, action: { type: 'take', gems: { white: 1 } } });
  return { store, host, room, bot: room.players.find(p => p.ai) };
}

test('omitted mode and llm-basic both keep the basic LLM adapter contract', async t => {
  for (const explicit of [false, true]) {
    let received;
    const { store, host, room, bot } = await runBotTurn(t, explicit ? 'llm-basic' : undefined, {
      llmConfig,
      aiChoose: async (...args) => {
        received = args;
        return { action: args[2][0], source: 'llm-basic' };
      },
    });
    await waitFor(() => room.aiStatus?.state === 'done');
    assert.equal(bot.mode, 'llm-basic');
    assert.equal(typeof received[3].signal?.aborted, 'boolean');
    assert.equal(received[3].llmConfig, llmConfig);
    assert.equal(received[1], bot.id);
    assert.equal(room.aiStatus.source, 'llm-basic');
    assert.equal(store.snapshot(host).room.players.find(p => p.ai).mode, 'llm-basic');
  }
});

test('advanced LLM has an independent injected adapter and never calls the basic adapter', async t => {
  let advancedCalls = 0;
  const { room, bot } = await runBotTurn(t, 'llm-advanced', {
    llmConfig,
    aiChoose: async () => assert.fail('advanced mode entered basic adapter'),
    advancedChoose: async (game, id, actions, options) => {
      advancedCalls++;
      assert.equal(id, bot.id);
      assert.equal(options.llmConfig, llmConfig);
      assert.ok(options.signal);
      return { action: actions[0], source: 'llm-advanced' };
    },
  });
  await waitFor(() => room.aiStatus?.state === 'done');
  assert.equal(bot.mode, 'llm-advanced');
  assert.equal(advancedCalls, 1);
  assert.equal(room.aiStatus.source, 'llm-advanced');
});

test('advanced adapter failure falls back locally with a stable adapter error', async t => {
  let calls = 0;
  const { room } = await runBotTurn(t, 'llm-advanced', {
    llmConfig,
    advancedChoose: async () => { calls++; throw new Error('adapter failed'); },
  });
  await waitFor(() => room.aiStatus?.state === 'done');
  assert.equal(calls, 1);
  assert.equal(room.aiStatus.source, 'llm-advanced-fallback');
  assert.equal(room.aiStatus.reasonCode, 'AI_ADAPTER_ERROR');
  assert.match(room.aiStatus.notice, /本地策略/);
  assert.equal(room.game.turn, 0);
});

test('advanced LLM owns its pending noble decision', async t => {
  let calls = 0;
  const { store, room, bot } = await runBotTurn(t, 'llm-advanced', {
    aiDelay: 1000,
    llmConfig,
    advancedChoose: async (game, id, actions, options) => {
      calls++;
      assert.equal(options.llmConfig, llmConfig);
      assert.equal(game.pending.type, 'noble');
      return { action: actions.find(action => action.nobleId === 'better'), source: 'llm-advanced' };
    },
  });
  room.game.pending = { type: 'noble', nobleIds: ['first', 'better'] };
  room.game.nobles = [
    { id: 'first', points: 1, cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 } },
    { id: 'better', points: 4, cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 } },
  ];
  store.cancelAI(room);
  store.aiDelay = 1;
  store.scheduleAI(room);
  await waitFor(() => room.aiStatus?.state === 'done');
  assert.equal(calls, 1);
  assert.ok(room.game.players.find(p => p.id === bot.id).nobles.some(n => n.id === 'better'));
});

test('cancelling an advanced request discards a late result', async t => {
  let release;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const { store, host, room } = await runBotTurn(t, 'llm-advanced', {
    llmConfig,
    advancedChoose: async () => {
      started();
      return new Promise(resolve => { release = () => resolve({ action: { type: 'pass' }, source: 'llm-advanced' }); });
    },
  });
  await Promise.race([began, delay(1000).then(() => { throw new Error('advanced adapter did not start'); })]);
  const task = room.aiTask;
  store.finish(host);
  const version = room.version;
  const finished = structuredClone(room.game);
  assert.equal(task.abort.signal.aborted, true);
  release();
  await delay(10);
  assert.equal(room.version, version);
  assert.deepEqual(room.game, finished);
});

test('only generic LLM modes require enabled config; local aliases remain and provider modes are rejected', t => {
  const { store, host, room } = setup(t, { llmConfig: disabledLlmConfig });
  for (const mode of ['llm-basic', 'llm-advanced']) {
    assert.throws(() => store.addAI(host, mode), /LLM.*配置/);
    assert.equal(room.players.length, 2);
  }
  for (const mode of ['deepseek', 'deepseek-advanced']) {
    assert.throws(() => store.addAI(host, mode), /未知 AI 类型/);
    assert.equal(room.players.length, 2);
  }
  for (const mode of ['local-simple', 'local-normal', 'local-hard', 'local-hell', 'local']) {
    const isolated = new RoomStore({ llmConfig: disabledLlmConfig });
    try {
      const owner = isolated.register(null, '房主');
      isolated.create(owner);
      isolated.addAI(owner, mode);
      assert.equal(isolated.room(owner).players[1].mode, mode === 'local' ? 'local-simple' : mode);
      isolated.remove(isolated.room(owner), isolated.room(owner).players[1].id, false);
    } finally { isolated.close(); }
  }
});

test('snapshot exposes only LLM availability and public model names', t => {
  const { store, host } = setup(t, { llmConfig });
  const snapshot = store.snapshot(host);
  assert.equal(snapshot.llmAvailable, true);
  assert.deepEqual(snapshot.llmModels, {
    enabled:true,baseModel:'base-model',advancedModel:'advanced-model',reflectionModel:'reflection-model',reasoningEfforts:['off','low','high','max'],
  });
  assert.equal(Object.hasOwn(snapshot, 'aiAvailable'), false);
  assert.ok(!JSON.stringify(snapshot).includes(llmConfig.apiKey));
  assert.ok(!JSON.stringify(snapshot).includes(llmConfig.apiUrl));
});

test('disabled LLM config hides model names and reports unavailable', t => {
  const { store, host } = setup(t, { llmConfig: disabledLlmConfig });
  const snapshot = store.snapshot(host);
  assert.equal(snapshot.llmAvailable, false);
  assert.equal(snapshot.llmModels, undefined);
  assert.equal(Object.hasOwn(snapshot, 'aiAvailable'), false);
});

test('basic LLM and local-simple settle pending discards with localAction', async t => {
  for (const mode of ['llm-basic', 'local-simple']) {
    let adapterCalls = 0;
    const { store, room, bot } = await runBotTurn(t, mode, {
      aiDelay: 1000,
      llmConfig,
      aiChoose: async (...args) => { adapterCalls++; return { action: args[2][0], source: 'llm-basic' }; },
    });
    const game = room.game;
    const botPlayer = game.players.find(p => p.id === bot.id);
    botPlayer.gems = { white: 2, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
    game.pending = { type: 'discard', count: 1 };
    const actions = legalActions(game, bot.id);
    const expected = applyAction(game, bot.id, localAction(game, bot.id, actions));
    store.cancelAI(room);
    store.aiDelay = 1;
    store.scheduleAI(room);
    await waitFor(() => room.aiStatus?.state === 'done');
    assert.equal(adapterCalls, 0);
    assert.deepEqual(room.game.players.find(p => p.id === bot.id).gems, expected.players.find(p => p.id === bot.id).gems);
    assert.equal(room.game.pending, null);
  }
});

test('local normal, hard and hell use their own evaluation for pending noble choices', async t => {
  for (const [mode, difficulty] of [['local-normal', 'normal'], ['local-hard', 'hard'], ['local-hell', 'hell']]) {
    const { store, room, bot } = await runBotTurn(t, mode, { aiDelay: 1000 });
    room.game.pending = { type: 'noble', nobleIds: ['first', 'better'] };
    room.game.nobles = [
      { id: 'first', points: 1, cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 } },
      { id: 'better', points: 4, cost: { white: 0, blue: 0, green: 0, red: 0, black: 0 } },
    ];
    const actions = legalActions(room.game, bot.id);
    const evaluated = chooseLocalDifficultyAction(room.game, bot.id, actions, { difficulty, maxNodes: 2000, maxTimeMs: 1000 });
    assert.equal(evaluated.nobleId, 'better');
    store.cancelAI(room);
    store.aiDelay = 1;
    store.scheduleAI(room);
    await waitFor(() => room.aiStatus?.state === 'done');
    assert.equal(room.game.log.at(-1)?.text?.includes('AI 本回合决策异常'), false);
    assert.ok(room.game.players.find(p => p.id === bot.id).nobles.some(n => n.id === 'better'));
  }
});

test('the invitation dialog offers all six modes and gates only LLM choices', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const firstStepStart = app.indexOf("case 'add-ai':");
  const secondStepStart = app.indexOf("case 'ai-difficulty':", firstStepStart);
  assert.notEqual(firstStepStart, -1);
  assert.notEqual(secondStepStart, -1);
  const firstStep = app.slice(firstStepStart, secondStepStart);
  const secondStep = app.slice(secondStepStart, app.indexOf("case 'start':", secondStepStart));
  assert.match(firstStep, /<h2>邀请一位 AI 商人<\/h2>/);
  assert.match(firstStep, /data-do="ai-difficulty"/);
  assert.doesNotMatch(firstStep, /data-ai=/);
  assert.match(secondStep, /<h2>选择 AI 难度 \/ 类型<\/h2>/);
  assert.match(secondStep, /data-ai=/);
  for (const [mode, label] of [
    ['local-simple', '本地 · 简单'], ['local-normal', '本地 · 普通'],
    ['local-hard', '本地 · 困难'], ['local-hell', '本地 · 地狱'],
    ['llm-basic', 'LLM · 基础'], ['llm-advanced', 'LLM · 高级'],
  ]) {
    assert.ok(app.includes(`mode:'${mode}',name:'${label}'`), `missing ${label} option`);
  }
  assert.match(app, /local-hell[\s\S]{0,260}真实牌序|真实牌序[\s\S]{0,260}local-hell/);
  assert.equal((app.match(/requiresKey:true/g) || []).length, 2);
  assert.match(app, /option\.requiresKey&&!state\.llmAvailable/);
});

test('AI strategy documents describe the four connected local modes and limit the advanced LLM claim', async () => {
  const difficulties = await readFile(new URL('../docs/local-ai-difficulties.md', import.meta.url), 'utf8');
  const strategy = await readFile(new URL('../docs/local-ai-strategy-optimization.md', import.meta.url), 'utf8');
  assert.match(difficulties, /简单.*普通.*困难.*地狱[\s\S]*已接入|已接入[\s\S]*简单.*普通.*困难.*地狱/);
  assert.match(difficulties, /LLM · 高级[\s\S]*(src\/ai-advanced\.js|高级失败)/);
  assert.doesNotMatch(difficulties, /线上行为仍使用原有策略|以后接入房间时/);
  assert.match(strategy, /六档 AI[\s\S]*local-simple[\s\S]*local-normal[\s\S]*local-hard[\s\S]*local-hell/);
  assert.match(strategy, /高级[\s\S]*(src\/ai-advanced\.js|公开战术上下文)/);
  assert.doesNotMatch(strategy, /尚未接入游戏入口|没有难度入口|开始接入难度入口之前/);
});
