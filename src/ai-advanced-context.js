import { AdvancedObservationMemory } from './ai-advanced-observation.js';
import { paymentFor } from './game.js';

export { AdvancedObservationMemory };

const clone = value => structuredClone(value);
const capText = (value, length = 120) => typeof value === 'string' ? value.slice(0, length) : '';
const idOf = value => typeof value === 'string' ? value.slice(0, 100)
  : typeof value?.cardId === 'string' ? value.cardId.slice(0, 100)
    : typeof value?.targetId === 'string' ? value.targetId.slice(0, 100) : null;
const mapFor = (root, gameId) => {
  if (!root.has(gameId)) root.set(gameId, new Map());
  return root.get(gameId);
};
const summaryCard = card => ({ id: card.id, level: card.level, bonus: card.bonus, points: card.points, cost: clone(card.cost) });

function shortRecord(value, defaultType) {
  if (!value || typeof value !== 'object') return null;
  const record = {};
  const type = capText(value.type || defaultType, 32);
  if (type) record.type = type;
  for (const key of ['targetId', 'reasonId']) if (typeof value[key] === 'string') record[key] = capText(value[key], 80);
  for (const key of ['note', 'reason']) if (typeof value[key] === 'string') record[key] = capText(value[key], 160);
  return Object.keys(record).length ? record : null;
}

function normalizePlan(plan = {}) {
  return {
    primaryTarget: idOf(plan.primaryTarget),
    backupTarget: idOf(plan.backupTarget),
    nobleTarget: idOf(plan.nobleTarget),
    expectedActions: Array.isArray(plan.expectedActions)
      ? plan.expectedActions.slice(0, 8).map(item => typeof item === 'string' ? item.slice(0, 100) : shortRecord(item, 'action')).filter(Boolean)
      : [],
    lastAction: shortRecord(plan.lastAction, 'action'),
    rationale: shortRecord(plan.rationale, 'plan'),
  };
}

function planHasNoTargets(plan) {
  return !plan.primaryTarget && !plan.backupTarget && !plan.nobleTarget && plan.expectedActions.length === 0;
}

function opponentCanTriggerFinish(game, playerId, observedReserved = {}) {
  const target = Number.isInteger(game.finishScore) ? game.finishScore : 15;
  for (const opponent of game.players.filter(player => player.id !== playerId)) {
    const knownReserved = (observedReserved[opponent.id] || []).filter(item => item?.cardId && item.cost).map(item => ({
      id: item.cardId, level: item.level, points: item.points || 0, bonus: item.bonus, cost: item.cost,
    }));
    for (const card of [...Object.values(game.market || {}).flat(), ...knownReserved]) {
      try { paymentFor(opponent, card); } catch { continue; }
      const bonuses = { ...opponent.bonuses, [card.bonus]: (opponent.bonuses?.[card.bonus] || 0) + 1 };
      const noble = (game.nobles || []).filter(item => COLORS_ORDER.every(color => bonuses[color] >= item.cost[color]))
        .reduce((best, item) => Math.max(best, item.points || 0), 0);
      if ((opponent.score || 0) + (card.points || 0) + noble >= target) return true;
    }
  }
  return false;
}

const COLORS_ORDER = ['white', 'blue', 'green', 'red', 'black'];

/** Short-lived planning memory. It is intentionally only held by this object. */
export class AdvancedPlanMemory {
  #plans = new Map();

