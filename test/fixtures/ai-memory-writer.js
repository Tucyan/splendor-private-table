import { AiMemoryStore } from '../../src/ai-memory-store.js';

const [directory, gameId, lessonId, encodedOptions = '{}'] = process.argv.slice(2);
if (!directory || !gameId || !lessonId) process.exit(0);
const options = JSON.parse(encodedOptions);
const store = new AiMemoryStore({ directory, lockWaitMs: 3000, lockPollMs: 10 });
if (options.holdMs) store.beforeCommit = async () => new Promise(resolve => setTimeout(resolve, options.holdMs));
const result = await store.commitExperience(gameId, [{
  id: lessonId,
  playerCount: 2,
  targetScore: 15,
  phase: 'midgame',
  trigger: `trigger-${lessonId}`,
  recommendation: `recommend-${lessonId}`,
  counterexample: 'none',
  evidenceGameId: gameId,
  sampleCount: 1,
  successCount: 1,
  failureCount: 0,
  confidence: 0.5,
  status: 'candidate',
}]);
process.stdout.write(JSON.stringify(result));
