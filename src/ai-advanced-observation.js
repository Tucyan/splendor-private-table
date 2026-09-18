const clone = value => structuredClone(value);
const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const gemTotal = gems => Object.values(gems || {}).reduce((total, count) => total + (Number(count) || 0), 0);
const playerById = (game, id) => game?.players?.find(player => player.id === id);
const marketCard = (game, id) => Object.values(game?.market || {}).flat().find(card => card.id === id);
const knownCard = (reserved, id) => reserved.find(card => card.cardId === id);

function ensureBucket(root, gameId, observerId) {
  if (!root.has(gameId)) root.set(gameId, new Map());
  const observers = root.get(gameId);
  if (!observers.has(observerId)) observers.set(observerId, { events: [], observedReserved: {} });
  return observers.get(observerId);
}

function visibleEvent({ before, after, observerId, actorId, action, bucket }) {
  const actorBefore = playerById(before, actorId);
  const actorAfter = playerById(after, actorId);
  const publicMarket = action.cardId ? marketCard(before, action.cardId) : null;
  const remembered = action.cardId ? knownCard(bucket.observedReserved[actorId] || [], action.cardId) : null;
  const ownPrivate = observerId === actorId && action.cardId
    ? actorBefore?.reserved?.find(card => card.id === action.cardId)
    : null;
  const known = publicMarket || remembered || ownPrivate;
  const event = {
    type: action.type,
    actorId,
    round: Number.isFinite(before.round) ? before.round : null,
    actorSeat: (before.turnOrder || before.players.map(player => player.id)).indexOf(actorId),
    scoreBefore: Number(actorBefore?.score) || 0,
    scoreAfter: Number(actorAfter?.score) || 0,
    cardsBefore: actorBefore?.cards?.length || 0,
    cardsAfter: actorAfter?.cards?.length || 0,
    gemsBefore: gemTotal(actorBefore?.gems),
    gemsAfter: gemTotal(actorAfter?.gems),
    finalRound: after.finalRound ?? null,
    statusAfter: after.status,
  };
  if (action.type === 'take' || action.type === 'discard') {
    event.gems = Object.fromEntries(COLORS.filter(color => (action.gems?.[color] || 0) > 0).map(color => [color, action.gems[color]]));
    if ((action.gems?.gold || 0) > 0) event.gems.gold = action.gems.gold;
  }
  if (action.type === 'reserve') {
    if (action.cardId && publicMarket) {
      event.visibility = 'public';
      event.cardId = publicMarket.id;
      event.level = publicMarket.level;
      event.card = { points: publicMarket.points, bonus: publicMarket.bonus, cost: clone(publicMarket.cost) };
    } else {
      event.visibility = 'blind';
      event.level = Number.isInteger(action.level) ? action.level : ownPrivate?.level ?? actorBefore?.reserved?.find(card => card.id === action.cardId)?.level ?? remembered?.level ?? null;
    }
  } else if (known) {
    event.cardId = known.id ?? known.cardId;
    event.level = known.level;
  } else if (action.type === 'buy' && observerId === actorId && ownPrivate) {
    event.cardId = ownPrivate.id;
    event.level = ownPrivate.level;
  }
  if (after.status === 'finished') {
    event.terminal = true;
    event.winnerIds = [...(after.winners || [])];
    event.endReason = typeof after.endReason === 'string' ? after.endReason.slice(0, 40) : null;
  }
  return event;
}

/**
 * In-memory, per-game/per-observer record of facts that followed from a public
 * action. It deliberately stores no game snapshots or game log entries.
 */
export class AdvancedObservationMemory {
  #records = new Map();
  #maxEvents = 12;

  constructor({ maxEvents = 12 } = {}) {
    this.#maxEvents = Math.max(1, Math.min(12, Math.floor(Number(maxEvents) || 12)));
  }

  get maxEvents() { return this.#maxEvents; }

  record({ gameId, observerId, before, after, actorId, action } = {}) {
    if (!gameId || !observerId || !actorId || !before || !after || !action || typeof action.type !== 'string') {
      throw new Error('record requires gameId, observerId, before, after, actorId and action');
    }
    const bucket = ensureBucket(this.#records, String(gameId), String(observerId));
    bucket.observedReserved[actorId] ||= [];
    if (action.type === 'reserve' && action.cardId && observerId !== actorId) {
      const card = marketCard(before, action.cardId);
      if (card) {
        const known = bucket.observedReserved[actorId] || (bucket.observedReserved[actorId] = []);
        if (!known.some(item => item.cardId === card.id)) {
          known.push({ cardId: card.id, level: card.level, points: card.points, bonus: card.bonus, cost: clone(card.cost) });
        }
      }
    }
    const event = visibleEvent({ before, after, observerId, actorId, action, bucket });
    if (action.type === 'buy' && event.cardId && bucket.observedReserved[actorId]) {
      bucket.observedReserved[actorId] = bucket.observedReserved[actorId].filter(item => item.cardId !== event.cardId);
    }
    bucket.events.push(event);
    if (bucket.events.length > this.#maxEvents) {
      const terminal = bucket.events.filter(item => item.terminal).at(-1);
      const limit = terminal ? this.#maxEvents - 1 : this.#maxEvents;
      const available = bucket.events.filter(item => !item.terminal);
      const recent = limit > 0 ? available.slice(-limit) : [];
      bucket.events = terminal ? [...recent, terminal] : recent;
    }
    return this.get(gameId, observerId);
  }

  get(gameId, observerId) {
    const value = this.#records.get(String(gameId))?.get(String(observerId));
    return value ? clone(value) : { events: [], observedReserved: {} };
  }

  has(gameId, observerId) {
    return this.#records.get(String(gameId))?.has(String(observerId)) || false;
  }

  get size() {
    return [...this.#records.values()].reduce((count, observers) => count + observers.size, 0);
  }

  clear(gameId, observerId) {
    if (observerId !== undefined) {
      const observers = this.#records.get(String(gameId));
      observers?.delete(String(observerId));
      if (observers?.size === 0) this.#records.delete(String(gameId));
      return;
    }
    this.#records.delete(String(gameId));
  }
}
