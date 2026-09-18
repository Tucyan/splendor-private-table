// Opt-in algorithms. Nothing in the room scheduler or existing AI entry is changed.
import { CARDS_BY_LEVEL, COLORS } from './data.js';
import { applyAction, legalActions, paymentFor } from './game.js';
import { localAction } from './ai.js';

const LEVELS = [1, 2, 3];
const STOP = Symbol('search budget exhausted');
const sum = values => Object.values(values).reduce((a, b) => a + b, 0);

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle(cards, rng) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Build a belief state from public facts BEFORE simulation. Never use the real
// deck's identities (except hell), opponents' reserved identities, or log text.
function sampleWorld(game, playerId, clairvoyant, rng) {
  const players = game.players.map(p => ({
    id: p.id, name: p.id, ai: p.ai, score: p.score,
    gems: { ...p.gems }, bonuses: { ...p.bonuses }, cards: structuredClone(p.cards),
    nobles: structuredClone(p.nobles),
    reserved: p.id === playerId ? structuredClone(p.reserved) : p.reserved.map(c => ({ level: c.level })),
  }));
  const known = new Set([
    ...Object.values(game.market).flat(), ...players.flatMap(p => p.cards),
    ...players.find(p => p.id === playerId).reserved,
    ...(clairvoyant ? Object.values(game.decks).flat() : []),
  ].map(c => c.id));
  const decks = {};
  for (const level of LEVELS) {
    const pool = shuffle(CARDS_BY_LEVEL[level].filter(c => !known.has(c.id)), rng);
    for (const p of players) {
      if (p.id === playerId) continue;
      p.reserved = p.reserved.map(c => c.level === level ? structuredClone(pool.pop()) : c);
    }
    const count = Array.isArray(game.decks[level]) ? game.decks[level].length : game.decks[level];
    decks[level] = clairvoyant ? structuredClone(game.decks[level]) : pool.slice(0, count);
  }
  return {
    players, decks, market: structuredClone(game.market), nobles: structuredClone(game.nobles),
    bank: { ...game.bank }, turn: game.turn, turnOrder: [...(game.turnOrder || players.map(p => p.id))],
    round: game.round, finishScore: game.finishScore ?? 15, finalRound: game.finalRound ?? null,
    status: game.status, winners: [...(game.winners || [])], pending: structuredClone(game.pending),
    nobleAwardedThisTurn: game.nobleAwardedThisTurn ?? false,
    consecutivePasses: game.consecutivePasses ?? 0, log: [],
  };
}

function distance(player, card, bank) {
  const deficits = COLORS.map(c => Math.max(0, card.cost[c] - player.bonuses[c] - player.gems[c]));
  let gold = player.gems.gold || 0;
  // Use gold on the largest deficits to estimate the number of take actions.
  while (gold-- > 0) {
    const largest = Math.max(...deficits);
    if (!largest) break;
    deficits[deficits.indexOf(largest)]--;
  }
  const amount = deficits.reduce((a, b) => a + b, 0);
  const bottleneck = Math.max(0, ...deficits.map((n, i) => n / (bank[COLORS[i]] >= 4 ? 2 : 1)));
  const unavailable = deficits.reduce((n, d, i) => n + (d > bank[COLORS[i]] ? 0.5 : 0), 0);
  return Math.max(amount / 3, bottleneck) + unavailable;
}

function playerValue(game, player) {
  const leader = Math.max(...game.players.map(p => p.score));
  const late = game.finalRound !== null ? 1 : Math.min(1, leader / game.finishScore);
  const visible = [...Object.values(game.market).flat(), ...player.reserved];
  const demand = Object.fromEntries(COLORS.map(c => [c,
    visible.reduce((n, card) => n + Math.min(3, Math.max(0, card.cost[c] - player.bonuses[c])), 0) / Math.max(1, visible.length),
  ]));
  const engine = COLORS.reduce((n, c) => n + Math.log1p(player.bonuses[c]) * (2 + demand[c]), 0);
  const noble = game.nobles.map(n => {
    const missing = COLORS.reduce((total, c) => total + Math.max(0, n.cost[c] - player.bonuses[c]), 0);
    return n.points * 5 / (1 + missing);
  }).sort((a, b) => b - a);
  const opportunities = visible.map(c => {
    const bonus = (1 - late * 0.7) * (2 + demand[c.bonus]) / (1 + player.bonuses[c.bonus]);
    return (c.points * (6 + late * 4) + bonus) / (1 + distance(player, c, game.bank));
  }).sort((a, b) => b - a);
  const reserveBurden = player.reserved.reduce((n, c) => n + Math.min(5, distance(player, c, game.bank)) * 0.6, 0);
  return player.score * (14 + late * 10) + engine * (1 - late * 0.65)
    + (noble[0] || 0) + (noble[1] || 0) * 0.2
    + (opportunities[0] || 0) * 1.5 + (opportunities[1] || 0) * 0.25
    + sum(player.gems) * 0.2 + (player.gems.gold || 0) * 1.6 - reserveBurden;
}

