import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CARDS_BY_LEVEL, COLORS, GOLD, NOBLES } from '../src/data.js';
import { applyAction, legalActions } from '../src/game.js';
import { localAction } from '../src/ai.js';
import { analyzeLocalDifficulty } from '../src/local-ai.js';

const MODES = ['simple', 'normal', 'hard', 'hell'];
const PLAYER_COUNTS = [2, 3, 4];
const MAX_GAMES = 100;
const MAX_STEPS = 2000;
const MAX_NODES = 5000;
const MAX_TIME_MS = 1000;
const MAX_TOTAL_TIME_MS = 600000;
const DEFAULTS = {
  profile: 'quick', seed: 7331, gamesPerPlayerCount: 4, maxGames: 12,
  maxSteps: 240, maxNodes: 120, maxTimeMs: 10, maxTotalTimeMs: 30000,
};

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle(values, rng) {
  const result = values.map(value => structuredClone(value));
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function fixedGame(playerCount, seed) {
  const rng = random(seed);
  const playerIds = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const cardPools = Object.fromEntries([1, 2, 3].map(level => {
    const order = shuffle(CARDS_BY_LEVEL[level], rng);
    return [level, {
      market: order.slice(0, 4),
      // applyAction draws with pop(), so reverse the remaining fixed order.
      deck: order.slice(4).reverse(),
    }];
  }));
  const gemCount = playerCount === 2 ? 4 : playerCount === 3 ? 5 : 7;
  return {
    players: playerIds.map(id => ({
      id, name: id, ai: true,
      gems: Object.fromEntries([...COLORS, GOLD].map(color => [color, 0])),
      bonuses: Object.fromEntries(COLORS.map(color => [color, 0])),
      cards: [], reserved: [], nobles: [], score: 0,
    })),
    finishScore: 15,
    turnOrder: playerIds,
    bank: Object.fromEntries([...COLORS.map(color => [color, gemCount]), [GOLD, 5]]),
    market: Object.fromEntries([1, 2, 3].map(level => [level, cardPools[level].market])),
    decks: Object.fromEntries([1, 2, 3].map(level => [level, cardPools[level].deck])),
    nobles: shuffle(NOBLES, rng).slice(0, playerCount + 1),
    turn: 0,
    round: 1,
    status: 'playing',
    finalRound: null,
    winners: [],
    log: [],
    pending: null,
    nobleAwardedThisTurn: false,
  };
}

function validateOptions(options = {}) {
  const config = { ...DEFAULTS, ...options };
  if (!['quick', 'full'].includes(config.profile)) throw new Error('profile 必须是 quick 或 full');
  for (const [name, value, min, max] of [
    ['seed', config.seed, 0, 0xffffffff],
    ['maxGames', config.maxGames, 1, MAX_GAMES],
    ['maxSteps', config.maxSteps, 1, MAX_STEPS],
    ['maxNodes', config.maxNodes, 1, MAX_NODES],
    ['maxTimeMs', config.maxTimeMs, 1, MAX_TIME_MS],
    ['maxTotalTimeMs', config.maxTotalTimeMs, 1, MAX_TOTAL_TIME_MS],
  ]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} 必须是 ${min}–${max} 范围内的整数`);
  }
  if (config.profile === 'quick') {
    if (!Number.isSafeInteger(config.gamesPerPlayerCount) || config.gamesPerPlayerCount < 4
      || config.gamesPerPlayerCount > 32 || config.gamesPerPlayerCount % 4 !== 0) {
      throw new Error('gamesPerPlayerCount 必须是 4–32 之间的 4 的倍数');
    }
    const planned = config.gamesPerPlayerCount * PLAYER_COUNTS.length;
    if (config.maxGames < planned) throw new Error(`maxGames 必须至少为计划局数 ${planned}`);
    config.plannedGames = planned;
  } else {
    config.gamesPerPlayerCount = null;
    config.plannedGames = 60;
    if (config.maxGames < config.plannedGames) throw new Error('full 模式至少需要 maxGames=60');
  }
  return config;
}

export function parseBenchmarkArgs(args = process.argv.slice(2)) {
  const flags = {
    '--profile': ['profile', 'string'],
    '--seed': ['seed', 'number'],
    '--games-per-player-count': ['gamesPerPlayerCount', 'number'],
    '--max-games': ['maxGames', 'number'],
    '--max-steps': ['maxSteps', 'number'],
    '--max-nodes': ['maxNodes', 'number'],
    '--max-time-ms': ['maxTimeMs', 'number'],
    '--max-total-time-ms': ['maxTotalTimeMs', 'number'],
  };
  const overrides = {};
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i], definition = flags[flag];
    if (!definition) throw new Error(`未知参数: ${flag}`);
    if (overrides[definition[0]] !== undefined) throw new Error(`参数重复: ${flag}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${flag} 缺少值`);
    overrides[definition[0]] = definition[1] === 'number' ? Number(value) : value;
    i += 1;
  }
  return validateOptions(overrides);
}

function permutations(values, length) {
  if (length === 0) return [[]];
  const result = [];
  for (const value of values) {
    for (const suffix of permutations(values.filter(item => item !== value), length - 1)) result.push([value, ...suffix]);
  }
  return result;
}

function makeSchedule(config) {
  const schedule = [];
  let index = 0, nextBlockId = 0;
  for (const playerCount of PLAYER_COUNTS) {
    if (config.profile === 'quick') {
      const repetitions = config.gamesPerPlayerCount / 4;
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const seed = (config.seed + playerCount * 1009 + repetition) >>> 0;
        const blockId = nextBlockId++;
        for (let rotation = 0; rotation < 4; rotation += 1) {
          schedule.push({
            index: index++, blockId, rotation, playerCount, seed,
            modes: Array.from({ length: playerCount }, (_, seat) => MODES[(seat + rotation) % MODES.length]),
          });
        }
      }
    } else {
      const seed = (config.seed + playerCount * 1009) >>> 0;
      const blockId = nextBlockId++;
      permutations(MODES, playerCount).forEach((modes, rotation) => {
        schedule.push({ index: index++, blockId, rotation, playerCount, seed, modes });
      });
    }
  }
  return schedule;
}

function scheduleMetadata(schedule) {
  const blocks = new Map(schedule.map(sample => [sample.blockId, sample]));
  const seedReusePerBlockByPlayerCount = Object.fromEntries(PLAYER_COUNTS.map(playerCount => {
    const playerSamples = schedule.filter(sample => sample.playerCount === playerCount);
    const countsByBlock = new Map();
    for (const sample of playerSamples) countsByBlock.set(sample.blockId, (countsByBlock.get(sample.blockId) || 0) + 1);
    return [playerCount, Math.max(0, ...countsByBlock.values())];
  }));
  return {
    uniqueSeedCount: new Set(schedule.map(sample => sample.seed)).size,
    pairedScheduleBlocks: blocks.size,
    seedReusePerBlockByPlayerCount,
  };
}

function createModeStats() {
  return {
    appearances: 0,
    finishedAppearances: 0,
    seats: Object.fromEntries(PLAYER_COUNTS.map(count => [count, Array(count).fill(0)])),
    soloWins: 0, sharedWins: 0, winnerSamples: 0,
    finalRankTotal: 0, finalRankSamples: 0,
    actions: 0, totalDecisionMs: 0, decisions: 0,
    completedSamples: 0, completedRollouts: 0, nodes: 0,
    searchDecisions: 0, truncatedSearches: 0, errorCount: 0,
  };
}

function finalRanks(game) {
  const ordered = [...game.players].sort((a, b) => b.score - a.score || a.cards.length - b.cards.length);
  const ranks = new Map();
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].score === ordered[start].score
      && ordered[end].cards.length === ordered[start].cards.length) end += 1;
    const rank = ((start + 1) + end) / 2;
    for (let i = start; i < end; i += 1) ranks.set(ordered[i].id, rank);
    start = end;
  }
  return ranks;
}

function makeReport(config, schedule) {
  const pairing = scheduleMetadata(schedule);
  return {
    schemaVersion: 1,
    config: {
      profile: config.profile, seed: config.seed, playerCounts: PLAYER_COUNTS,
      gamesPerPlayerCount: config.gamesPerPlayerCount, plannedGames: schedule.length,
      ...pairing,
      maxGames: config.maxGames, maxSteps: config.maxSteps,
      maxNodes: config.maxNodes, maxTimeMs: config.maxTimeMs,
      maxTotalTimeMs: config.maxTotalTimeMs,
    },
    sharedRankRule: '按最终分数降序、购牌数升序；两项都相同则并列玩家取其占据名次的平均值。',
    samples: [],
    summary: {
      ...pairing,
      maxTotalTimeMs: config.maxTotalTimeMs,
      totalSamples: schedule.length, attemptedSamples: 0, skippedSamples: 0,
      completedGames: 0, incompleteSamples: 0, errorSamples: 0, timedOutSamples: 0,
      totalActions: 0, avgActionsPerAttemptedGame: 0, totalDecisionMs: 0, avgDecisionMsPerAction: 0,
      totalElapsedMs: 0,
      completedSearchSamples: 0, completedRollouts: 0, searchDecisions: 0,
      truncatedSearches: 0, truncationRate: 0,
    },
    modes: Object.fromEntries(MODES.map(mode => [mode, createModeStats()])),
  };
}

function finishReport(report) {
  const summary = report.summary;
  const decisionCount = Object.values(report.modes).reduce((n, mode) => n + mode.decisions, 0);
  summary.avgActionsPerAttemptedGame = summary.totalActions / Math.max(1, summary.attemptedSamples);
  summary.avgDecisionMsPerAction = summary.totalDecisionMs / Math.max(1, decisionCount);
  summary.truncationRate = summary.truncatedSearches / Math.max(1, summary.searchDecisions);
  for (const stats of Object.values(report.modes)) {
    stats.winRate = (stats.soloWins + stats.sharedWins) / Math.max(1, stats.finishedAppearances);
    stats.avgFinalRank = stats.finalRankTotal / Math.max(1, stats.finalRankSamples);
    stats.avgActionsPerGame = stats.actions / Math.max(1, stats.appearances);
    stats.avgDecisionMsPerAction = stats.totalDecisionMs / Math.max(1, stats.decisions);
    stats.truncationRate = stats.truncatedSearches / Math.max(1, stats.searchDecisions);
    delete stats.finalRankTotal;
    delete stats.finalRankSamples;
    delete stats.totalDecisionMs;
    delete stats.decisions;
  }
  return report;
}

export function runBenchmark(options = {}) {
  const { now: clock = () => performance.now(), ...rawConfig } = options;
  if (typeof clock !== 'function') throw new Error('now 必须是时钟函数');
  const config = validateOptions(rawConfig);
  const startedAt = clock();
  const deadline = startedAt + config.maxTotalTimeMs;
  const schedule = makeSchedule(config);
  if (schedule.length > config.maxGames || schedule.length > MAX_GAMES) throw new Error('计划局数超过 maxGames 安全上限');
  const report = makeReport(config, schedule);

  for (const sample of schedule) {
    if (clock() >= deadline) {
      report.summary.skippedSamples += 1;
      report.samples.push({
        index: sample.index, blockId: sample.blockId, rotation: sample.rotation,
        seed: sample.seed, playerCount: sample.playerCount, modes: sample.modes,
        steps: 0, status: 'skipped', reason: 'max-total-time',
      });
      continue;
    }
    report.summary.attemptedSamples += 1;
    const game = fixedGame(sample.playerCount, sample.seed);
    const modeByPlayer = new Map();
    for (let seat = 0; seat < sample.playerCount; seat += 1) {
      const mode = sample.modes[seat], stats = report.modes[mode];
      modeByPlayer.set(game.turnOrder[seat], mode);
      stats.appearances += 1;
      stats.seats[sample.playerCount][seat] += 1;
    }
    let steps = 0, status = 'incomplete', reason = null, errorMessage = null;
    try {
      while (game.status === 'playing' && steps < config.maxSteps) {
        if (clock() >= deadline) {
          status = 'timeout';
          reason = 'max-total-time';
          break;
        }
        const playerId = game.players[game.turn].id;
        const mode = modeByPlayer.get(playerId);
        const actions = legalActions(game, playerId);
        if (!actions.length) throw new Error(`玩家 ${playerId} 没有合法动作`);
        const before = performance.now();
        let chosen, search = null;
        if (mode === 'simple') chosen = localAction(game, playerId, actions);
        else {
          search = analyzeLocalDifficulty(game, playerId, actions, {
            difficulty: mode, seed: sample.seed + steps + PLAYER_COUNTS.indexOf(sample.playerCount),
            maxNodes: config.maxNodes, maxTimeMs: config.maxTimeMs,
          });
          chosen = search.action;
        }
        const elapsed = performance.now() - before;
        if (!actions.includes(chosen)) throw new Error(`${mode} 返回的动作不是 legalActions 原对象`);
        const stats = report.modes[mode];
        stats.actions += 1;
        stats.totalDecisionMs += elapsed;
        stats.decisions += 1;
        report.summary.totalDecisionMs += elapsed;
        if (search) {
          stats.completedSamples += search.completedSamples;
          stats.completedRollouts += search.completedRollouts;
          stats.nodes += search.nodes;
          stats.searchDecisions += 1;
          if (search.truncated) stats.truncatedSearches += 1;
          report.summary.completedSearchSamples += search.completedSamples;
          report.summary.completedRollouts += search.completedRollouts;
          report.summary.searchDecisions += 1;
          if (search.truncated) report.summary.truncatedSearches += 1;
        }
        const next = applyAction(game, playerId, chosen);
        Object.assign(game, next);
        steps += 1;
      }
      if (status !== 'timeout' && clock() >= deadline) {
        status = 'timeout';
        reason = 'max-total-time';
      } else if (game.status === 'finished') status = 'completed';
      else if (status !== 'timeout') reason = 'max-steps';
    } catch (error) {
      status = 'error';
      errorMessage = String(error?.message ?? error);
      const activeMode = modeByPlayer.get(game.players[game.turn]?.id);
      if (activeMode) report.modes[activeMode].errorCount += 1;
    }

    report.summary.totalActions += steps;
    if (status === 'completed') {
      report.summary.completedGames += 1;
      const ranks = finalRanks(game);
      for (const player of game.players) {
        const mode = modeByPlayer.get(player.id), stats = report.modes[mode];
        stats.finishedAppearances += 1;
        stats.finalRankTotal += ranks.get(player.id);
        stats.finalRankSamples += 1;
        if (game.winners.includes(player.id)) {
          stats.winnerSamples += 1;
          if (game.winners.length === 1) stats.soloWins += 1;
          else stats.sharedWins += 1;
        }
      }
    } else if (status === 'incomplete') report.summary.incompleteSamples += 1;
    else if (status === 'timeout') report.summary.timedOutSamples += 1;
    else report.summary.errorSamples += 1;
    report.samples.push({
      index: sample.index, blockId: sample.blockId, rotation: sample.rotation,
      seed: sample.seed, playerCount: sample.playerCount,
      modes: sample.modes, steps, status, ...(reason ? { reason } : {}),
      ...(errorMessage ? { error: errorMessage } : {}),
      ...(status === 'completed' ? { winners: game.winners } : {}),
    });
  }
  report.summary.totalElapsedMs = Math.max(0, clock() - startedAt);
  return finishReport(report);
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  try {
    const report = runBenchmark(parseBenchmarkArgs());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
