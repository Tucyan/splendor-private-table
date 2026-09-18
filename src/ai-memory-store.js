import { randomUUID } from 'node:crypto';
import { hostname as getHostname } from 'node:os';
import { pid as processPid } from 'node:process';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_MEMORY_DIR = resolve(process.cwd(), 'data/ai-memory/deepseek-advanced');
const SCHEMA_VERSION = 1;
const MAX_ATTEMPTS = 3;
const LESSON_STATUSES = new Set(['candidate', 'active', 'retired']);
const PROCESS_QUEUES = new Map();

const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function createEmptyMemory() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    strategyVersion: 'deepseek-advanced-v1',
    updatedAt: null,
    processedGameIds: [],
    lessons: [],
  };
}

function invalid(message) {
  const error = new Error(`Invalid memory snapshot: ${message}`);
  error.code = 'MEMORY_SCHEMA_INVALID';
  return error;
}

export function validateMemorySnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('object required');
  if (value.schemaVersion !== SCHEMA_VERSION) throw invalid('schemaVersion');
  if (!Number.isInteger(value.revision) || value.revision < 0) throw invalid('revision');
  if (typeof value.strategyVersion !== 'string' || !value.strategyVersion) throw invalid('strategyVersion');
  if (value.updatedAt !== null && typeof value.updatedAt !== 'string') throw invalid('updatedAt');
  if (!Array.isArray(value.processedGameIds) || value.processedGameIds.some(item => typeof item !== 'string')) {
    throw invalid('processedGameIds');
  }
  if (!Array.isArray(value.lessons)) throw invalid('lessons');
  for (const lesson of value.lessons) {
    if (!lesson || typeof lesson !== 'object' || typeof lesson.id !== 'string' || !lesson.id) throw invalid('lesson id');
    for (const key of ['playerCount', 'targetScore', 'sampleCount', 'successCount', 'failureCount', 'confidence']) {
      if (!Number.isFinite(lesson[key])) throw invalid(`lesson ${key}`);
    }
    for (const key of ['phase', 'trigger', 'recommendation', 'counterexample', 'evidenceGameId']) {
      if (typeof lesson[key] !== 'string') throw invalid(`lesson ${key}`);
    }
    if (!LESSON_STATUSES.has(lesson.status)) throw invalid('lesson status');
  }
  return true;
}

function normalizeLesson(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) throw invalid('lesson');
  const result = {
    id: item.id.slice(0, 120),
    playerCount: Math.max(1, Math.floor(number(item.playerCount, 2))),
    targetScore: Math.max(1, Math.floor(number(item.targetScore, 15))),
    phase: String(item.phase || 'unknown').slice(0, 40),
    trigger: String(item.trigger || '').slice(0, 500),
    recommendation: String(item.recommendation || '').slice(0, 500),
    counterexample: String(item.counterexample || '').slice(0, 500),
    evidenceGameId: String(item.evidenceGameId || '').slice(0, 120),
    sampleCount: Math.max(1, Math.floor(number(item.sampleCount, 1))),
    successCount: Math.max(0, Math.floor(number(item.successCount, 0))),
    failureCount: Math.max(0, Math.floor(number(item.failureCount, 0))),
    confidence: Math.max(0, Math.min(1, number(item.confidence, 0))),
    status: LESSON_STATUSES.has(item.status) ? item.status : 'candidate',
  };
  return result;
}

function corruptError(cause) {
  const error = new Error(`Memory snapshot is corrupt: ${cause?.message || cause}`);
  error.code = 'MEMORY_CORRUPT';
  error.cause = cause;
  return error;
}

export class AiMemoryStore {
  constructor(options = {}) {
    const configured = options.directory || process.env.DEEPSEEK_ADVANCED_MEMORY_DIR || DEFAULT_MEMORY_DIR;
    this.directory = isAbsolute(configured) ? configured : resolve(configured);
    this.memoryPath = join(this.directory, 'memory.json');
    this.previousPath = join(this.directory, 'memory.previous.json');
    this.lockPath = join(this.directory, 'memory.lock');
    this.jobsPath = join(this.directory, 'jobs');
    this.episodesPath = join(this.directory, 'episodes');
    this.hostname = options.hostname || getHostname();
    this.pid = options.pid || processPid;
    this.lockWaitMs = Number.isFinite(options.lockWaitMs) ? options.lockWaitMs : 5000;
    this.lockPollMs = Number.isFinite(options.lockPollMs) ? options.lockPollMs : 40;
    this.replaceFile = options.replaceFile || ((from, to) => rename(from, to));
    this.beforeCommit = options.beforeCommit || null;
  }