function evaluate(game, playerId) {
  if (game.status === 'finished') {
    if (!game.winners.includes(playerId)) return -100000;
    return game.winners.length === 1 ? 100000 : 50000;
  }
  const self = game.players.find(p => p.id === playerId);
  const opponents = game.players.filter(p => p.id !== playerId).map(p => playerValue(game, p));
  return playerValue(game, self) - Math.max(...opponents) * 0.65;
}

function transition(game, action, budget) {
  if (budget.nodes >= budget.maxNodes || performance.now() >= budget.deadline) throw STOP;
  budget.nodes++;
  const next = applyAction(game, game.players[game.turn].id, action);
  next.log = [];
  return next;
}

// A search ply is a complete turn, including noble selection and token returns.
function finishPending(game, budget) {
  let next = game;
  while (next.status === 'playing' && next.pending) {
    const actor = next.players[next.turn].id;
    let best, bestValue = -Infinity;
    for (const action of legalActions(next, actor)) {
      const candidate = transition(next, action, budget);
      const value = evaluate(candidate, actor);
      if (value > bestValue) { best = candidate; bestValue = value; }
    }
    next = best;
  }
  return next;
}

function play(game, action, budget) {
  return finishPending(transition(game, action, budget), budget);
}

// Ordinary opponents choose using the pre-action market. They cannot prefer an
// action because it reveals a particular hidden replacement in this sample.
function policyValue(before, after, actor, action) {
  if (after.status === 'finished') return evaluate(after, actor);
  const visible = new Set(Object.values(before.market).flat().map(c => c.id));
  const masked = { ...after, market: Object.fromEntries(LEVELS.map(level => [level,
    after.market[level].filter(c => visible.has(c.id)),
  ])) };
  if (action.type === 'reserve' && action.level) {
    masked.players = after.players.map(p => p.id === actor ? { ...p, reserved: p.reserved.slice(0, -1) } : p);
  }
  return evaluate(masked, actor);
}

function threatensWin(game, player, card) {
  try { paymentFor(player, card); } catch { return false; }
  const bonuses = { ...player.bonuses, [card.bonus]: player.bonuses[card.bonus] + 1 };
  const noble = Math.max(0, ...game.nobles.filter(n => COLORS.every(c => bonuses[c] >= n.cost[c])).map(n => n.points));
  return player.score + card.points + noble >= game.finishScore;
}

// Cheap ordering only; the shortlisted moves still use the actual rules engine.
function priority(game, player, action) {
  const cards = [...Object.values(game.market).flat(), ...player.reserved];
  const card = cards.find(c => c.id === action.cardId);
  if (action.type === 'buy') {
    return (threatensWin(game, player, card) ? 1000 : 0) + card.points * 12
      + 4 / (1 + player.bonuses[card.bonus]) - sum(action.payment || {}) * 0.3;
  }
  if (action.type === 'reserve') {
    if (!card) return -15;
    const denial = game.players.some(p => p.id !== player.id && threatensWin(game, p, card));
    return (denial ? 900 : 0) + (game.bank.gold > 0 ? 1 : 0) - distance(player, card, game.bank) * 2;
  }
  if (action.type === 'take') {
    const after = { ...player, gems: { ...player.gems } };
    for (const [color, count] of Object.entries(action.gems)) after.gems[color] += count;
    const potential = p => Math.max(0, ...cards.map(c =>
      (c.points * 10 + 5 / (1 + p.bonuses[c.bonus])) / (1 + distance(p, c, game.bank))));
    return potential(after) - potential(player) + sum(action.gems) * 0.1 - Math.max(0, sum(after.gems) - 10) * 2;
  }
  return -100;
}

