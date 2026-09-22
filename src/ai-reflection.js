import { AiMemoryStore } from './ai-memory-store.js';
import { requestLlmJson, llmReasonCode } from './llm-client.js';
import { validateExperienceOperations } from './llm-experience-operations.js';

const MAX_EVIDENCE = 12;
const MAX_EXISTING_LESSONS = 8;

const text = (value, limit = 500) => String(value ?? '').slice(0, limit);

export function createEndSnapshot(game, { gameId, players = [] } = {}) {
  if (!game || gameId === undefined || gameId === null || gameId === '') throw new Error('game and gameId are required');
  return {
    gameId: text(gameId, 120), status: game.status, endReason: game.endReason || 'normal',
    finishScore: game.finishScore, turnOrder: [...(game.turnOrder || [])],
    winners: [...(game.winners || [])],
    players: game.players.map(player => ({ id: player.id, score: player.score, cards: player.cards.length, nobles: player.nobles.length })),
    observers: players.filter(player => player.ai && player.mode === 'llm-advanced').map(player => player.id),
    evidence: (game.log || []).slice(-MAX_EVIDENCE).map(entry => ({ playerId: entry.playerId, text: text(entry.text, 240) })),
  };
}

// The model may only reference lessons it can see: id, applicability, text, confidence and status.
export function selectRelevantLessons(lessons, snapshot, { limit = MAX_EXISTING_LESSONS } = {}) {
  const playerCount = (snapshot?.turnOrder || []).length || (snapshot?.players || []).length;
  const targetScore = Number(snapshot?.finishScore);
  return (lessons || [])
    .map((lesson, index) => ({
      lesson,
      index,
      relevance: (lesson.playerCount === playerCount ? 1 : 0) + (lesson.targetScore === targetScore ? 1 : 0),
    }))
    .filter(entry => entry.lesson && (entry.lesson.status === 'candidate' || entry.lesson.status === 'active'))
    .sort((a, b) => b.relevance - a.relevance || b.index - a.index)
    .slice(0, limit)
    .map(({ lesson }) => ({
      id: lesson.id,
      playerCount: lesson.playerCount,
      targetScore: lesson.targetScore,
      phase: lesson.phase,
      trigger: lesson.trigger,
      recommendation: lesson.recommendation,
      counterexample: lesson.counterexample,
      confidence: lesson.confidence,
      status: lesson.status,
    }));
}

export function buildReflectionPrompt(snapshot, { existingLessons = [] } = {}) {
  return [
    {
      role: 'system',
      content: 'Return only valid JSON. Use exactly this shape: {"operations":[{"type":"add|update|retire"}]}. Never change game rules or claim hidden information.',
    },
    {
      role: 'user',
      content: JSON.stringify({ task: 'review public game evidence and existing lessons', snapshot, existingLessons }),
    },
  ];
}

export class ReflectionCoordinator {
  constructor({ store = new AiMemoryStore(), llmConfig = { enabled: false }, fetchImpl = fetch, requestJson = requestLlmJson, timeoutMs = 20000, maxAttempts = 3, logger } = {}) {
    this.store = store; this.llmConfig = llmConfig; this.fetchImpl = fetchImpl; this.requestJson = requestJson;
    this.timeoutMs = timeoutMs; this.maxAttempts = maxAttempts; this.logger = logger;
  }

  async enqueue(snapshot) {
    await this.store.saveEpisode(snapshot.gameId, snapshot);
    const existing = await this.store.loadJob(snapshot.gameId);
    if (existing) return existing;
    const job = await this.store.saveJob(snapshot.gameId, { status: 'pending', attempts: 0, createdAt: new Date().toISOString(), lastError: null, lastErrorReasonCode: null, lastErrorAt: null });
    await this.logger?.write({ type: 'reflection.queued', gameId: snapshot.gameId, phase: 'reflection', data: { status: job.status, attempts: job.attempts } });
    return job;
  }

  pendingJobsSync() {
    if (typeof this.store.listJobsSync !== 'function') return [];
    return this.store.listJobsSync({ statuses: ['pending'] }).filter(job => (job.attempts || 0) < this.maxAttempts);
  }

