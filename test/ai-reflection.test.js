import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiMemoryStore } from '../src/ai-memory-store.js';
import { createEndSnapshot, buildReflectionPrompt, selectRelevantLessons, ReflectionCoordinator } from '../src/ai-reflection.js';

const game = () => ({ status: 'finished', endReason: 'host', finishScore: 8, turnOrder: ['a','b'], winners: ['a'], players: [{ id:'a', score:8, cards:[], nobles:[] }, { id:'b', score:4, cards:[], nobles:[] }], log: Array.from({length:20}, (_,i)=>({playerId:'a',text:`event ${i}`})) });

const llmConfig = Object.freeze({
  enabled: true,
  apiKey: 'reflection-secret',
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

const addOperation = (gameId, overrides = {}) => ({
  type: 'add',
  lesson: { playerCount: 2, targetScore: 8, phase: 'late', trigger: 't', recommendation: 'deny late leaders', counterexample: '', confidence: 0.5, ...overrides },
  evidenceGameId: gameId,
});

async function tempStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-reflection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AiMemoryStore({ directory });
}

const snapshotOf = gameId => createEndSnapshot(game(), { gameId, players: [{ id:'ai', ai:true, mode:'llm-advanced' }] });

test('end snapshots are bounded and de-identified', () => {
  const snapshot = snapshotOf('g1');
  assert.equal(snapshot.evidence.length, 12); assert.deepEqual(snapshot.observers, ['ai']); assert.equal(snapshot.players[0].cards, 0);
});

test('reflection prompt is a system/user pair with JSON schema, example and gameId', () => {
  const messages = buildReflectionPrompt(snapshotOf('prompt-game'));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /json/i);
  assert.match(messages[0].content, /"operations"/);
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[1].content.includes('prompt-game'));
  assert.ok(messages[1].content.includes('existingLessons'));
});

test('relevant lessons prefer matching table shape and never leak internal fields', () => {
  const lessons = [
    { id: 'off', playerCount: 4, targetScore: 21, phase: 'early', trigger: 't', recommendation: 'r', counterexample: '', confidence: 0.4, status: 'candidate', sampleCount: 9, evidenceGameIds: ['x'], processedGameIds: ['y'] },
    { id: 'match', playerCount: 2, targetScore: 8, phase: 'late', trigger: 't', recommendation: 'r', counterexample: '', confidence: 0.6, status: 'active', sampleCount: 9, evidenceGameIds: ['x'] },
    { id: 'retired', playerCount: 2, targetScore: 8, phase: 'late', trigger: 't', recommendation: 'r', counterexample: '', confidence: 0.6, status: 'retired' },
  ];
  const selected = selectRelevantLessons(lessons, snapshotOf('gx'));
  assert.deepEqual(selected.map(lesson => lesson.id), ['match', 'off']);
  assert.deepEqual(Object.keys(selected[0]).sort(), ['confidence', 'counterexample', 'id', 'phase', 'playerCount', 'recommendation', 'status', 'targetScore', 'trigger']);
});

test('reflection commits added lessons parsed from choices[0].message.content', async t => {
  const store = await tempStore(t);
  let request;
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return completion({ operations: [addOperation('g-live')] }); },
  });
  const result = await coordinator.reflect(snapshotOf('g-live'));
  assert.deepEqual(result, { status: 'saved', committed: true, lessons: 1 });
  assert.equal(request.url, llmConfig.apiUrl);
  assert.equal(request.body.model, 'reflection-model');
  assert.equal(request.body.messages[0].role, 'system');
  assert.match(request.body.messages[0].content, /json/i);
  assert.match(request.body.messages[0].content, /"operations"/);
  assert.ok(request.body.messages[1].content.includes('g-live'));
  const memory = await store.readMemory();
  assert.deepEqual(memory.processedGameIds, ['g-live']);
  assert.equal(memory.lessons.length, 1);
  assert.equal(memory.lessons[0].status, 'candidate');
  assert.deepEqual(memory.lessons[0].evidenceGameIds, ['g-live']);
  assert.equal((await store.loadJob('g-live')).status, 'completed');
  assert.ok(!JSON.stringify(request.body).includes(llmConfig.apiKey));
});

test('reflection shows relevant existing lessons and applies model revisions', async t => {
  const store = await tempStore(t);
  await store.commitExperience('seed', [{
    id: 'known', playerCount: 2, targetScore: 8, phase: 'late', trigger: 'old trigger',
    recommendation: 'old recommendation', counterexample: '', evidenceGameId: 'seed',
    sampleCount: 1, successCount: 0, failureCount: 0, confidence: 0.5, status: 'candidate',
  }]);
  let request;
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async (url, options) => {
      request = JSON.parse(options.body);
      return completion({ operations: [{ type: 'update', lessonId: 'known', patch: { recommendation: 'revised recommendation', confidence: 0.7 }, evidenceGameId: 'g-revise' }] });
    },
  });
  const result = await coordinator.reflect(snapshotOf('g-revise'));
  assert.deepEqual(result, { status: 'saved', committed: true, lessons: 1 });
  const shown = JSON.parse(request.messages[1].content).existingLessons;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, 'known');
  assert.equal(shown[0].recommendation, 'old recommendation');
  assert.equal(Object.hasOwn(shown[0], 'sampleCount'), false);
  const memory = await store.readMemory();
  const revised = memory.lessons.find(lesson => lesson.id === 'known');
  assert.equal(revised.recommendation, 'revised recommendation');
  assert.equal(revised.confidence, 0.7);
  assert.equal(revised.sampleCount, 2);
  assert.deepEqual(revised.evidenceGameIds, ['seed', 'g-revise']);
});

