import { COLORS, GOLD } from './data.js';
import { applyAction, legalActions, paymentFor } from './game.js';

const LEVELS = [1, 2, 3];
const clone = value => structuredClone(value);
const zeroGems = () => Object.fromEntries([...COLORS, GOLD].map(color => [color, 0]));
const total = values => Object.values(values || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
const sumColors = values => COLORS.reduce((sum, color) => sum + (Number(values?.[color]) || 0), 0);
const cardById = (game, id, player) => Object.values(game.market || {}).flat().find(card => card.id === id)
  || player?.reserved?.find(card => card.id === id);
const playerById = (game, id) => game.players.find(player => player.id === id);
const finishScore = game => Number.isInteger(game.finishScore) ? game.finishScore : 15;
const takingEstimateCache = new Map();
function cacheTaking(key, value) {
  takingEstimateCache.set(key, value);
  while (takingEstimateCache.size > 5000) takingEstimateCache.delete(takingEstimateCache.keys().next().value);
  return value;
}

function cardDemand(player, card) {
  return Object.fromEntries(COLORS.map(color => [color, Math.max(0, (card.cost?.[color] || 0) - (player.bonuses?.[color] || 0))]));
}

function distanceToCard(player, card, bank = {}) {
  const deficit = cardDemand(player, card);
  for (const color of COLORS) deficit[color] = Math.max(0, deficit[color] - (player.gems?.[color] || 0));
  let wild = player.gems?.[GOLD] || 0;
  while (wild > 0) {
    const color = COLORS.reduce((best, current) => deficit[current] > deficit[best] ? current : best, COLORS[0]);
    if (!deficit[color]) break;
    deficit[color] -= 1;
    wild -= 1;
  }
  return deficit;
}

function exactTakingActions(deficit, bank = {}) {
  const remaining = COLORS.reduce((sum, color) => sum + Math.max(0, deficit[color] || 0), 0);
  if (!remaining) return 0;
  const start = COLORS.map(color => Math.max(0, deficit[color] || 0));
  const supply = COLORS.map(color => Math.max(0, Number(bank[color]) || 0));
  const cacheKey = `${start.join(',')}|${supply.join(',')}`;
  if (takingEstimateCache.has(cacheKey)) return takingEstimateCache.get(cacheKey);
  if (start.some((amount, index) => amount > supply[index])) {
    return cacheTaking(cacheKey, null);
  }
  const keyOf = state => state.join(',');
  const queue = [{ state: start, turns: 0 }];
  const visited = new Set([keyOf(start)]);
  const result = null;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { state, turns } = queue[cursor];
    const active = COLORS.map((_, index) => index).filter(index => state[index] > 0);
    const remainingTotal = state.reduce((sum, amount) => sum + amount, 0);
    const available = active.filter(index => supply[index] - (start[index] - state[index]) > 0);
    const moves = [];
    const addSubsets = (from, chosen) => {
      if (chosen.length > 0) moves.push(chosen);
      if (chosen.length === 3) return;
      for (let position = from; position < available.length; position += 1) addSubsets(position + 1, [...chosen, available[position]]);
    };
    addSubsets(0, []);
    for (const index of active) {
      const bankAfterPreviousTakes = supply[index] - (start[index] - state[index]);
      if (state[index] >= 2 && bankAfterPreviousTakes >= 4) moves.push([index, index]);
    }
    for (const move of moves) {
      const next = [...state];
      let legal = true;
      const counts = new Map();
      for (const index of move) counts.set(index, (counts.get(index) || 0) + 1);
      for (const [index, amount] of counts) {
        const currentBank = supply[index] - (start[index] - state[index]);
        if (amount === 2 ? currentBank < 4 : currentBank < amount) { legal = false; break; }
        next[index] = Math.max(0, next[index] - amount);
      }
      if (!legal) continue;
      if (next.every(amount => amount === 0)) {
        const turnsNeeded = turns + 1;
        return cacheTaking(cacheKey, turnsNeeded);
      }
      if (next.reduce((sum, amount) => sum + amount, 0) >= remainingTotal) continue;
      const nextKey = keyOf(next);
      if (!visited.has(nextKey)) {
        visited.add(nextKey);
        queue.push({ state: next, turns: turns + 1 });
      }
    }
  }
  return cacheTaking(cacheKey, result);
}

