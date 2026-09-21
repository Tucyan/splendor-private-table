import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiMemoryStore } from '../src/ai-memory-store.js';
import { createEndSnapshot, validateReflectionResponse, buildReflectionPrompt, ReflectionCoordinator } from '../src/ai-reflection.js';

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

test('reflection operations become bounded candidate lessons', () => {
  const lessons = validateReflectionResponse({ operations: Array.from({length:20}, (_,i)=>({ type:'add', id:`l${i}`, recommendation:'x' })) });
  assert.equal(lessons.length, 8); assert.ok(lessons.every(lesson => lesson.status === 'candidate'));
});

test('an empty operations list is a valid no-lesson reflection', () => {
  assert.deepEqual(validateReflectionResponse({ operations: [] }), []);
});

test('reflection responses without an operations array are rejected', () => {
  assert.throws(() => validateReflectionResponse({ lessons: [] }), /operations/);
  assert.throws(() => validateReflectionResponse({ operations: {} }), /operations/);
});

test('operation types the server cannot apply yet are rejected safely', () => {
  assert.throws(() => validateReflectionResponse({ operations: [{ type:'retire', lessonId:'x' }] }), /type/);
  assert.throws(() => validateReflectionResponse({ operations: [{ type:'update', lessonId:'x', patch:{} }] }), /type/);
  assert.throws(() => validateReflectionResponse({ operations: ['nope'] }), /operation/);
});

test('operations must carry evidence from the current game when required', () => {
  assert.throws(
    () => validateReflectionResponse({ operations: [{ type:'add', recommendation:'x', evidenceGameId:'other-game' }] }, { requireEvidence: true, gameId: 'this-game' }),
    /evidence/,
  );
  const [lesson] = validateReflectionResponse({ operations: [{ type:'add', recommendation:'x', evidenceGameId:'this-game' }] }, { requireEvidence: true, gameId: 'this-game' });
  assert.equal(lesson.evidenceGameId, 'this-game');
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

test('reflection commits lessons parsed from choices[0].message.content', async t => {
  const store = await tempStore(t);
  let request;
  const coordinator = new ReflectionCoordinator({
    store, llmConfig,
    fetchImpl: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return completion({ operations: [{ type:'add', recommendation:'deny late leaders', evidenceGameId:'g-live', confidence:0.5 }] }); },
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
  assert.equal((await store.loadJob('g-live')).status, 'completed');
  assert.ok(!JSON.stringify(request.body).includes(llmConfig.apiKey));
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
    fetchImpl: async () => completion({ operations: [{ type:'add', recommendation:'unsupported claim' }] }),
  });
  const result = await coordinator.reflect(snapshotOf('g-no-evidence'));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /evidence/i);
  assert.deepEqual((await store.readMemory()).processedGameIds, []);
  assert.equal((await store.loadJob('g-no-evidence')).attempts, 1);
});

test('a disabled LLM config skips reflection without any network call', async t => {
  const store = await tempStore(t);
  let called = 0;
  const coordinator = new ReflectionCoordinator({ store, fetchImpl: async () => { called++; } });
  assert.deepEqual(await coordinator.reflect(snapshotOf('g2')), { status: 'skipped', reason: 'llm_disabled' });
  assert.equal(called, 0);
});
