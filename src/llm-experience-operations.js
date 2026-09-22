import { randomUUID } from 'node:crypto';

const MAX_TEXT = 500;
const MAX_PHASE = 40;
const MAX_LESSON_ID = 120;
const MAX_EVIDENCE_IDS = 25;

const OPERATION_TYPES = new Set(['add', 'update', 'retire']);
const LESSON_CONTENT_FIELDS = ['playerCount', 'targetScore', 'phase', 'trigger', 'recommendation', 'counterexample', 'confidence'];
const PATCH_FIELDS = new Set(LESSON_CONTENT_FIELDS);
const SERVER_OWNED_FIELDS = new Set([
  'id', 'status', 'sampleCount', 'successCount', 'failureCount',
  'processedGameIds', 'createdAt', 'updatedAt', 'evidenceGameIds', 'evidenceGameId', 'retirementReason',
]);

const clone = value => structuredClone(value);

function fail(message) {
  const error = new Error(`Invalid reflection operations: ${message}`);
  error.code = 'LLM_OPERATIONS_INVALID';
  throw error;
}

function boundedText(value, field, { required = false, limit = MAX_TEXT } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') fail(`${field} must be a string`);
  if (value.length > limit) fail(`${field} exceeds ${limit} characters`);
  return value;
}

function boundedInt(value, field, { min, max, fallback }) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) fail(`${field} must be an integer between ${min} and ${max}`);
  return value;
}

function boundedConfidence(value) {
  if (value === undefined || value === null) return 0.5;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail('confidence must be a number between 0 and 1');
  return value;
}

function rejectServerOwnedFields(source, owner) {
  for (const key of Object.keys(source)) {
    if (SERVER_OWNED_FIELDS.has(key)) fail(`${owner} cannot set server-owned field ${key}`);
  }
}

function validateContentFields(source, owner) {
  return {
    playerCount: boundedInt(source.playerCount, 'playerCount', { min: 2, max: 4, fallback: 2 }),
    targetScore: boundedInt(source.targetScore, 'targetScore', { min: 5, max: 30, fallback: 15 }),
    phase: boundedText(source.phase, 'phase', { limit: MAX_PHASE }) || 'unknown',
    trigger: boundedText(source.trigger, 'trigger'),
    recommendation: boundedText(source.recommendation, 'recommendation', { required: true }),
    counterexample: boundedText(source.counterexample, 'counterexample'),
    confidence: boundedConfidence(source.confidence),
  };
}

function validateAdd(operation) {
  const lesson = operation.lesson;
  if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) fail('add operation lesson must be an object');
  rejectServerOwnedFields(lesson, 'add lesson');
  for (const key of Object.keys(lesson)) {
    if (!LESSON_CONTENT_FIELDS.includes(key)) fail(`add lesson contains unknown field ${key}`);
  }
  return { type: 'add', evidenceGameId: operation.evidenceGameId, lesson: validateContentFields(lesson, 'add lesson') };
}

function validateReference(operation, lessonsById, type) {
  const lessonId = boundedText(operation.lessonId, 'lessonId', { required: true, limit: MAX_LESSON_ID });
  const target = lessonsById.get(lessonId);
  if (!target) fail(`${type} operation references unknown lessonId ${lessonId}`);
  if (target.status === 'retired') fail(`${type} operation cannot target retired lessonId ${lessonId}`);
  return lessonId;
}

function validateUpdate(operation, lessonsById) {
  const lessonId = validateReference(operation, lessonsById, 'update');
  const patch = operation.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('update operation patch must be an object');
  const keys = Object.keys(patch);
  if (keys.length === 0) fail('update operation patch must not be empty');
  for (const key of keys) {
    if (!PATCH_FIELDS.has(key)) fail(`update patch cannot modify field ${key}`);
  }
  const normalized = {};
  for (const key of keys) {
    if (key === 'playerCount') normalized.playerCount = boundedInt(patch.playerCount, 'playerCount', { min: 2, max: 4, fallback: 2 });
    else if (key === 'targetScore') normalized.targetScore = boundedInt(patch.targetScore, 'targetScore', { min: 5, max: 30, fallback: 15 });
    else if (key === 'confidence') normalized.confidence = boundedConfidence(patch.confidence);
    else if (key === 'phase') normalized.phase = boundedText(patch.phase, 'phase', { limit: MAX_PHASE }) || 'unknown';
    else if (key === 'recommendation') normalized.recommendation = boundedText(patch.recommendation, 'recommendation', { required: true });
    else normalized[key] = boundedText(patch[key], key);
  }
  return { type: 'update', evidenceGameId: operation.evidenceGameId, lessonId, patch: normalized };
}