function currentDiscountMarginal(game, player, card) {
  const visible = [...Object.values(game.market || {}).flat(), ...(player.reserved || [])];
  const color = card.bonus;
  const affected = visible.filter(target => target.id !== card.id && (target.cost?.[color] || 0) > (player.bonuses?.[color] || 0));
  return { color, cardsAffected: affected.length, cardIds: affected.slice(0, 12).map(target => target.id) };
}

/** Pure public-information estimate for the work remaining before buying a card. */
export function evaluateCardTactics(game, playerOrId, card, { payment } = {}) {
  const player = typeof playerOrId === 'string' ? playerById(game, playerOrId) : playerOrId;
  if (!player || !card?.cost) throw new Error('player and card are required');
  const discountedCost = Object.fromEntries(COLORS.map(color => [color, Math.max(0, (card.cost[color] || 0) - (player.bonuses?.[color] || 0))]));
  const colorPaid = payment ? Object.fromEntries(COLORS.map(color => [color, Number(payment[color]) || 0]))
    : Object.fromEntries(COLORS.map(color => [color, Math.min(discountedCost[color], player.gems?.[color] || 0)]));
  const remainingDeficit = Object.fromEntries(COLORS.map(color => [color, Math.max(0, discountedCost[color] - colorPaid[color])]));
  const dueGold = Object.values(remainingDeficit).reduce((sum, value) => sum + value, 0);
  const goldUse = payment ? (Number(payment[GOLD]) || 0) : Math.min(player.gems?.[GOLD] || 0, dueGold);
  if (!payment) {
    let wild = goldUse;
    while (wild > 0) {
      const color = COLORS.reduce((best, current) => remainingDeficit[current] > remainingDeficit[best] ? current : best, COLORS[0]);
      if (!remainingDeficit[color]) break;
      remainingDeficit[color] -= 1;
      wild -= 1;
    }
  } else {
    let wild = goldUse;
    for (const color of COLORS) {
      const used = Math.min(wild, remainingDeficit[color]);
      remainingDeficit[color] -= used;
      wild -= used;
    }
  }
  const availableBank = game.bank || {};
  const bankCanSupply = COLORS.every(color => remainingDeficit[color] <= (availableBank[color] || 0));
  const expectedActions = exactTakingActions(remainingDeficit, availableBank);
  const demand = currentDiscountMarginal(game, player, card);
  const bonusesAfterBuy = { ...player.bonuses, [card.bonus]: (player.bonuses?.[card.bonus] || 0) + 1 };
  const eligibleAfterBuy = (game.nobles || []).filter(noble => COLORS.every(color => bonusesAfterBuy[color] >= noble.cost[color]));
  return {
    cardId: card.id,
    level: card.level,
    points: card.points,
    discountedCost,
    colorPaid,
    goldUse,
    remainingDeficit,
    reachable: expectedActions !== null,
    bankCanSupply,
    expectedActions,
    discountMarginal: demand,
    nobleEligibility: {
      eligibleAfterBuy: eligibleAfterBuy.map(noble => noble.id),
      maxPointsAfterBuy: Math.max(0, ...eligibleAfterBuy.map(noble => noble.points || 0)),
    },
  };
}

function unknownCard(id, level) {
  return { id, level, points: 0, bonus: COLORS[0], cost: zeroGems(), unknown: true };
}

function countsOnlyDecks(decks) {
  return Object.fromEntries(LEVELS.map(level => {
    const source = decks?.[level];
    const count = Array.isArray(source) ? source.length : Math.max(0, Number(source) || 0);
    return [level, Array.from({ length: count }, (_, index) => unknownCard(`__unknown_deck_${level}_${index}`, level))];
  }));
}

function knownReserveCards(observation, playerId) {
  const data = observation?.observedReserved || observation || {};
  const list = data?.[playerId];
  if (!Array.isArray(list)) return [];
  return list.slice(0, 3).filter(item => item && typeof item.cardId === 'string' && item.cost).map(item => ({
    id: item.cardId, level: item.level, points: Number(item.points) || 0,
    bonus: COLORS.includes(item.bonus) ? item.bonus : COLORS[0], cost: clone(item.cost), observed: true,
  }));
}

