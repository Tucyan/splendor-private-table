import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AiMemoryStore,
  DEFAULT_MEMORY_DIR,
  createEmptyMemory,
  validateMemorySnapshot,
} from '../src/ai-memory-store.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/ai-memory-writer.js', import.meta.url));

async function temporaryStore(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-ai-memory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new AiMemoryStore({ directory, ...options }) };
}

function lesson(id, overrides = {}) {
  return {
    id,
    playerCount: 2,
    targetScore: 15,
    phase: 'midgame',
    trigger: 'buying a high-value card too early',
    recommendation: `prefer ${id}`,
    counterexample: 'none observed',
    evidenceGameId: `game-${id}`,
    sampleCount: 1,
    successCount: 1,
    failureCount: 0,
    confidence: 0.5,
    status: 'candidate',
    ...overrides,
  };
}

function runWriter(directory, gameId, lessonId, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE, directory, gameId, lessonId, JSON.stringify(options)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(`writer exited ${code ?? signal}: ${stderr || stdout}`));
    });
  });
}

test('uses the default memory directory and accepts an explicit directory override', () => {
  assert.match(DEFAULT_MEMORY_DIR, /data[\\/]ai-memory[\\/]deepseek-advanced$/);
  assert.equal(new AiMemoryStore({ directory: 'custom-memory' }).directory.endsWith('custom-memory'), true);
});

test('creates and validates an empty schema version two snapshot', async t => {
  const { store } = await temporaryStore(t);
  const snapshot = await store.readMemory();
  assert.deepEqual(snapshot, createEmptyMemory());
  assert.equal(snapshot.schemaVersion, 2);
  assert.doesNotThrow(() => validateMemorySnapshot(snapshot));
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.processedGameIds, []);
  assert.deepEqual(snapshot.lessons, []);
});

test('reads legacy v1 snapshots by migrating lessons in memory without rewriting the file', async t => {
  const { directory, store } = await temporaryStore(t);
  await mkdir(directory, { recursive: true });
  const v1 = {
    schemaVersion: 1,
    revision: 3,
    strategyVersion: 'deepseek-advanced-v1',
    updatedAt: '2026-09-01T00:00:00.000Z',
    processedGameIds: ['old-game'],
    lessons: [{
      id: 'legacy', playerCount: 2, targetScore: 15, phase: 'mid', trigger: 't',
      recommendation: 'r', counterexample: '', evidenceGameId: 'old-game',
      sampleCount: 2, successCount: 1, failureCount: 0, confidence: 0.5, status: 'candidate',
    }],
  };
  await writeFile(join(directory, 'memory.json'), JSON.stringify(v1));
  const memory = await store.readMemory();
  assert.equal(memory.schemaVersion, 2);
  assert.equal(memory.revision, 3);
  const [migrated] = memory.lessons;
  assert.equal(migrated.id, 'legacy');
  assert.equal(migrated.createdAt, v1.updatedAt);
  assert.equal(migrated.updatedAt, v1.updatedAt);
  assert.deepEqual(migrated.evidenceGameIds, ['old-game']);
  assert.equal(migrated.retirementReason, '');
  assert.doesNotThrow(() => validateMemorySnapshot(memory));
  assert.equal(JSON.parse(await readFile(join(directory, 'memory.json'), 'utf8')).schemaVersion, 1);
  await store.commitExperience('new-game', []);
  assert.equal(JSON.parse(await readFile(join(directory, 'memory.json'), 'utf8')).schemaVersion, 2);
});

test('a structurally invalid v1 snapshot is still never treated as an empty database', async t => {
  const { directory, store } = await temporaryStore(t);
  await mkdir(directory, { recursive: true });
  const brokenV1 = {
    schemaVersion: 1, revision: 1, strategyVersion: 'deepseek-advanced-v1', updatedAt: null,
    processedGameIds: [], lessons: [{ id: 'broken', phase: 'mid' }],
  };
  await writeFile(join(directory, 'memory.json'), JSON.stringify(brokenV1));
  await assert.rejects(store.readMemory(), error => error.code === 'MEMORY_CORRUPT');
});

