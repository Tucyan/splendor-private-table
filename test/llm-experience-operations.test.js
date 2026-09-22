import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExperienceOperations, applyExperienceOperations } from '../src/llm-experience-operations.js';

const NOW = '2026-09-21T00:00:00.000Z';
const GAME = 'current-game';

const existingLesson = (id, overrides = {}) => ({
  id,
  playerCount: 2,
  targetScore: 15,
  phase: 'late',
  trigger: 'opponent can finish next turn',
  recommendation: 'prefer a legal denial action when it preserves a winning route',
  counterexample: 'do not deny when an immediate winning purchase exists',
  sampleCount: 3,
  successCount: 2,
  failureCount: 1,
  confidence: 0.55,
  status: 'candidate',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  evidenceGameIds: ['old-game'],
  retirementReason: '',
  ...overrides,
});

const memoryWith = (lessons, overrides = {}) => ({
  schemaVersion: 2,
  revision: 7,
  strategyVersion: 'deepseek-advanced-v1',
  updatedAt: NOW,
  processedGameIds: ['old-game'],
  lessons,
  ...overrides,
});

const addOperation = (overrides = {}) => ({
  type: 'add',
  lesson: {
    playerCount: 2,
    targetScore: 15,
    phase: 'late',
    trigger: 'opponent can finish next turn',
    recommendation: 'prefer a legal denial action when it preserves a winning route',
    counterexample: 'do not deny when an immediate winning purchase exists',
    confidence: 0.55,
  },
  evidenceGameId: GAME,
  ...overrides,
});

test('accepts a bounded mix of add, update and retire operations', () => {
  const existing = [existingLesson('keep'), existingLesson('drop')];
  const operations = validateExperienceOperations({
    operations: [
      addOperation(),
      { type: 'update', lessonId: 'keep', patch: { recommendation: 'revised bounded recommendation', confidence: 0.65 }, evidenceGameId: GAME },
      { type: 'retire', lessonId: 'drop', reason: 'contradicted by current public evidence', evidenceGameId: GAME },
    ],
  }, { gameId: GAME, existingLessons: existing });
  assert.deepEqual(operations.map(operation => operation.type), ['add', 'update', 'retire']);
  assert.equal(Object.hasOwn(operations[0].lesson, 'id'), false);
  assert.deepEqual(operations[1].patch, { recommendation: 'revised bounded recommendation', confidence: 0.65 });
});

test('caps the operation count at the configured maximum', () => {
  const operations = validateExperienceOperations(
    { operations: Array.from({ length: 20 }, () => addOperation()) },
    { gameId: GAME, existingLessons: [], maxOperations: 8 },
  );
  assert.equal(operations.length, 8);
});

test('rejects responses without an operations array and non-object operations', () => {
  assert.throws(() => validateExperienceOperations({ lessons: [] }, { gameId: GAME }), /operations/);
  assert.throws(() => validateExperienceOperations({ operations: ['nope'] }, { gameId: GAME }), /operation/);
});

test('rejects unknown operation types', () => {
  assert.throws(
    () => validateExperienceOperations({ operations: [{ type: 'delete', lessonId: 'x', evidenceGameId: GAME }] }, { gameId: GAME }),
    /type/,
  );
});

test('rejects operations whose evidence does not reference the current game', () => {
  for (const operation of [
    addOperation({ evidenceGameId: 'other-game' }),
    { type: 'update', lessonId: 'keep', patch: { confidence: 0.6 }, evidenceGameId: '' },
    { type: 'retire', lessonId: 'keep', reason: 'stale', evidenceGameId: 'other-game' },
  ]) {
    assert.throws(
      () => validateExperienceOperations({ operations: [operation] }, { gameId: GAME, existingLessons: [existingLesson('keep')] }),
      /evidence/,
    );
  }
});