/** Copy only public state and the acting player's private cards; hidden deck/reserve identities are never copied. */
function publicSimulationGame(game, observerId, observation) {
  const players = game.players.map(player => {
    const common = {
      id: player.id, name: player.id, ai: Boolean(player.ai), score: Number(player.score) || 0,
      gems: clone(player.gems), bonuses: clone(player.bonuses), cards: clone(player.cards),
      nobles: clone(player.nobles || []),
    };
    if (player.id === observerId) common.reserved = clone(player.reserved || []);
    else {
      const known = knownReserveCards(observation, player.id);
      const hiddenCount = Math.max(0, Math.min(3, player.reserved?.length || 0) - known.length);
      common.reserved = [...known, ...Array.from({ length: hiddenCount }, (_, index) => unknownCard(`__unknown_reserved_${player.id}_${index}`, 1))];
    }
    return common;
  });
  return {
    players,
    finishScore: finishScore(game),
    turnOrder: [...(game.turnOrder || game.players.map(player => player.id))],
    bank: clone(game.bank),
    market: Object.fromEntries(LEVELS.map(level => [level, (game.market?.[level] || []).slice(0, 4).map(card => clone(card))])),
    decks: countsOnlyDecks(game.decks),
    nobles: clone(game.nobles || []),
    turn: game.turn,
    round: game.round,
    status: game.status,
    finalRound: game.finalRound ?? null,
    winners: [...(game.winners || [])],
    pending: clone(game.pending || null),
    nobleAwardedThisTurn: Boolean(game.nobleAwardedThisTurn),
    consecutivePasses: Number(game.consecutivePasses) || 0,
    log: [],
  };
}

function reservationUnknown(player) {
  return (player.reserved || []).filter(card => !card.unknown);
}

function stateValue(game, playerId) {
  const self = playerById(game, playerId);
  if (!self) return -Infinity;
  if (game.status === 'finished') {
    if (!game.winners?.includes(playerId)) return -100000;
    return game.winners.length === 1 ? 100000 : 80000;
  }
  const target = finishScore(game);
  const late = Math.max(0.25, Math.min(1, Math.max(...game.players.map(player => player.score)) / target));
  const playerValue = player => {
    const engine = COLORS.reduce((sum, color) => sum + Math.log1p(player.bonuses?.[color] || 0), 0);
    const holdings = Math.min(10, sumColors(player.gems)) * 0.3 + (player.gems?.[GOLD] || 0) * 0.8;
    const visible = [...Object.values(game.market || {}).flat(), ...reservationUnknown(player)].filter(card => !card.unknown);
    const bestOpportunity = visible.reduce((best, card) => {
      const distance = Object.values(distanceToCard(player, card, game.bank)).reduce((a, b) => a + b, 0);
      return Math.max(best, (card.points * 3 + 1 + 0.8 * (player.bonuses?.[card.bonus] === 0)) / (1 + distance));
    }, 0);
    const reserveBurden = reservationUnknown(player).filter(card => !card.unknown)
      .reduce((sum, card) => sum + Math.min(5, Object.values(distanceToCard(player, card, game.bank)).reduce((a, b) => a + b, 0)) * 0.5, 0);
    return player.score * (14 + late * 10) + engine * (2.5 - late) + holdings + bestOpportunity * 2 - reserveBurden;
  };
  const strongestOpponent = Math.max(0, ...game.players.filter(player => player.id !== playerId).map(player => playerValue(player)));
  return playerValue(self) - strongestOpponent * 0.68;
}

function discardCost(game, player, action) {
  const visible = [...Object.values(game.market || {}).flat(), ...reservationUnknown(player).filter(card => !card.unknown)];
  const demand = Object.fromEntries(COLORS.map(color => [color, Math.max(0, ...visible.map(card =>
    Math.max(0, (card.cost?.[color] || 0) - (player.bonuses?.[color] || 0) - (player.gems?.[color] || 0))))]));
  return COLORS.reduce((sum, color) => sum + (action.gems?.[color] || 0) * (0.1 + demand[color]), 0)
    + (action.gems?.[GOLD] || 0) * 1.6;
}