test('reflection retires lessons the model marks as contradicted', async t => {
  const store = await tempStore(t);
  await store.commitExperience('seed', [{
    id: 'obsolete', playerCount: 2, targetScore: 8, phase: 'late', trigger: 't',
    recommendation: 'outdated', counterexample: '', evidenceGameId: 'seed',
    sampleCount: 1, successCount: 0, failureCount: 0, confidence: 0.5, status: 'candidate',
  }]);
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async () => completion({ operations: [{ type: 'retire', lessonId: 'obsolete', reason: 'contradicted by current public evidence', evidenceGameId: 'g-retire' }] }),
  });
  const result = await coordinator.reflect(snapshotOf('g-retire'));
  assert.equal(result.status, 'saved');
  const retired = (await store.readMemory()).lessons.find(lesson => lesson.id === 'obsolete');
  assert.equal(retired.status, 'retired');
  assert.equal(retired.retirementReason, 'contradicted by current public evidence');
});

test('replaying a reflected game does not commit twice', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({ store, llmConfig, fetchImpl: async () => completion({ operations: [] }) });
  assert.equal((await coordinator.reflect(snapshotOf('g-replay'))).committed, true);
  const replay = await coordinator.reflect(snapshotOf('g-replay'));
  assert.deepEqual(replay, { status: 'saved', committed: false, lessons: 0 });
  assert.deepEqual((await store.readMemory()).processedGameIds, ['g-replay']);
});

test('an empty operations list commits the gameId with zero changes', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({ store, llmConfig, fetchImpl: async () => completion({ operations: [] }) });
  const result = await coordinator.reflect(snapshotOf('g-empty'));
  assert.deepEqual(result, { status: 'saved', committed: true, lessons: 0 });
  const memory = await store.readMemory();
  assert.deepEqual(memory.processedGameIds, ['g-empty']);
  assert.equal(memory.lessons.length, 0);
  assert.equal((await store.loadJob('g-empty')).lessons, 0);
});

test('HTTP error codes are persisted on the job without provider details', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => `{"error":{"message":"bad request ${llmConfig.apiKey}"}}` }),
  });
  const result = await coordinator.reflect(snapshotOf('g-http-400'));
  assert.equal(result.status, 'failed');
  assert.equal(result.reasonCode, 'LLM_HTTP_400');
  const job = await store.loadJob('g-http-400');
  assert.equal(job.attempts, 1);
  assert.match(job.lastError, /LLM_HTTP_400/);
  assert.ok(!job.lastError.includes(llmConfig.apiKey));
  assert.deepEqual((await store.readMemory()).processedGameIds, []);
});

test('an empty completion content never commits processedGameIds', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }) }),
  });
  const result = await coordinator.reflect(snapshotOf('g-blank'));
  assert.equal(result.status, 'failed');
  assert.equal(result.reasonCode, 'LLM_EMPTY_CONTENT');
  assert.deepEqual((await store.readMemory()).processedGameIds, []);
});

test('a syntactically invalid completion body commits no experience', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] }) }),
  });
  const result = await coordinator.reflect(snapshotOf('g-invalid'));
  assert.equal(result.status, 'failed');
  assert.equal(result.reasonCode, 'LLM_INVALID_JSON');
  const memory = await store.readMemory();
  assert.deepEqual(memory.processedGameIds, []);
  assert.equal(memory.lessons.length, 0);
});

test('a successful response whose operations lack current-game evidence is rejected', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async () => completion({ operations: [{ type: 'add', lesson: { recommendation: 'unsupported claim' } }] }),
  });
  const result = await coordinator.reflect(snapshotOf('g-no-evidence'));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /evidence/i);
  assert.deepEqual((await store.readMemory()).processedGameIds, []);
  assert.equal((await store.loadJob('g-no-evidence')).attempts, 1);
});

test('operations that overstep the whitelist never reach the memory store', async t => {
  const store = await tempStore(t);
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async () => completion({ operations: [{ type: 'add', lesson: { recommendation: 'x', status: 'active' }, evidenceGameId: 'g-overstep' }] }),
  });
  const result = await coordinator.reflect(snapshotOf('g-overstep'));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /status/);
  assert.equal((await store.readMemory()).lessons.length, 0);
});

test('a disabled LLM config skips reflection without any network call', async t => {
  const store = await tempStore(t);
  let called = 0;
  const coordinator = new ReflectionCoordinator({ store, fetchImpl: async () => { called++; } });
  assert.deepEqual(await coordinator.reflect(snapshotOf('g2')), { status: 'skipped', reason: 'llm_disabled' });
  assert.equal(called, 0);
});