  async reflect(snapshot, { signal } = {}) {
    if (!this.llmConfig?.enabled) {
      await this.logger?.write({ type: 'reflection.skipped', gameId: snapshot.gameId, phase: 'reflection', reasonCode: 'LLM_DISABLED' });
      return { status: 'skipped', reason: 'llm_disabled' };
    }
    const queued = await this.enqueue(snapshot);
    if (queued.status === 'completed') return { status: 'saved', committed: false, lessons: queued.lessons || 0 };
    if ((queued.attempts || 0) >= this.maxAttempts) {
      await this.logger?.write({ type: 'reflection.failed', level: 'warn', gameId: snapshot.gameId, phase: 'reflection', reasonCode: 'LLM_MAX_ATTEMPTS', attempt: queued.attempts, data: { attempts: queued.attempts } });
      return { status: 'failed', reasonCode: 'LLM_MAX_ATTEMPTS', reason: 'max_attempts', attempts: queued.attempts };
    }
    const attempt = (queued.attempts || 0) + 1;
    await this.logger?.write({ type: 'reflection.attempt', gameId: snapshot.gameId, phase: 'reflection', attempt, data: { maxAttempts: this.maxAttempts } });
    try {
      // Read existing lessons before the request so the model sees what it may revise.
      // Network traffic stays outside the memory lock; applyReflection re-validates inside it.
      const memory = await this.store.readMemory().catch(() => null);
      const existingLessons = selectRelevantLessons(memory?.lessons || [], snapshot);
      const result = await this.requestJson({
        config: { ...this.llmConfig, timeoutMs: this.timeoutMs },
        model: this.llmConfig.reflectionModel,
        messages: buildReflectionPrompt(snapshot, { existingLessons }),
        maxTokens: 512,
        temperature: 0.2,
        fetchImpl: this.fetchImpl,
        signal,
        logger: this.logger,
        requestId: undefined,
        attempt,
        phase: 'reflection',
        gameId: snapshot.gameId,
      });
      // result.data is the parsed choices[0].message.content payload, never the HTTP envelope.
      const operations = validateExperienceOperations(result.data, { gameId: snapshot.gameId, existingLessons });
      const committed = await this.store.applyReflection(snapshot.gameId, operations);
      await this.store.saveJob(snapshot.gameId, { ...queued, status: 'completed', attempts: attempt, lessons: operations.length, lastError: null, lastErrorReasonCode: null, lastErrorAt: null });
      await this.logger?.write({ type: 'reflection.committed', gameId: snapshot.gameId, phase: 'reflection', attempt, data: { lessons: operations.length, committed: committed.committed } });
      return { status: 'saved', committed: committed.committed, lessons: operations.length };
    } catch (error) {
      const reasonCode = llmReasonCode(error);
      if ((queued.attempts || 0) < this.maxAttempts) {
        await this.store.recordJobAttempt(snapshot.gameId, { reasonCode, error: `${reasonCode}: ${text(error.message, 400)}` });
      }
      await this.logger?.write({ type: 'reflection.failed', level: 'warn', gameId: snapshot.gameId, phase: 'reflection', attempt, reasonCode, data: { message: text(error.message, 300) } });
      return { status: 'failed', reasonCode, error: text(error.message, 500), attempts: attempt };
    }
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

  async waitForPending({ timeoutMs = 60000 } = {}) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let hadFailure = false;
    while (true) {
      let pending;
      try { pending = await this.store.listJobs({ statuses: ['pending'] }); }
      catch { return { status: 'sync_failed', pending: [] }; }
      if (!pending.some(job => (job.attempts || 0) < this.maxAttempts)) {
        return { status: hadFailure ? 'sync_failed' : 'synced', pending: [] };
      }
      if (!this.llmConfig?.enabled) return { status: 'memory_busy', pending };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { status: 'memory_busy', pending };
      const work = this.recoverPending();
      let timer;
      const result = await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(null), remaining); })]);
      clearTimeout(timer);
      if (result === null) return { status: 'memory_busy', pending };
      hadFailure ||= result.some(item => item?.status === 'failed');
    }
  }
}