function selectPendingAction(game, actorId) {
  const actions = legalActions(game, actorId);
  if (!actions.length) return null;
  if (game.pending?.type === 'noble') return [...actions].sort((a, b) => a.nobleId.localeCompare(b.nobleId))[0];
  const player = playerById(game, actorId);
  return [...actions].sort((a, b) => discardCost(game, player, a) - discardCost(game, player, b))[0];
}

function resolvePending(state, rootId, budget) {
  let next = state;
  const newlyAwarded = [];
  for (let guard = 0; guard < 4 && next.status === 'playing' && next.pending; guard += 1) {
    if (budget.nodes >= budget.maxNodes || performance.now() >= budget.deadline) return { state: next, newlyAwarded, truncated: true };
    const actor = next.players[next.turn].id;
    const action = selectPendingAction(next, actor);
    if (!action) break;
    if (action.type === 'noble') newlyAwarded.push(action.nobleId);
    budget.nodes += 1;
    next = applyAction(next, actor, action);
  }
  return { state: next, newlyAwarded, truncated: false };
}

function currentLeaders(game) {
  const high = Math.max(...game.players.map(player => player.score));
  const leaders = game.players.filter(player => player.score === high);
  const fewest = Math.min(...leaders.map(player => player.cards.length));
  return leaders.filter(player => player.cards.length === fewest).map(player => player.id);
}

function candidateFacts(game, after, playerId, action, { forcedDiscardCost = 0, newlyAwarded = [], eligibleNobleIds = [] } = {}) {
  const playerBefore = playerById(game, playerId);
  const playerAfter = playerById(after, playerId);
  const card = action.cardId ? cardById(game, action.cardId, playerBefore) : null;
  const tactics = card ? evaluateCardTactics(game, playerBefore, card, { payment: action.type === 'buy' ? action.payment : undefined }) : null;
  const leaders = currentLeaders(after);
  const previousNobles = new Set((playerBefore.nobles || []).map(noble => noble.id));
  const awarded = [...new Set([...(playerAfter.nobles || []).filter(noble => !previousNobles.has(noble.id)).map(noble => noble.id), ...newlyAwarded])];
  const thrownAway = action.type === 'discard' ? discardCost(game, playerBefore, action) : forcedDiscardCost;
  const overflow = action.type === 'take'
    ? Math.max(0, total(playerBefore.gems) + total(action.gems) - 10)
    : 0;
  const visible = [...Object.values(after.market || {}).flat(), ...reservationUnknown(playerAfter).filter(item => !item.unknown)];
  const maxUseful = Object.fromEntries(COLORS.map(color => [color, Math.max(0, ...visible.map(target =>
    Math.max(0, (target.cost?.[color] || 0) - (playerAfter.bonuses?.[color] || 0))))]));
  const deadTokens = COLORS.reduce((sum, color) => sum + Math.max(0, (playerAfter.gems?.[color] || 0) - maxUseful[color]), 0);
  const goldUseful = Math.max(0, ...visible.map(target => Object.values(cardDemand(playerAfter, target)).reduce((a, b) => a + b, 0)));
  const deadGold = Math.max(0, (playerAfter.gems?.[GOLD] || 0) - goldUseful);
  const wasFinal = game.finalRound !== null && game.finalRound !== undefined;
  const scoreAfter = Number(playerAfter.score) || 0;
  const winnersIfEnded = currentLeaders(after);
  return {
    actionType: action.type,
    ...(card ? { cardId: card.id, cardTactics: tactics } : {}),
    ...(action.type === 'buy' ? { goldUse: Number(action.payment?.gold) || 0 } : action.type === 'reserve' ? { goldUse: (game.bank.gold || 0) > 0 ? 1 : 0 } : { goldUse: 0 }),
    scoreBefore: Number(playerBefore.score) || 0,
    scoreAfter,
    scoreGain: scoreAfter - (Number(playerBefore.score) || 0),
    noblesAwarded: awarded,
    noblePoints: awarded.reduce((sum, id) => sum + (after.players.flatMap(player => player.nobles || []).find(noble => noble.id === id)?.points || 0), 0),
    nobleEligibility: {
      eligibleAfterAction: [...eligibleNobleIds],
      maxPointsAfterAction: Math.max(0, ...eligibleNobleIds.map(id =>
        game.nobles.find(noble => noble.id === id)?.points || after.players.flatMap(player => player.nobles || []).find(noble => noble.id === id)?.points || 0)),
    },
    reachesFinishScore: scoreAfter >= finishScore(after),
    finalRoundStarted: !wasFinal && after.finalRound !== null && after.finalRound !== undefined,
    leadsAfterAction: scoreAfter > Math.max(0, ...after.players.filter(player => player.id !== playerId).map(player => player.score)),
    wouldWinIfGameEnded: winnersIfEnded.includes(playerId),
    endsGameNow: after.status === 'finished',
    determinedWinner: after.status === 'finished' && (after.winners || []).includes(playerId),
    winnerIds: after.status === 'finished' ? [...(after.winners || [])] : [],
    discountMarginal: tactics?.discountMarginal || null,
    invalidHoarding: { deadColoredTokens: deadTokens, deadGold, handOverflowBeforeDiscard: overflow },
    discardOpportunityCost: thrownAway,
    expectedActions: tactics?.expectedActions ?? (action.type === 'buy' || action.type === 'noble' || action.type === 'discard' ? 0 : null),
    bankCanSupply: tactics?.bankCanSupply ?? null,
  };
}

