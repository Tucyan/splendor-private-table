import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AiMemoryStore } from '../src/ai-memory-store.js';
import { ReflectionCoordinator } from '../src/ai-reflection.js';
import { RoomStore } from '../src/rooms.js';

const llmConfig = Object.freeze({
  enabled: true,
  apiKey: 'reflection-fixture-key',
  apiUrl: 'https://llm.example/v1/chat/completions',
  model: 'base-model',
  advancedModel: 'advanced-model',
  reflectionModel: 'reflection-model',
  timeoutMs: 5000,
  extraBody: {},
});

// Mirrors the real Chat Completions envelope: content is a JSON string one level down.
const completion = payload => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 10, completion_tokens: 10 },
  }),
});

const snapshot = gameId => ({
  gameId,
  status: 'finished',
  endReason: 'normal',
  finishScore: 15,
  turnOrder: ['a', 'b'],
  winners: ['a'],
  players: [{ id: 'a', score: 15, cards: 3, nobles: 1 }, { id: 'b', score: 8, cards: 2, nobles: 0 }],
  observers: ['ai'],
  evidence: [{ playerId: 'a', text: 'bought a card' }],
});

async function tempStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-reflection-lifecycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AiMemoryStore({ directory });
}

test('malformed reflection JSON is retried as a durable job attempt', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({
    store,
    llmConfig,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
  });
  const result = await coordinator.reflect(snapshot('malformed'));
  assert.equal(result.status, 'failed');
  assert.equal(result.reasonCode, 'LLM_INVALID_JSON');
  assert.equal((await store.loadJob('malformed')).attempts, 1);
});

test('missing lesson evidence is rejected and recorded without committing memory', async t => {
  const store = await tempStore(t);
  let calls = 0;
  const coordinator = new ReflectionCoordinator({ store, llmConfig, fetchImpl: async () => {
    calls++;
    return completion({ operations: [{ type: 'add', lesson: { recommendation: 'x' } }] });
  } });
  const incomplete = snapshot('missing-evidence');
  const result = await coordinator.reflect(incomplete);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /evidence/i);
  assert.equal(calls, 1);
  assert.equal((await store.loadJob('missing-evidence')).attempts, 1);
  assert.deepEqual((await store.readMemory()).processedGameIds, []);
});

test('restart recovery scans pending jobs and stops after three attempts', async t => {
  const store = await tempStore(t);
  await store.saveEpisode('recover-me', snapshot('recover-me'));
  await store.saveJob('recover-me', { status: 'pending', attempts: 0 });
  const coordinator = new ReflectionCoordinator({ store, llmConfig, fetchImpl: async () => { throw new Error('offline'); } });
  for (let i = 0; i < 3; i++) await coordinator.recoverPending();
  const job = await store.loadJob('recover-me');
  assert.equal(job.attempts, 3);
  assert.equal(job.status, 'failed');
});

test('advanced start waits for pending reflection jobs before creating a game', async t => {
  const memoryStore = await tempStore(t);
  await memoryStore.saveEpisode('old-game', snapshot('old-game'));
  await memoryStore.saveJob('old-game', { status: 'pending', attempts: 0 });
  const store = new RoomStore({ llmConfig, memoryStore, reflectionBarrierMs: 200, fetchImpl: async () => completion({ operations: [] }) });
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  store.addAI(host, 'llm-advanced');
  const pending = store.start(host);
  assert.equal(store.room(host).game, null);
  await pending;
  assert.equal(store.room(host).game.status, 'playing');
  assert.notEqual(store.room(host).aiStatus?.state, 'memory_busy');
});

