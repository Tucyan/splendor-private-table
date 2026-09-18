import { randomUUID } from 'node:crypto';
import { AiMemoryStore } from './ai-memory-store.js';

const MAX_EVIDENCE = 12;
const MAX_LESSONS = 8;

const text = (value, limit = 500) => String(value ?? '').slice(0, limit);

export function createEndSnapshot(game, { gameId, players = [] } = {}) {
  if (!game || !gameId) throw new Error('game and gameId are required');
  return {
    gameId: text(gameId, 120), status: game.status, endReason: game.endReason || 'normal',
    finishScore: game.finishScore, turnOrder: [...(game.turnOrder || [])],
    winners: [...(game.winners || [])],
    players: game.players.map(player => ({ id: player.id, score: player.score, cards: player.cards.length, nobles: player.nobles.length })),
    observers: players.filter(player => player.ai && player.mode === 'deepseek-advanced').map(player => player.id),
    evidence: (game.log || []).slice(-MAX_EVIDENCE).map(entry => ({ playerId: entry.playerId, text: text(entry.text, 240) })),
  };
}

export function validateReflectionResponse(value, { requireEvidence = false, gameId = '' } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('reflection response must be an object');
  const lessons = Array.isArray(value.lessons) ? value.lessons.slice(0, MAX_LESSONS) : [];
  const normalized = lessons.map((lesson, index) => ({
    id: text(lesson.id || `lesson-${index}-${randomUUID()}`, 120),
    playerCount: Number(lesson.playerCount) || 2, targetScore: Number(lesson.targetScore) || 15,
    phase: text(lesson.phase || 'unknown', 40), trigger: text(lesson.trigger, 500),
    recommendation: text(lesson.recommendation, 500), counterexample: text(lesson.counterexample, 500),
    evidenceGameId: text(lesson.evidenceGameId, 120), sampleCount: 1,
    successCount: 0, failureCount: 0, confidence: Math.max(0, Math.min(1, Number(lesson.confidence) || 0)), status: 'candidate',
  }));
  if (requireEvidence) {
    for (const lesson of normalized) {
      if (!lesson.evidenceGameId || (gameId && lesson.evidenceGameId !== String(gameId))) {
        throw new Error('reflection lesson evidence is required and must reference the current game');
      }
    }
  }
  return normalized;
}

export function buildReflectionPrompt(snapshot) {
  return JSON.stringify({ task: 'derive conditional candidate lessons from public evidence', snapshot });
}

export class ReflectionCoordinator {
  constructor({ store = new AiMemoryStore(), fetchImpl = fetch, timeoutMs = 20000, maxAttempts = 3 } = {}) {
    this.store = store; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.maxAttempts = maxAttempts;
  }

  async enqueue(snapshot) {
    await this.store.saveEpisode(snapshot.gameId, snapshot);
    const existing = await this.store.loadJob(snapshot.gameId);
    if (existing) return existing;
    return this.store.saveJob(snapshot.gameId, { status: 'pending', attempts: 0, createdAt: new Date().toISOString() });
  }

  pendingJobsSync() {
    if (typeof this.store.listJobsSync !== 'function') return [];
    return this.store.listJobsSync({ statuses: ['pending'] }).filter(job => (job.attempts || 0) < this.maxAttempts);
  }

  async reflect(snapshot, { key, endpoint = 'https://api.deepseek.com/chat/completions', model = 'deepseek-v4-flash' } = {}) {
    if (!key) return { status: 'skipped', reason: 'missing_key' };
    const queued = await this.enqueue(snapshot);
    if (queued.status === 'completed') return { status: 'saved', committed: false, lessons: queued.lessons || 0 };
    if ((queued.attempts || 0) >= this.maxAttempts) return { status: 'failed', reason: 'max_attempts' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: buildReflectionPrompt(snapshot) }], response_format: { type: 'json_object' }, max_tokens: 512, temperature: 0.2 }) });
      if (!response.ok) throw new Error(`reflection HTTP ${response.status}`);
      const data = await response.json();
      const lessons = validateReflectionResponse(data, { requireEvidence: true, gameId: snapshot.gameId });
      const committed = await this.store.commitExperience(snapshot.gameId, lessons);
      await this.store.saveJob(snapshot.gameId, { ...queued, status: 'completed', attempts: (queued.attempts || 0) + 1, lessons: lessons.length });
      return { status: 'saved', committed: committed.committed, lessons: lessons.length };
    } catch (error) {
      if ((queued.attempts || 0) < this.maxAttempts) await this.store.recordJobAttempt(snapshot.gameId, { error: error.message });
      return { status: 'failed', error: error.message };
    } finally { clearTimeout(timer); }
  }

  async recoverPending(options = {}) {
    const jobs = await this.store.listJobs({ statuses: ['pending'] });
    const results = [];
    for (const job of jobs) {
      if ((job.attempts || 0) >= this.maxAttempts) continue;
      const snapshot = await this.store.loadEpisode(job.gameId);
      if (!snapshot) continue;
      results.push(await this.reflect(snapshot, options));
    }
    return results;
  }

  async waitForPending({ key, timeoutMs = 60000 } = {}) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let hadFailure = false;
    while (true) {
      let pending;
      try { pending = await this.store.listJobs({ statuses: ['pending'] }); }
      catch { return { status: 'sync_failed', pending: [] }; }
      if (!pending.some(job => (job.attempts || 0) < this.maxAttempts)) {
        return { status: hadFailure ? 'sync_failed' : 'synced', pending: [] };
      }
      if (!key) return { status: 'memory_busy', pending };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { status: 'memory_busy', pending };
      const work = this.recoverPending({ key });
      let timer;
      const result = await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(null), remaining); })]);
      clearTimeout(timer);
      if (result === null) return { status: 'memory_busy', pending };
      hadFailure ||= result.some(item => item?.status === 'failed');
    }
  }
}