  enqueue(task) {
    const key = this.directory;
    const tail = PROCESS_QUEUES.get(key) || Promise.resolve();
    const run = tail.then(task);
    PROCESS_QUEUES.set(key, run.catch(() => {}));
    return run;
  }

  async _ensureDirectories() {
    await mkdir(this.directory, { recursive: true });
    await mkdir(this.jobsPath, { recursive: true });
    await mkdir(this.episodesPath, { recursive: true });
  }

  async _parseSnapshot(path) {
    const text = await readFile(path, 'utf8');
    let value;
    try { value = JSON.parse(text); } catch (error) { throw corruptError(error); }
    try { validateMemorySnapshot(value); } catch (error) { throw corruptError(error); }
    return value;
  }

  async _readUnlocked() {
    try {
      return { memory: await this._parseSnapshot(this.memoryPath), warnings: [] };
    } catch (primaryError) {
      if (primaryError.code === 'ENOENT') {
        try {
          const memory = await this._parseSnapshot(this.previousPath);
          return { memory, warnings: ['memory.json is missing; recovered from verified memory.previous.json'] };
        } catch (backupError) {
          if (backupError.code !== 'ENOENT') throw corruptError(backupError);
          const memory = createEmptyMemory();
          await this._ensureDirectories();
          await this._writeJsonAtomic(this.memoryPath, memory);
          return { memory, warnings: [] };
        }
      }
      try {
        const memory = await this._parseSnapshot(this.previousPath);
        return { memory, warnings: ['memory.json is corrupt; recovered from verified memory.previous.json'] };
      } catch (backupError) {
        if (backupError.code === 'ENOENT') throw primaryError;
        throw corruptError(primaryError);
      }
    }
  }

  async readMemory(options = {}) {
    const result = await this._readUnlocked();
    return options.withWarnings ? result : result.memory;
  }

  loadMemory(options = {}) { return this.readMemory(options); }
  getSnapshot(options = {}) { return this.readMemory(options); }

  async _writeJsonAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${this.pid}-${randomUUID()}`;
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await this.replaceFile(temporary, path);
    } catch (error) {
      error.tempPath = temporary;
      throw error;
    }
  }

  async _backupCurrent() {
    let primary;
    try { primary = await this._parseSnapshot(this.memoryPath); } catch { return; }
    try { validateMemorySnapshot(primary); } catch { return; }
    await this._writeJsonAtomic(this.previousPath, primary);
  }

  _ownerPath() { return join(this.lockPath, 'owner.json'); }

  async _readOwner() {
    try { return JSON.parse(await readFile(this._ownerPath(), 'utf8')); } catch { return null; }
  }

  _ownerIsDead(owner) {
    if (!owner || owner.hostname !== this.hostname || !Number.isInteger(owner.pid)) return false;
    if (owner.pid === this.pid) return false;
    try { process.kill(owner.pid, 0); return false; } catch (error) {
      return error.code === 'ESRCH';
    }
  }

  async _acquireLock() {
    await this._ensureDirectories();
    const token = randomUUID();
    const deadline = Date.now() + this.lockWaitMs;
    while (true) {
      try {
        await mkdir(this.lockPath);
        const owner = { token, pid: this.pid, hostname: this.hostname, createdAt: now() };
        await writeFile(this._ownerPath(), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
        return owner;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await this._readOwner();
        if (this._ownerIsDead(existing)) {
          await rm(this.lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          const busy = new Error('Timed out waiting for memory lock');
          busy.code = 'MEMORY_BUSY';
          busy.owner = existing;
          throw busy;
        }
        await delay(Math.min(this.lockPollMs, Math.max(1, deadline - Date.now())));
      }
    }
  }

  async _releaseLock(owner) {
    const current = await this._readOwner();
    if (current?.token !== owner.token) return;
    await rm(this.lockPath, { recursive: true, force: true });
  }

  async _withLock(task) {
    const owner = await this._acquireLock();
    try { return await task(owner); } finally { await this._releaseLock(owner); }
  }

  _mergeLessons(existing, incoming) {
    const merged = existing.map(clone);
    for (const raw of incoming) {
      const item = normalizeLesson(raw);
      const prior = merged.find(lesson => lesson.id === item.id);
      if (!prior) {
        merged.push(item);
        continue;
      }
      const priorSamples = prior.sampleCount;
      prior.sampleCount += item.sampleCount;
      prior.successCount += item.successCount;
      prior.failureCount += item.failureCount;
      prior.confidence = Math.max(0, Math.min(1, (prior.confidence * priorSamples + item.confidence * item.sampleCount) / prior.sampleCount));
      if (item.status === 'active' || prior.status === 'retired') prior.status = item.status;
      if (item.evidenceGameId && !prior.evidenceGameId) prior.evidenceGameId = item.evidenceGameId;
    }
    return merged;
  }

  async commitExperience(gameId, lessons = []) {
    return this.enqueue(() => this._withLock(async () => {
      const current = await this._readUnlocked();
      const memory = current.memory;
      if (memory.processedGameIds.includes(String(gameId))) return { committed: false, memory };
      if (this.beforeCommit) await this.beforeCommit(String(gameId));
      const next = {
        ...memory,
        revision: memory.revision + 1,
        updatedAt: now(),
        processedGameIds: [...memory.processedGameIds, String(gameId)],
        lessons: this._mergeLessons(memory.lessons, lessons),
      };
      validateMemorySnapshot(next);
      await this._backupCurrent();
      await this._writeJsonAtomic(this.memoryPath, next);
      return { committed: true, memory: next };
    }));
  }

  commitLessons(gameId, lessons = []) { return this.commitExperience(gameId, lessons); }

  _recordId(gameId) {
    const value = String(gameId);
    if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) {
      const error = new Error('Invalid gameId for persistent record');
      error.code = 'INVALID_GAME_ID';
      throw error;
    }
    return value;
  }

  async _readRecord(directory, gameId) {
    const recordId = this._recordId(gameId);
    try { return JSON.parse(await readFile(join(directory, `${recordId}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async _saveRecord(directory, gameId, value) {
    const recordId = this._recordId(gameId);
    const record = { ...clone(value), gameId: recordId };
    await this._writeJsonAtomic(join(directory, `${recordId}.json`), record);
    return record;
  }

