import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBenchmark, parseBenchmarkArgs } from '../scripts/benchmark-local-ai.js';

const smallOptions = {
  seed: 7331,
  gamesPerPlayerCount: 4,
  maxGames: 12,
  maxSteps: 3,
  maxNodes: 12,
  maxTimeMs: 1000,
};

function withoutTimings(value) {
  if (Array.isArray(value)) return value.map(withoutTimings);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/time|ms/i.test(key))
    .map(([key, child]) => [key, withoutTimings(child)]));
}

test('fixed seeds and budgets reproduce game outcomes and search counters', () => {
  const first = runBenchmark(smallOptions);
  const second = runBenchmark(smallOptions);
  assert.deepEqual(withoutTimings(second), withoutTimings(first));
  assert.equal(first.summary.totalSamples, 12);
});

test('the quick schedule balances each mode across seats in 2, 3, and 4 player games', () => {
  const report = runBenchmark(smallOptions);
  for (const [mode, stats] of Object.entries(report.modes)) {
    for (const count of [2, 3, 4]) {
      assert.deepEqual(stats.seats[count], Array(count).fill(1), `${mode}, ${count} players`);
    }
  }
});

test('quick report exposes the three paired seed blocks and four rotations per block', () => {
  const report = runBenchmark(smallOptions);
  assert.equal(report.config.uniqueSeedCount, 3);
  assert.equal(report.config.pairedScheduleBlocks, 3);
  assert.equal(report.config.seedReusePerBlockByPlayerCount['2'], 4);
  assert.equal(report.config.seedReusePerBlockByPlayerCount['3'], 4);
  assert.equal(report.config.seedReusePerBlockByPlayerCount['4'], 4);
  assert.equal(report.summary.uniqueSeedCount, 3);
  assert.equal(report.summary.pairedScheduleBlocks, 3);
  assert.ok(report.samples.every(sample => Number.isInteger(sample.blockId) && Number.isInteger(sample.rotation)));
});

test('full report identifies one shared seed per player count across all seat permutations', () => {
  const report = runBenchmark({
    profile: 'full', maxGames: 60, maxSteps: 1, maxNodes: 1, maxTimeMs: 1000,
  });
  assert.equal(report.config.uniqueSeedCount, 3);
  assert.equal(report.config.pairedScheduleBlocks, 3);
  assert.deepEqual(report.config.seedReusePerBlockByPlayerCount, { 2: 12, 3: 24, 4: 24 });
  for (const count of [2, 3, 4]) {
    const samples = report.samples.filter(sample => sample.playerCount === count);
    assert.equal(new Set(samples.map(sample => sample.seed)).size, 1);
    assert.equal(new Set(samples.map(sample => sample.rotation)).size, samples.length);
  }
});

test('decision duration is reported per action with the stable field name', () => {
  const report = runBenchmark(smallOptions);
  assert.equal(typeof report.summary.avgDecisionMsPerAction, 'number');
  assert.equal(report.summary.avgDecisionMsPerTurn, undefined);
  for (const stats of Object.values(report.modes)) {
    assert.equal(typeof stats.avgDecisionMsPerAction, 'number');
    assert.equal(stats.avgDecisionMsPerTurn, undefined);
  }
});

test('default quick budget allows at least 240 actions per game', () => {
  assert.ok(parseBenchmarkArgs([]).maxSteps >= 240);
});

test('a total deadline records the active sample as timed out and every remaining plan as skipped', () => {
  let nowValue = 0;
  const report = runBenchmark({
    ...smallOptions,
    maxSteps: 240,
    maxTotalTimeMs: 30,
    now: () => (nowValue += 10),
  });
  assert.equal(report.config.maxTotalTimeMs, 30);
  assert.equal(report.summary.maxTotalTimeMs, 30);
  assert.equal(report.summary.attemptedSamples, 1);
  assert.equal(report.summary.timedOutSamples, 1);
  assert.equal(report.summary.skippedSamples, 11);
  assert.equal(report.summary.avgActionsPerAttemptedGame,
    report.summary.totalActions / report.summary.attemptedSamples);
  assert.equal(report.samples[0].status, 'timeout');
  assert.equal(report.samples[0].reason, 'max-total-time');
  assert.ok(report.samples.slice(1).every(sample => sample.status === 'skipped' && sample.reason === 'max-total-time'));
  assert.equal(report.summary.totalSamples,
    report.summary.completedGames + report.summary.incompleteSamples + report.summary.errorSamples
    + report.summary.timedOutSamples + report.summary.skippedSamples);
});

test('default total runtime is 30 seconds and remains visible in the CLI report', () => {
  assert.equal(parseBenchmarkArgs([]).maxTotalTimeMs, 30000);
});

test('each attempted game is finished, explicitly incomplete, or explicitly errored', () => {
  const report = runBenchmark({ ...smallOptions, maxSteps: 1 });
  assert.equal(report.summary.totalSamples,
    report.summary.completedGames + report.summary.incompleteSamples + report.summary.errorSamples);
  assert.ok(report.summary.incompleteSamples > 0);
  assert.ok(report.samples.every(sample => ['completed', 'incomplete', 'error'].includes(sample.status)));
});

test('mode win rates use only completed game appearances as their denominator', () => {
  const report = runBenchmark({ ...smallOptions, maxSteps: 80, maxNodes: 10 });
  for (const stats of Object.values(report.modes)) {
    assert.equal(stats.winRate, stats.winnerSamples / Math.max(1, stats.finishedAppearances));
  }
});

test('CLI argument parsing rejects unsafe caps and malformed values', () => {
  assert.throws(() => parseBenchmarkArgs(['--max-nodes', '5001']), /maxNodes|上限/i);
  assert.throws(() => parseBenchmarkArgs(['--max-time-ms', '0']), /maxTimeMs|正数/i);
  assert.throws(() => parseBenchmarkArgs(['--wat']), /参数|unknown|未知/i);
  assert.throws(() => parseBenchmarkArgs(['--max-games', '11']), /maxGames|局数/i);
  assert.throws(() => parseBenchmarkArgs(['--max-total-time-ms', '0']), /maxTotalTimeMs|正数/i);
  assert.throws(() => parseBenchmarkArgs(['--max-total-time-ms', '600001']), /maxTotalTimeMs|上限/i);
});

test('direct execution prints a JSON report that can be parsed', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/benchmark-local-ai.js', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath,
    '--games-per-player-count', '4', '--max-games', '12', '--max-steps', '1',
    '--max-nodes', '1', '--max-time-ms', '1000', '--max-total-time-ms', '1000', '--seed', '17',
  ], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.summary.totalSamples, 12);
  assert.equal(report.config.maxTotalTimeMs, 1000);
});