test('applyReflection commits add, update and retire atomically', async t => {
  const { store } = await temporaryStore(t);
  await store.commitExperience('seed', [lesson('keep'), lesson('drop')]);
  const result = await store.applyReflection('game-ops', [
    { type: 'add', lesson: { playerCount: 2, targetScore: 15, phase: 'late', trigger: 't', recommendation: 'new bounded recommendation', counterexample: '', confidence: 0.5 }, evidenceGameId: 'game-ops' },
    { type: 'update', lessonId: 'keep', patch: { confidence: 0.8 }, evidenceGameId: 'game-ops' },
    { type: 'retire', lessonId: 'drop', reason: 'contradicted by current public evidence', evidenceGameId: 'game-ops' },
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.applied, 3);
  const memory = await store.readMemory();
  assert.deepEqual(memory.processedGameIds, ['seed', 'game-ops']);
  const keep = memory.lessons.find(item => item.id === 'keep');
  assert.equal(keep.confidence, 0.8);
  assert.equal(keep.sampleCount, 2);
  assert.deepEqual(keep.evidenceGameIds, ['game-keep', 'game-ops']);
  assert.equal(keep.status, 'candidate');
  const drop = memory.lessons.find(item => item.id === 'drop');
  assert.equal(drop.status, 'retired');
  assert.equal(drop.retirementReason, 'contradicted by current public evidence');
  const added = memory.lessons.find(item => item.id.startsWith('lesson-'));
  assert.equal(added.status, 'candidate');
  assert.equal(added.sampleCount, 1);
  assert.deepEqual(added.evidenceGameIds, ['game-ops']);
  assert.ok(added.createdAt && added.updatedAt);
});

test('applyReflection replays of the same game do not accumulate samples', async t => {
  const { store } = await temporaryStore(t);
  await store.commitExperience('seed', [lesson('keep')]);
  const operations = [{ type: 'update', lessonId: 'keep', patch: { confidence: 0.7 }, evidenceGameId: 'same-game' }];
  const first = await store.applyReflection('same-game', operations);
  const second = await store.applyReflection('same-game', operations);
  assert.equal(first.committed, true);
  assert.equal(second.committed, false);
  assert.equal(second.applied, 0);
  const memory = await store.readMemory();
  assert.equal(memory.revision, 2);
  assert.equal(memory.lessons.find(item => item.id === 'keep').sampleCount, 2);
});

test('applyReflection re-validates operation targets against the latest locked snapshot', async t => {
  const { store } = await temporaryStore(t);
  await store.commitExperience('seed', [lesson('keep')]);
  await assert.rejects(
    store.applyReflection('bad-ops', [{ type: 'update', lessonId: 'ghost', patch: { confidence: 0.5 }, evidenceGameId: 'bad-ops' }]),
    /lessonId/,
  );
  const memory = await store.readMemory();
  assert.deepEqual(memory.processedGameIds, ['seed']);
  assert.equal(memory.revision, 1);
});

test('applyReflection re-validates operation evidence inside the lock', async t => {
  const { store } = await temporaryStore(t);
  await assert.rejects(
    store.applyReflection('locked-game', [{
      type: 'add',
      lesson: { recommendation: 'must be rejected' },
      evidenceGameId: 'different-game',
    }]),
    error => error.code === 'LLM_OPERATIONS_INVALID' && /evidenceGameId/i.test(error.message),
  );
  assert.deepEqual((await store.readMemory()).processedGameIds, []);
});

test('concurrent reflections touching different lessons do not lose updates', async t => {
  const { store } = await temporaryStore(t);
  await store.commitExperience('seed', [lesson('a'), lesson('b')]);
  await Promise.all([
    store.applyReflection('ga', [{ type: 'update', lessonId: 'a', patch: { confidence: 0.9 }, evidenceGameId: 'ga' }]),
    store.applyReflection('gb', [{ type: 'update', lessonId: 'b', patch: { confidence: 0.1 }, evidenceGameId: 'gb' }]),
  ]);
  const memory = await store.readMemory();
  assert.equal(memory.revision, 3);
  assert.deepEqual([...memory.processedGameIds].sort(), ['ga', 'gb', 'seed']);
  assert.equal(memory.lessons.find(item => item.id === 'a').confidence, 0.9);
  assert.equal(memory.lessons.find(item => item.id === 'b').confidence, 0.1);
});

test('rejects invalid snapshots and never treats a corrupt primary as an empty database', async t => {
  const { directory, store } = await temporaryStore(t);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'memory.json'), '{not-json');
  await assert.rejects(store.readMemory(), error => error.code === 'MEMORY_CORRUPT');
  assert.throws(() => validateMemorySnapshot({ schemaVersion: 1 }), /schema|revision/i);
});