  async saveJob(gameId, value) {
    return this.enqueue(() => this._withLock(() => {
      const attempts = value?.attempts ?? 0;
      if (!Number.isInteger(attempts) || attempts < 0 || attempts > MAX_ATTEMPTS) {
        const error = new Error(`Invalid retry attempts for ${gameId}`);
        error.code = 'ATTEMPTS_INVALID';
        throw error;
      }
      return this._saveRecord(this.jobsPath, gameId, { ...value, attempts });
    }));
  }

  saveReflectionJob(gameId, value) { return this.saveJob(gameId, value); }

  async loadJob(gameId) { await this._ensureDirectories(); return this._readRecord(this.jobsPath, gameId); }

  async listJobs({ statuses } = {}) {
    await this._ensureDirectories();
    const allowed = statuses ? new Set(statuses) : null;
    const entries = await readdir(this.jobsPath, { withFileTypes: true });
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const gameId = entry.name.slice(0, -5);
      const job = await this._readRecord(this.jobsPath, gameId);
      if (job && (!allowed || allowed.has(job.status))) jobs.push(job);
    }
    return jobs;
  }

  listJobsSync({ statuses } = {}) {
    mkdirSync(this.jobsPath, { recursive: true });
    const allowed = statuses ? new Set(statuses) : null;
    const jobs = [];
    for (const entry of readdirSync(this.jobsPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const job = JSON.parse(readFileSync(join(this.jobsPath, entry.name), 'utf8'));
        if (job && (!allowed || allowed.has(job.status))) jobs.push(job);
      } catch {
        // Async recovery reports corrupt records; synchronous peeking must stay non-blocking.
      }
    }
    return jobs;
  }

  async saveEpisode(gameId, value) {
    return this.enqueue(() => this._withLock(() => this._saveRecord(this.episodesPath, gameId, value)));
  }

  saveGameEpisode(gameId, value) { return this.saveEpisode(gameId, value); }

  async loadEpisode(gameId) { await this._ensureDirectories(); return this._readRecord(this.episodesPath, gameId); }

  async recordJobAttempt(gameId, metadata = {}) {
    return this.enqueue(() => this._withLock(async () => {
      const existing = await this._readRecord(this.jobsPath, gameId);
      if (!existing) {
        const error = new Error(`Unknown job: ${gameId}`);
        error.code = 'JOB_NOT_FOUND';
        throw error;
      }
      if ((existing.attempts || 0) >= MAX_ATTEMPTS) {
        const error = new Error(`Maximum attempts exceeded for ${gameId}`);
        error.code = 'ATTEMPTS_EXCEEDED';
        throw error;
      }
      const attempts = (existing.attempts || 0) + 1;
      return this._saveRecord(this.jobsPath, gameId, {
        ...existing,
        attempts,
        lastAttemptAt: now(),
        lastError: metadata.error ? String(metadata.error).slice(0, 500) : null,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : (existing.status || 'pending'),
      });
    }));
  }

  incrementJobAttempt(gameId, metadata = {}) { return this.recordJobAttempt(gameId, metadata); }
}

export { MAX_ATTEMPTS, AiMemoryStore as AIMemoryStore, AiMemoryStore as MemoryStore };