  set(gameId, playerId, plan) {
    const value = normalizePlan(plan);
    mapFor(this.#plans, String(gameId)).set(String(playerId), value);
    return clone(value);
  }

  get(gameId, playerId) {
    const value = this.#plans.get(String(gameId))?.get(String(playerId));
    return value ? clone(value) : null;
  }

  validate(gameId, playerId, game, { observedReserved = {} } = {}) {
    const stored = this.get(gameId, playerId);
    if (!stored) return null;
    const plan = normalizePlan(stored);
    const player = game.players.find(item => item.id === playerId);
    const visibleIds = new Set([
      ...Object.values(game.market || {}).flat().map(card => card.id),
      ...(player?.reserved || []).map(card => card.id),
    ]);
    const nobleIds = new Set((game.nobles || []).map(noble => noble.id));
    const invalidated = [];
    if (plan.primaryTarget && !visibleIds.has(plan.primaryTarget)) { invalidated.push('primary target'); plan.primaryTarget = null; }
    if (plan.backupTarget && !visibleIds.has(plan.backupTarget)) { invalidated.push('backup target'); plan.backupTarget = null; }
    if (plan.nobleTarget && !nobleIds.has(plan.nobleTarget)) { invalidated.push('noble target'); plan.nobleTarget = null; }
    if (invalidated.length) {
      plan.expectedActions = [];
      plan.rationale = { type: 'target_invalidated', note: `${invalidated.join(', ')} unavailable` };
    }
    if ((game.finalRound !== null && game.finalRound !== undefined) || opponentCanTriggerFinish(game, playerId, observedReserved)) {
      plan.primaryTarget = null;
      plan.backupTarget = null;
      plan.nobleTarget = null;
      plan.expectedActions = [];
      plan.rationale = { type: 'urgent_endgame', note: game.finalRound != null ? 'final round is active' : 'opponent can trigger finish score' };
    }
    if (planHasNoTargets(plan) && !['urgent_endgame', 'target_invalidated'].includes(plan.rationale?.type)) plan.rationale = null;
    this.set(gameId, playerId, plan);
    return clone(plan);
  }

  clear(gameId, playerId) {
    const plans = this.#plans.get(String(gameId));
    if (playerId !== undefined) {
      plans?.delete(String(playerId));
      if (plans?.size === 0) this.#plans.delete(String(gameId));
    } else this.#plans.delete(String(gameId));
  }

  has(gameId, playerId) {
    return this.#plans.get(String(gameId))?.has(String(playerId)) || false;
  }

  get size() {
    return [...this.#plans.values()].reduce((count, plans) => count + plans.size, 0);
  }
}

function sanitizeExperience(item, index) {
  if (typeof item === 'string') return { id: String(index), text: item.slice(0, 400) };
  if (!item || typeof item !== 'object') return null;
  return {
    id: capText(item.id || String(index), 80),
    text: capText(item.text || item.summary || '', 400),
  };
}

function boundedAction(action) {
  if (!action || typeof action !== 'object') return null;
  const value = {};
  if (typeof action.type === 'string') value.type = action.type.slice(0, 24);
  if (typeof action.cardId === 'string') value.cardId = action.cardId.slice(0, 100);
  if (typeof action.nobleId === 'string') value.nobleId = action.nobleId.slice(0, 100);
  if (Number.isInteger(action.level)) value.level = action.level;
  if (action.gems && typeof action.gems === 'object') {
    value.gems = Object.fromEntries(['white', 'blue', 'green', 'red', 'black', 'gold']
      .filter(color => Number.isFinite(action.gems[color]) && action.gems[color] > 0)
      .map(color => [color, action.gems[color]]));
  }
  if (action.payment && typeof action.payment === 'object') {
    value.payment = Object.fromEntries(['white', 'blue', 'green', 'red', 'black', 'gold']
      .filter(color => Number.isFinite(action.payment[color]) && action.payment[color] > 0)
      .map(color => [color, action.payment[color]]));
  }
  return value;
}

function boundedColorMap(value) {
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(['white', 'blue', 'green', 'red', 'black']
    .filter(color => Number.isFinite(value[color]))
    .map(color => [color, value[color]]));
}

function boundedFacts(facts) {
  if (!facts || typeof facts !== 'object') return null;
  const result = {};
  for (const key of ['actionType', 'cardId']) if (typeof facts[key] === 'string') result[key] = capText(facts[key], 100);
  for (const key of ['scoreBefore', 'scoreAfter', 'scoreGain', 'noblePoints', 'goldUse', 'expectedActions', 'discardOpportunityCost']) {
    if (facts[key] === null || Number.isFinite(facts[key])) result[key] = facts[key];
  }
  for (const key of ['reachesFinishScore', 'finalRoundStarted', 'leadsAfterAction', 'wouldWinIfGameEnded', 'endsGameNow', 'determinedWinner', 'bankCanSupply']) {
    if (typeof facts[key] === 'boolean' || facts[key] === null) result[key] = facts[key];
  }
  for (const key of ['noblesAwarded', 'winnerIds']) if (Array.isArray(facts[key])) result[key] = facts[key].slice(0, 4).map(value => capText(value, 100));
  if (facts.nobleEligibility) result.nobleEligibility = {
    eligibleAfterAction: (facts.nobleEligibility.eligibleAfterAction || []).slice(0, 5).map(value => capText(value, 100)),
    maxPointsAfterAction: Number(facts.nobleEligibility.maxPointsAfterAction) || 0,
  };
  if (facts.invalidHoarding) result.invalidHoarding = {
    deadColoredTokens: Number(facts.invalidHoarding.deadColoredTokens) || 0,
    deadGold: Number(facts.invalidHoarding.deadGold) || 0,
    handOverflowBeforeDiscard: Number(facts.invalidHoarding.handOverflowBeforeDiscard) || 0,
  };
  if (facts.cardTactics) {
    const tactic = facts.cardTactics;
    result.cardTactics = {
      cardId: capText(tactic.cardId, 100), level: Number(tactic.level) || 0, points: Number(tactic.points) || 0,
      discountedCost: boundedColorMap(tactic.discountedCost), colorPaid: boundedColorMap(tactic.colorPaid),
      goldUse: Number(tactic.goldUse) || 0, remainingDeficit: boundedColorMap(tactic.remainingDeficit),
      reachable: Boolean(tactic.reachable), bankCanSupply: Boolean(tactic.bankCanSupply),
      expectedActions: Number.isFinite(tactic.expectedActions) ? Math.max(0, Math.min(99, Math.floor(tactic.expectedActions))) : null,
      discountMarginal: tactic.discountMarginal ? {
        color: capText(tactic.discountMarginal.color, 16),
        cardsAffected: Number(tactic.discountMarginal.cardsAffected) || 0,
        cardIds: (tactic.discountMarginal.cardIds || []).slice(0, 8).map(value => capText(value, 100)),
      } : null,
      nobleEligibility: tactic.nobleEligibility ? {
        eligibleAfterBuy: (tactic.nobleEligibility.eligibleAfterBuy || []).slice(0, 5).map(value => capText(value, 100)),
        maxPointsAfterBuy: Number(tactic.nobleEligibility.maxPointsAfterBuy) || 0,
      } : null,
    };
  }
  return result;
}

function boundedTacticalAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return null;
  const rows = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  const chosen = rows.find(row => row.actionIndex === analysis.actionIndex);
  const selected = [chosen, ...rows.filter(row => row !== chosen)].filter(Boolean).slice(0, 12);
  return {
    ...(Number.isInteger(analysis.actionIndex) ? { actionIndex: analysis.actionIndex } : {}),
    ...(boundedAction(analysis.action) ? { action: boundedAction(analysis.action) } : {}),
    candidates: selected.map(row => ({
      ...(Number.isInteger(row.actionIndex) ? { actionIndex: row.actionIndex } : {}),
      ...(boundedAction(row.action) ? { action: boundedAction(row.action) } : {}),
      ...(Number.isFinite(row.utility) ? { utility: row.utility } : {}),
      ...(boundedFacts(row.facts) ? { facts: boundedFacts(row.facts) } : {}),
    })),
    opponentThreats: (Array.isArray(analysis.opponentThreats) ? analysis.opponentThreats : []).slice(0, 12).map(threat => ({
      actorId: capText(threat.actorId, 100), cardId: capText(threat.cardId, 100),
      ...(typeof threat.source === 'string' ? { source: threat.source.slice(0, 16) } : {}),
      scoreAfter: Number(threat.scoreAfter) || 0,
      reachesFinishScore: Boolean(threat.reachesFinishScore), leadsAfterAction: Boolean(threat.leadsAfterAction),
      wouldWinIfGameEnded: Boolean(threat.wouldWinIfGameEnded), endsGameNow: Boolean(threat.endsGameNow),
      determinedWinner: Boolean(threat.determinedWinner),
      noblesAwarded: (threat.noblesAwarded || []).slice(0, 4).map(value => capText(value, 100)),
    })),
    ...(analysis.budget ? { budget: {
      nodes: Number(analysis.budget.nodes) || 0,
      maxNodes: Number(analysis.budget.maxNodes) || 0,
      completedCandidates: Number(analysis.budget.completedCandidates) || 0,
      truncated: Boolean(analysis.budget.truncated),
    } } : {}),
  };
}

/** Build a size-bounded context using public facts plus the observer's own private cards. */
export function buildAdvancedContext(game, playerId, {
  gameId = 'current', observationMemory,
  observation = null, planMemory, experiences = [], maxEvents = 12, tacticalAnalysis,
} = {}) {
  const self = game.players.find(player => player.id === playerId);
  if (!self) throw new Error('unknown player');
  const order = [...(game.turnOrder || game.players.map(player => player.id))];
  const seatById = new Map(order.map((id, index) => [id, index]));
  const record = observation || observationMemory?.get(gameId, playerId) || { events: [], observedReserved: {} };
  const opponents = game.players.filter(player => player.id !== playerId).map(player => {
    const known = (record.observedReserved?.[player.id] || []).slice(0, 3).map(item => ({
      cardId: item.cardId, level: item.level, points: item.points, bonus: item.bonus,
      ...(item.cost ? { cost: clone(item.cost) } : {}),
    }));
    return {
      playerId: player.id,
      seat: seatById.get(player.id) ?? -1,
      gems: clone(player.gems),
      bonuses: clone(player.bonuses),
      cards: player.cards.slice(0, 90).map(card => ({ id: card.id, level: card.level, bonus: card.bonus, points: card.points })),
      score: Number(player.score) || 0,
      nobles: player.nobles.slice(0, 10).map(noble => ({ id: noble.id, points: noble.points })),
      reservedCount: Math.min(3, player.reserved?.length || 0),
      observedReserved: known,
      unknownReservedCount: Math.max(0, Math.min(3, player.reserved?.length || 0) - known.length),
    };
  });
  const plan = planMemory?.validate(gameId, playerId, game, { observedReserved: record.observedReserved || {} }) || null;
  const recentEvents = (record.events || []).slice(-Math.min(12, Math.max(1, maxEvents))).map(event => clone(event));
  const experienceList = (Array.isArray(experiences) ? experiences : []).slice(0, 8).map(sanitizeExperience).filter(Boolean);
  const decks = Object.fromEntries(Object.entries(game.decks || {}).map(([level, value]) => [level, Array.isArray(value) ? value.length : Number(value) || 0]));
  return {
    version: 1,
    self: {
      playerId, seat: seatById.get(playerId) ?? -1,
      gems: clone(self.gems), bonuses: clone(self.bonuses),
      cards: self.cards.slice(0, 90).map(summaryCard),
      reserved: self.reserved.slice(0, 3).map(summaryCard),
      score: Number(self.score) || 0,
      nobles: self.nobles.slice(0, 10).map(noble => ({ id: noble.id, points: noble.points, cost: clone(noble.cost) })),
    },
    table: {
      finishScore: Number.isInteger(game.finishScore) ? game.finishScore : 15,
      round: Number(game.round) || 1,
      finalRound: game.finalRound ?? null,
      turnOrder: order,
      currentPlayerId: game.players[game.turn]?.id ?? null,
      currentSeat: seatById.get(game.players[game.turn]?.id) ?? -1,
      bank: clone(game.bank),
      market: Object.fromEntries(Object.entries(game.market || {}).map(([level, cards]) => [level, cards.slice(0, 4).map(summaryCard)])),
      deckCounts: decks,
      nobles: (game.nobles || []).slice(0, 5).map(noble => ({ id: noble.id, points: noble.points, cost: clone(noble.cost) })),
      pending: game.pending ? clone(game.pending) : null,
      opponents,
      unknownOpponentReservationsAreUnobserved: true,
    },
    plan,
    recentEvents,
    tacticalAnalysis: boundedTacticalAnalysis(tacticalAnalysis),
    experiences: experienceList,
  };
}