function cheapFallbackValue(game, playerId, action) {
  const player = playerById(game, playerId);
  if (action.type === 'buy') {
    const card = cardById(game, action.cardId, player);
    return 100 + (card?.points || 0) * 15 - total(action.payment || {}) * 0.25 + (card ? 3 / (1 + (player.bonuses[card.bonus] || 0)) : 0);
  }
  if (action.type === 'noble') return 90;
  if (action.type === 'discard') return -discardCost(game, player, action);
  if (action.type === 'take') return total(action.gems) - Math.max(0, total(player.gems) + total(action.gems) - 10) * 2;
  if (action.type === 'reserve') return action.cardId && cardById(game, action.cardId, player) ? 2 : 0.5;
  return -100;
}

function threatObservedReserved(options) {
  return options.observation || { observedReserved: options.observedReserved || {} };
}

function opponentThreats(game, observerId, observation, budget) {
  const publicCards = Object.values(game.market || {}).flat().map(card => ({ ...card, source: 'market' }));
  const result = [];
  for (const opponent of game.players.filter(player => player.id !== observerId)) {
    const known = knownReserveCards(observation, opponent.id).map(card => ({ ...card, source: 'reserved' }));
    for (const card of [...publicCards, ...known]) {
      let payment;
      try { payment = paymentFor(opponent, card); } catch { continue; }
      if (budget.nodes >= budget.maxNodes || performance.now() >= budget.deadline) { budget.truncated = true; return result; }
      const simulated = publicSimulationGame(game, observerId, observation);
      simulated.turn = simulated.players.findIndex(player => player.id === opponent.id);
      simulated.pending = null;
      simulated.status = 'playing';
      const beforeScore = opponent.score;
      const action = { type: 'buy', cardId: card.id, payment };
      let after = applyAction(simulated, opponent.id, action);
      budget.nodes += 1;
      let newNobles = [];
      let discardCostValue = 0;
      if (after.pending?.type === 'noble') {
        const pending = selectPendingAction(after, opponent.id);
        if (pending?.type === 'noble') newNobles.push(pending.nobleId);
      } else if (after.pending?.type === 'discard') {
        const pending = selectPendingAction(after, opponent.id);
        if (pending) discardCostValue = discardCost(after, playerById(after, opponent.id), pending);
      }
      const pendingResult = resolvePending(after, observerId, budget);
      after = pendingResult.state;
      newNobles = [...new Set([...newNobles, ...pendingResult.newlyAwarded])];
      const afterPlayer = playerById(after, opponent.id);
      const scoreAfter = afterPlayer.score;
      const winnerIdsIfEnded = currentLeaders(after);
      result.push({
        actorId: opponent.id,
        cardId: card.id,
        level: card.level,
        source: card.source,
        beforeScore,
        scoreAfter,
        noblesAwarded: newNobles,
        nobleTriggered: newNobles.length > 0,
        discardOpportunityCost: discardCostValue,
        reachesFinishScore: scoreAfter >= finishScore(game),
        finalRoundStarted: game.finalRound == null && after.finalRound != null,
        leadsAfterAction: scoreAfter > Math.max(0, ...after.players.filter(player => player.id !== opponent.id).map(player => player.score)),
        wouldWinIfGameEnded: winnerIdsIfEnded.includes(opponent.id),
        endsGameNow: after.status === 'finished',
        determinedWinner: after.status === 'finished' && after.winners.includes(opponent.id),
        winnerIds: after.status === 'finished' ? [...after.winners] : [],
      });
    }
  }
  return result;
}