function validateRetire(operation, lessonsById) {
  const lessonId = validateReference(operation, lessonsById, 'retire');
  const reason = boundedText(operation.reason, 'reason', { required: true });
  return { type: 'retire', evidenceGameId: operation.evidenceGameId, lessonId, reason };
}

export function validateExperienceOperations(value, { gameId, existingLessons = [], maxOperations = 8 } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('reflection response must be an object');
  if (!Array.isArray(value.operations)) fail('reflection response operations must be an array');
  const lessonsById = new Map((existingLessons || []).map(lesson => [lesson.id, lesson]));
  return value.operations.slice(0, maxOperations).map(operation => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail('reflection operation must be an object');
    if (!OPERATION_TYPES.has(operation.type)) fail(`unknown reflection operation type: ${String(operation.type)}`);
    const evidenceGameId = boundedText(operation.evidenceGameId, 'evidenceGameId', { required: true, limit: MAX_LESSON_ID });
    if (String(evidenceGameId) !== String(gameId)) fail('reflection operation evidenceGameId must reference the current game');
    const normalized = { ...operation, evidenceGameId };
    if (operation.type === 'add') return validateAdd(normalized);
    if (operation.type === 'update') return validateUpdate(normalized, lessonsById);
    return validateRetire(normalized, lessonsById);
  });
}

function recordEvidence(lesson, gameId) {
  const evidence = Array.isArray(lesson.evidenceGameIds) ? lesson.evidenceGameIds.filter(id => id !== gameId) : [];
  evidence.push(gameId);
  lesson.evidenceGameIds = evidence.slice(-MAX_EVIDENCE_IDS);
}

function resolveMutableTarget(lessonsById, operation) {
  const target = lessonsById.get(operation.lessonId);
  if (!target) fail(`operation references unknown lessonId ${operation.lessonId}`);
  if (target.status === 'retired') fail(`operation cannot target retired lessonId ${operation.lessonId}`);
  return target;
}

export function applyExperienceOperations(memory, operations, { gameId, now, createId } = {}) {
  const stamp = now || new Date().toISOString();
  const makeId = createId || (() => `lesson-${randomUUID()}`);
  const evidence = String(gameId);
  const lessons = (memory.lessons || []).map(clone);
  const lessonsById = new Map(lessons.map(lesson => [lesson.id, lesson]));
  for (const operation of operations) {
    if (operation.type === 'add') {
      const lesson = {
        id: makeId(),
        ...clone(operation.lesson),
        sampleCount: 1,
        successCount: 0,
        failureCount: 0,
        status: 'candidate',
        createdAt: stamp,
        updatedAt: stamp,
        evidenceGameIds: [evidence],
        retirementReason: '',
      };
      lessons.push(lesson);
      lessonsById.set(lesson.id, lesson);
      continue;
    }
    const target = resolveMutableTarget(lessonsById, operation);
    if (operation.type === 'update') {
      Object.assign(target, clone(operation.patch));
    } else {
      target.status = 'retired';
      target.retirementReason = operation.reason;
    }
    target.updatedAt = stamp;
    target.sampleCount = (Number.isFinite(target.sampleCount) ? target.sampleCount : 0) + 1;
    recordEvidence(target, evidence);
  }
  return {
    ...memory,
    revision: memory.revision + 1,
    updatedAt: stamp,
    processedGameIds: [...memory.processedGameIds, evidence],
    lessons,
  };
}