function rollout(game, rootId, budget, clairvoyant) {
  let next = game;
  // Opponents each maximize their own evaluation (multiplayer, not a coalition).
  // Stop after the root's next complete turn, or actual game termination.
  for (let ply = 0; ply < game.players.length + 1 && next.status === 'playing'; ply++) {
    const actor = next.players[next.turn].id;
    let best, bestValue = -Infinity;
    const player = next.players[next.turn];
    const candidates = legalActions(next, actor).map(action => ({ action, value: priority(next, player, action) }))
      .sort((a, b) => b.value - a.value).slice(0, 5);
    for (const { action } of candidates) {
      const candidate = play(next, action, budget);
      const value = clairvoyant && actor === rootId ? evaluate(candidate, actor) : policyValue(next, candidate, actor, action);
      if (value > bestValue) { best = candidate; bestValue = value; }
    }
    next = best;
    if (actor === rootId) break;
  }
  return evaluate(next, rootId);
}

/**
 * Pure synchronous, opt-in decision API. Returns an original supplied action.
 * difficulty: normal | hard | hell. Input is the full server-side game state.
 * seed controls belief sampling; budgets bound work, not playing strength.
 */
export function analyzeLocalDifficulty(game, playerId, actions, {
  difficulty = 'normal', seed = 1, maxNodes = 4000, maxTimeMs = 150,
} = {}) {
  if (!['normal', 'hard', 'hell'].includes(difficulty)) throw new Error('未知 AI 难度');
  if (!actions.length) throw new Error('没有可用动作');
  if (game.players[game.turn]?.id !== playerId || game.status !== 'playing') throw new Error('不是可行动的玩家');
  for (const [name, value] of Object.entries({ maxNodes, maxTimeMs })) {
    if (!Number.isFinite(value) || value < 1) throw new Error(`${name} 必须为正数`);
  }
  const budget = { nodes: 0, maxNodes: Math.floor(Math.min(50000, maxNodes)), deadline: performance.now() + Math.min(5000, maxTimeMs) };
  const rng = random(seed);
  const samples = difficulty === 'hell' ? 1 : 3;
  const totals = actions.map(() => 0);
  const worlds = [];
  const outcomes = [];
  let action = localAction(game, playerId, actions), completedSamples = 0, completedRollouts = 0, truncated = false;
  try {
    for (let sample = 0; sample < samples; sample++) {
      const world = sampleWorld(game, playerId, difficulty === 'hell', rng);
      const states = actions.map(a => play(world, a, budget));
      const values = states.map(s => evaluate(s, playerId));
      // Publish only complete passes so action order cannot bias a timeout.
      values.forEach((v, i) => { totals[i] += v; });
      worlds.push(world); outcomes.push(states); completedSamples++;
      action = actions[totals.indexOf(Math.max(...totals))];
    }
    if (difficulty !== 'normal' && !game.pending) {
      const candidates = actions.map((_, i) => i).sort((a, b) => totals[b] - totals[a]).slice(0, 6);
      // Always preserve immediate winning purchases and direct win-denials.
      const market = Object.values(game.market).flat();
      for (let i = 0; i < actions.length; i++) {
        const a = actions[i], c = [...market, ...game.players.find(p => p.id === playerId).reserved].find(c => c.id === a.cardId);
        if (!c) continue;
        const tactical = a.type === 'buy' && threatensWin(game, game.players.find(p => p.id === playerId), c)
          || a.type === 'reserve' && game.players.some(p => p.id !== playerId && threatensWin(game, p, c));
        if (tactical && !candidates.includes(i)) candidates.push(i);
      }
      const scores = new Map(candidates.map(i => [i, 0]));
      for (let sample = 0; sample < worlds.length; sample++) {
        const pass = candidates.map(i => rollout(outcomes[sample][i], playerId, budget, difficulty === 'hell'));
        pass.forEach((v, j) => scores.set(candidates[j], scores.get(candidates[j]) + v));
        completedRollouts++;
        const best = [...candidates].sort((a, b) => scores.get(b) - scores.get(a) || totals[b] - totals[a])[0];
        action = actions[best];
      }
    }
  } catch (error) {
    if (error !== STOP) throw error;
    truncated = true;
  }
  return { action, difficulty, nodes: budget.nodes, completedSamples, completedRollouts, truncated };
}

export function chooseLocalDifficultyAction(game, playerId, actions, options) {
  return analyzeLocalDifficulty(game, playerId, actions, options).action;
}