test('persists jobs and episodes so a fresh store can resume them', async t => {
  const { directory, store } = await temporaryStore(t);
  await store.saveJob('g1', { status: 'pending', attempts: 0, payload: { score: 12 } });
  await store.saveEpisode('g1', { gameId: 'g1', outcome: 'finished', publicEvents: [{ type: 'buy' }] });
  const restarted = new AiMemoryStore({ directory });
  assert.deepEqual(await restarted.loadJob('g1'), {
    gameId: 'g1', status: 'pending', attempts: 0, payload: { score: 12 },
  });
  assert.deepEqual(await restarted.loadEpisode('g1'), {
    gameId: 'g1', outcome: 'finished', publicEvents: [{ type: 'buy' }],
  });
});

test('serializes same-process writes in FIFO order and merges the latest locked snapshot', async t => {
  const { store } = await temporaryStore(t);
  const order = [];
  store.beforeCommit = async gameId => {
    order.push(`${gameId}-start`);
    if (gameId === 'g1') await new Promise(resolve => setTimeout(resolve, 20));
    order.push(`${gameId}-end`);
  };
  const first = store.commitExperience('g1', [lesson('first')]);
  const second = store.commitExperience('g2', [lesson('second')]);
  await Promise.all([first, second]);
  assert.deepEqual(order, ['g1-start', 'g1-end', 'g2-start', 'g2-end']);
  const snapshot = await store.readMemory();
  assert.equal(snapshot.revision, 2);
  assert.deepEqual(snapshot.processedGameIds, ['g1', 'g2']);
  assert.deepEqual(snapshot.lessons.map(item => item.id), ['first', 'second']);
});

test('shares the FIFO queue across store instances targeting the same directory', async t => {
  const { directory } = await temporaryStore(t);
  const firstStore = new AiMemoryStore({ directory });
  const secondStore = new AiMemoryStore({ directory });
  const order = [];
  firstStore.beforeCommit = async () => {
    order.push('first-start');
    await new Promise(resolve => setTimeout(resolve, 20));
    order.push('first-end');
  };
  secondStore.beforeCommit = async () => order.push('second');
  await Promise.all([
    firstStore.commitExperience('first', [lesson('first')]),
    secondStore.commitExperience('second', [lesson('second')]),
  ]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  assert.equal((await firstStore.readMemory()).revision, 2);
});

test('committing the same game id twice is idempotent', async t => {
  const { store } = await temporaryStore(t);
  const first = await store.commitExperience('same-game', [lesson('same', { sampleCount: 2 })]);
  const second = await store.commitExperience('same-game', [lesson('same', { sampleCount: 9 })]);
  assert.equal(first.committed, true);
  assert.equal(second.committed, false);
  const snapshot = await store.readMemory();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.lessons[0].sampleCount, 2);
});

test('keeps a verified previous backup and recovers a corrupt primary with a warning', async t => {
  const { directory, store } = await temporaryStore(t);
  await store.commitExperience('g1', [lesson('one')]);
  await store.commitExperience('g2', [lesson('two')]);
  await writeFile(join(directory, 'memory.json'), '{broken');
  const result = await store.readMemory({ withWarnings: true });
  assert.equal(result.memory.revision, 1);
  assert.deepEqual(result.memory.processedGameIds, ['g1']);
  assert.match(result.warnings.join(' '), /backup|previous|corrupt/i);
});

test('does not overwrite the verified backup when committing after primary corruption', async t => {
  const { directory, store } = await temporaryStore(t);
  await store.commitExperience('g1', [lesson('one')]);
  await store.commitExperience('g2', [lesson('two')]);
  await writeFile(join(directory, 'memory.json'), '{broken');
  await store.commitExperience('g3', [lesson('three')]);
  const backup = JSON.parse(await readFile(join(directory, 'memory.previous.json'), 'utf8'));
  assert.deepEqual(backup.processedGameIds, ['g1']);
  assert.deepEqual((await store.readMemory()).processedGameIds, ['g1', 'g3']);
});