test('advanced start continues with previous experience after the sync deadline', async t => {
  const memoryStore = await tempStore(t);
  await memoryStore.saveEpisode('stuck-game', snapshot('stuck-game'));
  await memoryStore.saveJob('stuck-game', { status: 'pending', attempts: 0 });
  const store = new RoomStore({
    llmConfig, memoryStore, reflectionBarrierMs: 25, reflectionTimeoutMs: 100,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  store.addAI(host, 'llm-advanced');
  await store.start(host);
  assert.equal(store.room(host).game.status, 'playing');
  assert.equal(store.room(host).aiStatus.state, 'memory_busy');
  assert.match(store.room(host).aiStatus.notice, /上次经验/);
  await delay(5);
});

test('advanced start reports a sync failure but still starts with previous experience', async t => {
  const memoryStore = await tempStore(t);
  await memoryStore.saveEpisode('corrupt-index', snapshot('corrupt-index'));
  await memoryStore.saveJob('corrupt-index', { status: 'pending', attempts: 0 });
  memoryStore.listJobs = async () => { throw new Error('job index unavailable'); };
  const store = new RoomStore({ llmConfig, memoryStore });
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  store.addAI(host, 'llm-advanced');
  await store.start(host);
  assert.equal(store.room(host).game.status, 'playing');
  assert.equal(store.room(host).aiStatus.state, 'sync_failed');
  assert.equal(store.room(host).aiStatus.continueWithPrevious, true);
});

test('concurrent advanced start requests share one synchronization barrier', async t => {
  const memoryStore = await tempStore(t);
  await memoryStore.saveEpisode('one-job', snapshot('one-job'));
  await memoryStore.saveJob('one-job', { status: 'pending', attempts: 0 });
  let release;
  const store = new RoomStore({
    llmConfig, memoryStore, reflectionBarrierMs: 500,
    fetchImpl: async () => new Promise(resolve => { release = () => resolve(completion({ operations: [] })); }),
  });
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  store.addAI(host, 'llm-advanced');
  const first = store.start(host);
  const second = store.start(host);
  assert.strictEqual(second, first);
  for (let i = 0; i < 100 && !release; i++) await delay(5);
  assert.equal(typeof release, 'function');
  release();
  await first;
  assert.equal(store.room(host).game.status, 'playing');
});

test('host-ended advanced games do not save reflection experience', async t => {
  const memoryStore = await tempStore(t);
  const store = new RoomStore({ llmConfig, memoryStore, fetchImpl: async () => completion({ operations: [] }) });
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  store.addAI(host, 'llm-advanced');
  store.start(host);
  const room = store.room(host);
  store.finish(host);
  assert.equal(room.game.status, 'finished');
  await delay(30);
  assert.equal(room.reflectionStatus, null);
  const memory = await memoryStore.readMemory();
  assert.deepEqual(memory.processedGameIds, []);
  assert.equal(memory.lessons.length, 0);
});

test('normally completed advanced games save reflection experience', async t => {
  const memoryStore = await tempStore(t);
  const store = new RoomStore({ llmConfig, memoryStore, fetchImpl: async () => completion({ operations: [] }) });
  t.after(() => store.close());
  const host = store.register(null, '房主');
  const guest = store.register(null, '来宾');
  store.create(host);
  store.join(guest, store.room(host).code);
  store.addAI(host, 'llm-advanced');
  const room = store.room(host);
  store.start(host);
  room.gameId = 'normal-finished';
  room.game.status = 'finished';
  room.game.endReason = 'normal';
  room.game.winners = [host.id];
  room.reflectionStatus = { state: 'syncing', status: 'syncing' };
  store.queueReflection(room);
  for (let i = 0; i < 100 && room.reflectionStatus?.state !== 'saved'; i++) await delay(5);
  assert.deepEqual(room.reflectionStatus, { state: 'saved', status: 'saved', lessons: 0 });
  assert.deepEqual((await memoryStore.readMemory()).processedGameIds, ['normal-finished']);
});

test('basic LLM and local starts bypass reflection synchronization', async t => {
  for (const mode of ['llm-basic', 'local-simple']) {
    const memoryStore = await tempStore(t);
    await memoryStore.saveEpisode(`bypass-${mode}`, snapshot(`bypass-${mode}`));
    await memoryStore.saveJob(`bypass-${mode}`, { status: 'pending', attempts: 0 });
    const store = new RoomStore({ llmConfig, memoryStore, reflectionBarrierMs: 25, fetchImpl: async () => new Promise(() => {}) });
    t.after(() => store.close());
    const host = store.register(null, `房主-${mode}`);
    const guest = store.register(null, `来宾-${mode}`);
    store.create(host);
    store.join(guest, store.room(host).code);
    store.addAI(host, mode);
    const result = store.start(host);
    assert.equal(store.room(host).game.status, 'playing');
    assert.equal(result, undefined);
  }
});