test('rejects update and retire operations targeting unknown lessons', () => {
  assert.throws(
    () => validateExperienceOperations({ operations: [{ type: 'update', lessonId: 'ghost', patch: { confidence: 0.6 }, evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: [] }),
    /lessonId/,
  );
  assert.throws(
    () => validateExperienceOperations({ operations: [{ type: 'retire', lessonId: 'ghost', reason: 'stale', evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: [] }),
    /lessonId/,
  );
});

test('rejects overlong text instead of silently truncating it', () => {
  assert.throws(
    () => validateExperienceOperations({ operations: [addOperation({ lesson: { ...addOperation().lesson, trigger: 'x'.repeat(501) } })] }, { gameId: GAME }),
    /trigger/,
  );
  assert.throws(
    () => validateExperienceOperations({ operations: [{ type: 'retire', lessonId: 'keep', reason: 'x'.repeat(501), evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: [existingLesson('keep')] }),
    /reason/,
  );
});

test('rejects illegal confidence values', () => {
  for (const confidence of [2, -0.1, 'high', Number.NaN]) {
    assert.throws(
      () => validateExperienceOperations({ operations: [addOperation({ lesson: { ...addOperation().lesson, confidence } })] }, { gameId: GAME }),
      /confidence/,
    );
  }
});

test('rejects add lessons that try to set server-owned fields', () => {
  for (const key of ['id', 'status', 'sampleCount', 'processedGameIds', 'evidenceGameIds', 'createdAt']) {
    assert.throws(
      () => validateExperienceOperations({ operations: [addOperation({ lesson: { ...addOperation().lesson, [key]: key === 'status' ? 'active' : 'x' } })] }, { gameId: GAME }),
      new RegExp(key),
    );
  }
});

test('rejects update patches with server-owned or unknown fields and empty patches', () => {
  const existing = [existingLesson('keep')];
  for (const patch of [{ status: 'active' }, { id: 'hijack' }, { sampleCount: 99 }, { unknownField: 1 }, {}]) {
    assert.throws(
      () => validateExperienceOperations({ operations: [{ type: 'update', lessonId: 'keep', patch, evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: existing }),
      /patch/,
    );
  }
});

test('rejects updates and retire operations that would resurrect retired lessons', () => {
  const existing = [existingLesson('dead', { status: 'retired', retirementReason: 'obsolete' })];
  assert.throws(
    () => validateExperienceOperations({ operations: [{ type: 'update', lessonId: 'dead', patch: { confidence: 0.9 }, evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: existing }),
    /retired/,
  );
  assert.throws(
    () => validateExperienceOperations({ operations: [{ type: 'retire', lessonId: 'dead', reason: 'again', evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: existing }),
    /retired/,
  );
});

test('requires a bounded reason for retire operations', () => {
  const existing = [existingLesson('keep')];
  for (const reason of ['', null, 'x'.repeat(501)]) {
    assert.throws(
      () => validateExperienceOperations({ operations: [{ type: 'retire', lessonId: 'keep', reason, evidenceGameId: GAME }] }, { gameId: GAME, existingLessons: existing }),
      /reason/,
    );
  }
});

test('apply creates server-owned identities for added lessons', () => {
  const memory = memoryWith([]);
  let ids = 0;
  const next = applyExperienceOperations(memory, [
    { type: 'add', lesson: { playerCount: 3, targetScore: 12, phase: 'early', trigger: 't', recommendation: 'r', counterexample: '', confidence: 0.4 }, evidenceGameId: GAME },
  ], { gameId: GAME, now: NOW, createId: () => `server-${++ids}` });
  const [lesson] = next.lessons;
  assert.equal(lesson.id, 'server-1');
  assert.equal(lesson.status, 'candidate');
  assert.equal(lesson.sampleCount, 1);
  assert.equal(lesson.createdAt, NOW);
  assert.equal(lesson.updatedAt, NOW);
  assert.deepEqual(lesson.evidenceGameIds, [GAME]);
  assert.equal(lesson.retirementReason, '');
  assert.equal(next.revision, memory.revision + 1);
  assert.deepEqual(next.processedGameIds, ['old-game', GAME]);
});

test('apply patches only whitelisted fields and records one evidence sample per game', () => {
  const memory = memoryWith([existingLesson('keep')]);
  const next = applyExperienceOperations(memory, [
    { type: 'update', lessonId: 'keep', patch: { recommendation: 'revised', confidence: 0.7 }, evidenceGameId: GAME },
  ], { gameId: GAME, now: NOW });
  const [lesson] = next.lessons;
  assert.equal(lesson.recommendation, 'revised');
  assert.equal(lesson.confidence, 0.7);
  assert.equal(lesson.trigger, memory.lessons[0].trigger);
  assert.equal(lesson.sampleCount, 4);
  assert.deepEqual(lesson.evidenceGameIds, ['old-game', GAME]);
  assert.equal(lesson.createdAt, memory.lessons[0].createdAt);
  assert.equal(lesson.updatedAt, NOW);
  assert.equal(lesson.status, 'candidate');
});

test('apply retires a lesson with a bounded reason and one evidence sample', () => {
  const memory = memoryWith([existingLesson('drop', { status: 'active' })]);
  const next = applyExperienceOperations(memory, [
    { type: 'retire', lessonId: 'drop', reason: 'contradicted by current public evidence', evidenceGameId: GAME },
  ], { gameId: GAME, now: NOW });
  const [lesson] = next.lessons;
  assert.equal(lesson.status, 'retired');
  assert.equal(lesson.retirementReason, 'contradicted by current public evidence');
  assert.equal(lesson.sampleCount, 4);
  assert.deepEqual(lesson.evidenceGameIds, ['old-game', GAME]);
});

test('apply re-validates update and retire targets against the latest snapshot', () => {
  const memory = memoryWith([existingLesson('dead', { status: 'retired' })]);
  assert.throws(
    () => applyExperienceOperations(memory, [{ type: 'update', lessonId: 'ghost', patch: { confidence: 0.5 }, evidenceGameId: GAME }], { gameId: GAME, now: NOW }),
    /lessonId/,
  );
  assert.throws(
    () => applyExperienceOperations(memory, [{ type: 'update', lessonId: 'dead', patch: { confidence: 0.5 }, evidenceGameId: GAME }], { gameId: GAME, now: NOW }),
    /retired/,
  );
});

test('evidence references stay unique and bounded per lesson', () => {
  const memory = memoryWith([existingLesson('keep', { evidenceGameIds: Array.from({ length: 25 }, (_, i) => `g${i}`) })]);
  const next = applyExperienceOperations(memory, [
    { type: 'update', lessonId: 'keep', patch: { confidence: 0.6 }, evidenceGameId: GAME },
  ], { gameId: GAME, now: NOW });
  const [lesson] = next.lessons;
  assert.equal(lesson.evidenceGameIds.length, 25);
  assert.equal(lesson.evidenceGameIds.at(-1), GAME);
  const again = applyExperienceOperations(next, [
    { type: 'update', lessonId: 'keep', patch: { confidence: 0.7 }, evidenceGameId: GAME },
  ], { gameId: GAME, now: NOW });
  assert.equal(again.lessons[0].evidenceGameIds.filter(id => id === GAME).length, 1);
});

test('apply never mutates the input snapshot', () => {
  const memory = memoryWith([existingLesson('keep')]);
  const before = structuredClone(memory);
  applyExperienceOperations(memory, [
    { type: 'update', lessonId: 'keep', patch: { confidence: 0.6 }, evidenceGameId: GAME },
    { type: 'add', lesson: { playerCount: 2, targetScore: 15, phase: 'mid', trigger: 't', recommendation: 'r', counterexample: '', confidence: 0.5 }, evidenceGameId: GAME },
  ], { gameId: GAME, now: NOW, createId: () => 'server-x' });
  assert.deepEqual(memory, before);
});