/**
 * Pure one-turn public-information evaluator. Candidates point back to the
 * supplied action entries; hidden deck and opponent reserve identities are
 * replaced by unknown placeholders before every rules-engine transition.
 */
export function analyzeAdvancedActions(game, playerId, actions, {
  seed = 1, maxNodes = 4000, maxTimeMs = 150, observation, observedReserved,
} = {}) {
  if (!Array.isArray(actions) || actions.length === 0) throw new Error('没有可用动作');
  if (game.players[game.turn]?.id !== playerId || game.status !== 'playing') throw new Error('不是可行动的玩家');
  if (!Number.isFinite(maxNodes) || maxNodes < 1 || !Number.isFinite(maxTimeMs) || maxTimeMs < 1) throw new Error('search budgets must be positive');
  const budget = {
    nodes: 0,
    maxNodes: Math.floor(Math.min(50000, maxNodes)),
    deadline: performance.now() + Math.min(5000, maxTimeMs),
  };
  const known = observation || { observedReserved: observedReserved || {} };
  const initial = publicSimulationGame(game, playerId, known);
  const initialValue = stateValue(initial, playerId);
  const candidates = [];
  let bestIndex = 0;
  let bestUtility = -Infinity;
  let truncated = false;
  let completedCandidates = 0;
  let seedState = Number(seed) >>> 0;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    let after = initial;
    let forcedDiscardCost = 0;
    let newlyAwarded = [];
    let eligibleNobleIds = [];
    let simulated = false;
    if (budget.nodes < budget.maxNodes && performance.now() < budget.deadline) {
      try {
        after = applyAction(initial, playerId, action);
        budget.nodes += 1;
        const intermediate = after;
        const beforeNobles = new Set((playerById(initial, playerId).nobles || []).map(noble => noble.id));
        eligibleNobleIds = intermediate.pending?.type === 'noble'
          ? [...intermediate.pending.nobleIds]
          : (playerById(intermediate, playerId).nobles || []).filter(noble => !beforeNobles.has(noble.id)).map(noble => noble.id);
        const pendingAction = intermediate.pending?.type === 'discard' ? selectPendingAction(intermediate, playerId) : null;
        if (pendingAction) forcedDiscardCost = discardCost(intermediate, playerById(intermediate, playerId), pendingAction);
        const pendingResult = resolvePending(after, playerId, budget);
        after = pendingResult.state;
        newlyAwarded = pendingResult.newlyAwarded;
        truncated = truncated || pendingResult.truncated;
        simulated = true;
      } catch {
        after = initial;
      }
    } else truncated = true;
    const facts = candidateFacts(game, after, playerId, action, { forcedDiscardCost, newlyAwarded, eligibleNobleIds });
    const rawValue = simulated ? stateValue(after, playerId) : cheapFallbackValue(game, playerId, action);
    seedState = (Math.imul(1664525, seedState) + 1013904223) >>> 0;
    const utility = rawValue + (simulated ? 0 : initialValue * 0.001) + seedState / 4294967296 * 0.00001;
    candidates.push({ actionIndex: index, action, facts, utility, simulated });
    if (utility > bestUtility) { bestUtility = utility; bestIndex = index; }
    if (simulated) completedCandidates += 1;
  }
  const threats = opponentThreats(game, playerId, known, budget);
  truncated = truncated || Boolean(budget.truncated);
  return {
    actionIndex: bestIndex,
    action: actions[bestIndex],
    candidates,
    opponentThreats: threats,
    budget: { nodes: budget.nodes, maxNodes: budget.maxNodes, completedCandidates, truncated },
  };
}