test('recovers a missing primary from a valid backup and rejects a corrupt backup', async t => {
  const { directory, store } = await temporaryStore(t);
  await store.commitExperience('g1', [lesson('one')]);
  await store.commitExperience('g2', [lesson('two')]);
  await rm(join(directory, 'memory.json'));
  const recovered = await store.readMemory({ withWarnings: true });
  assert.deepEqual(recovered.memory.processedGameIds, ['g1']);
  await writeFile(join(directory, 'memory.previous.json'), '{broken');
  await rm(join(directory, 'memory.json'), { force: true });
  await assert.rejects(store.readMemory(), error => error.code === 'MEMORY_CORRUPT');
});

test('waits for a live lock owner and reports a bounded memory busy error', async t => {
  const { directory, store } = await temporaryStore(t, { lockWaitMs: 60, lockPollMs: 10 });
  await mkdir(join(directory, 'memory.lock'));
  await writeFile(join(directory, 'memory.lock', 'owner.json'), JSON.stringify({
    token: 'live', pid: process.pid, hostname: store.hostname, createdAt: new Date().toISOString(),
  }));
  await assert.rejects(store.commitExperience('busy', [lesson('busy')]), error => error.code === 'MEMORY_BUSY');
  assert.equal((await store.readMemory()).revision, 0);
});

test('recovers a lock only when its recorded owner process is absent', async t => {
  const { directory, store } = await temporaryStore(t, { lockWaitMs: 200, lockPollMs: 10 });
  await mkdir(join(directory, 'memory.lock'));
  await writeFile(join(directory, 'memory.lock', 'owner.json'), JSON.stringify({
    token: 'dead', pid: 2147483647, hostname: store.hostname, createdAt: new Date().toISOString(),
  }));
  const result = await store.commitExperience('recovered', [lesson('recovered')]);
  assert.equal(result.committed, true);
  assert.deepEqual((await store.readMemory()).processedGameIds, ['recovered']);
});

test('two independent processes retain both lessons and monotonically increase revision', async t => {
  const { directory } = await temporaryStore(t, { lockWaitMs: 2000 });
  const results = await Promise.all([
    runWriter(directory, 'child-a', 'a', { holdMs: 30 }),
    runWriter(directory, 'child-b', 'b', { holdMs: 0 }),
  ]);
  assert.deepEqual(results.map(result => result.committed).sort(), [true, true]);
  const snapshot = await new AiMemoryStore({ directory }).readMemory();
  assert.equal(snapshot.revision, 2);
  assert.deepEqual(snapshot.processedGameIds.sort(), ['child-a', 'child-b']);
  assert.deepEqual(snapshot.lessons.map(item => item.id).sort(), ['a', 'b']);
});

test('preserves old memory and leaves a pending result when atomic replacement fails', async t => {
  const { directory } = await temporaryStore(t);
  const initial = new AiMemoryStore({ directory });
  await initial.commitExperience('g1', [lesson('one')]);
  const failing = new AiMemoryStore({ directory, replaceFile: async () => { throw Object.assign(new Error('replace failed'), { code: 'EACCES' }); } });
  await assert.rejects(failing.commitExperience('g2', [lesson('two')]), /replace failed/);
  const snapshot = await new AiMemoryStore({ directory }).readMemory();
  assert.deepEqual(snapshot.processedGameIds, ['g1']);
  assert.equal(snapshot.lessons.some(item => item.id === 'two'), false);
});

test('tracks retry attempts and caps them at three', async t => {
  const { store } = await temporaryStore(t);
  let job = await store.saveJob('retry-game', { status: 'pending', attempts: 0 });
  assert.equal(job.attempts, 0);
  for (let i = 0; i < 3; i++) job = await store.recordJobAttempt('retry-game', { error: `failure-${i}` });
  assert.equal(job.attempts, 3);
  assert.equal(job.status, 'failed');
  await assert.rejects(store.recordJobAttempt('retry-game', { error: 'too many' }), error => error.code === 'ATTEMPTS_EXCEEDED');
});

test('rejects jobs whose persisted attempt metadata exceeds the retry cap', async t => {
  const { store } = await temporaryStore(t);
  await assert.rejects(store.saveJob('too-many', { status: 'pending', attempts: 4 }), error => error.code === 'ATTEMPTS_INVALID');
});
