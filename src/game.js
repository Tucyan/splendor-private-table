import { CARDS_BY_LEVEL, COLORS, GOLD, NOBLES } from './data.js';

const LEVELS = [1, 2, 3];
const ALL_GEM_TYPES = [...COLORS, GOLD];
const GEM_NAMES = { white: '白', blue: '蓝', green: '绿', red: '红', black: '黑', gold: '金' };

const zeroGems = () => Object.fromEntries(ALL_GEM_TYPES.map((color) => [color, 0]));
const zeroBonuses = () => Object.fromEntries(COLORS.map((color) => [color, 0]));
const copy = (value) => structuredClone(value);
const sum = (values) => Object.values(values).reduce((total, value) => total + (Number(value) || 0), 0);
const gemsText = (gems) => ALL_GEM_TYPES.filter((color) => (gems?.[color] ?? 0) > 0).map((color) => `${GEM_NAMES[color]}色×${gems[color]}`).join('、') || '无';
const cardText = (card) => `${card.level}级${GEM_NAMES[card.bonus]}色奖励、${card.points}分`;

function shuffled(values) {
  const result = values.map(copy);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function checkPlayers(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) throw new Error('需要 2-4 名玩家');
  const seen = new Set();
  return players.map((player, index) => {
    if (!player?.id || seen.has(player.id)) throw new Error('玩家 id 必须唯一');
    seen.add(player.id);
    return {
      id: String(player.id), name: String(player.name ?? player.id), ai: Boolean(player.ai),
      gems: zeroGems(), bonuses: zeroBonuses(), cards: [], reserved: [], nobles: [], score: 0,
    };
  });
}

export function createGame(playerInputs) {
  const players = checkPlayers(playerInputs);
  const decks = Object.fromEntries(LEVELS.map((level) => [level, shuffled(CARDS_BY_LEVEL[level])]));
  const market = Object.fromEntries(LEVELS.map((level) => [level, decks[level].splice(0, 4)]));
  const gemCount = players.length === 2 ? 4 : players.length === 3 ? 5 : 7;
  return {
    players,
    bank: Object.fromEntries([...COLORS.map((color) => [color, gemCount]), [GOLD, 5]]),
    market,
    decks,
    nobles: shuffled(NOBLES).slice(0, players.length + 1),
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

function currentPlayer(game, playerId) {
  const player = game.players[game.turn];
  if (!player || player.id !== playerId) throw new Error('不是该玩家的回合');
  return player;
}

function validGems(gems, { allowGold = true } = {}) {
  if (!gems || typeof gems !== 'object' || Array.isArray(gems)) return false;
  for (const [color, amount] of Object.entries(gems)) {
    if (!ALL_GEM_TYPES.includes(color) || (!allowGold && color === GOLD) || !Number.isInteger(amount) || amount < 0) return false;
  }
  return true;
}

function takeIsLegal(game, gems) {
  if (!validGems(gems, { allowGold: false })) return false;
  const take = Object.fromEntries(COLORS.map((color) => [color, gems[color] ?? 0]));
  const total = sum(take);
  if (total < 1 || total > 3 || COLORS.some((color) => take[color] > 1 && (total !== 2 || take[color] !== 2))) return false;
  if (total === 2 && Math.max(...Object.values(take)) === 2) {
    const color = COLORS.find((candidate) => take[candidate] === 2);
    if (game.bank[color] < 4) return false;
  }
  return COLORS.every((color) => take[color] <= game.bank[color]);
}

function cardInMarket(game, cardId) {
  for (const level of LEVELS) {
    const index = game.market[level].findIndex((card) => card.id === cardId);
    if (index >= 0) return { level, index, card: game.market[level][index], source: 'market' };
  }
  return null;
}

function reservedCard(player, cardId) {
  const index = player.reserved.findIndex((card) => card.id === cardId);
  return index >= 0 ? { index, card: player.reserved[index], source: 'reserved' } : null;
}

function discountFor(player, card) {
  return Object.fromEntries(COLORS.map((color) => [color, Math.max(0, card.cost[color] - player.bonuses[color])]));
}

export function paymentFor(player, card, requestedPayment) {
  const required = discountFor(player, card);
  const payment = zeroGems();
  if (requestedPayment !== undefined) {
    if (!validGems(requestedPayment)) throw new Error('支付格式无效');
    for (const color of ALL_GEM_TYPES) payment[color] = requestedPayment[color] ?? 0;
  } else {
    for (const color of COLORS) payment[color] = Math.min(required[color], player.gems[color]);
    const missing = COLORS.reduce((total, color) => total + required[color] - payment[color], 0);
    payment.gold = missing;
  }
  for (const color of COLORS) {
    if (payment[color] > player.gems[color] || payment[color] > required[color]) throw new Error('宝石不足或支付过多');
  }
  const missing = COLORS.reduce((total, color) => total + required[color] - payment[color], 0);
  if (payment.gold !== missing || payment.gold > player.gems.gold) throw new Error('万能宝石支付不匹配');
  return payment;
}

function canBuy(player, card) {
  try { paymentFor(player, card); return true; } catch { return false; }
}

function eligibleNobles(player, game) {
  return game.nobles.filter((noble) => COLORS.every((color) => player.bonuses[color] >= noble.cost[color]));
}

function addLog(game, playerId, text) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  game.log.push({ playerId, text: `${player?.name ?? playerId}${text}` });
  if (game.log.length > 80) game.log.splice(0, game.log.length - 80);
}

function settleNobleOrDiscard(game, playerId) {
  const player = game.players[game.turn];
  const eligible = game.nobleAwardedThisTurn ? [] : eligibleNobles(player, game);
  if (eligible.length > 1) {
    game.pending = { type: 'noble', nobleIds: eligible.map((noble) => noble.id) };
    return false;
  }
  if (eligible.length === 1) takeNoble(game, playerId, eligible[0].id);
  if (sum(player.gems) > 10) {
    game.pending = { type: 'discard', count: sum(player.gems) - 10 };
    return false;
  }
  return true;
}

function takeNoble(game, playerId, nobleId) {
  const player = game.players[game.turn];
  const index = game.nobles.findIndex((noble) => noble.id === nobleId);
  if (index < 0) throw new Error('贵族不可获得');
  const noble = game.nobles.splice(index, 1)[0];
  player.nobles.push(noble);
  player.score += noble.points;
  game.consecutivePasses = 0;
  game.nobleAwardedThisTurn = true;
  addLog(game, playerId, `获得贵族 ${noble.id}（${noble.points}分）`);
}

function finishTurn(game, playerId) {
  const activeIndex = game.turn;
  if (game.finalRound !== null && activeIndex === game.players.length - 1) {
    finishGame(game);
    return;
  }
  if ((game.consecutivePasses || 0) >= game.players.length) {
    game.endReason = 'stalemate';
    addLog(game, playerId, '：所有玩家连续跳过，本局按当前声望与发展卡数量结算');
    finishGame(game);
    return;
  }
  game.turn = (activeIndex + 1) % game.players.length;
  if (game.turn === 0) game.round += 1;
  game.nobleAwardedThisTurn = false;
  addLog(game, playerId, '回合结束');
}

function finishGame(game) {
  const maxScore = Math.max(...game.players.map((player) => player.score));
  const scoreLeaders = game.players.filter((player) => player.score === maxScore);
  const minCards = Math.min(...scoreLeaders.map((player) => player.cards.length));
  game.winners = scoreLeaders.filter((player) => player.cards.length === minCards).map((player) => player.id);
  game.status = 'finished';
  game.pending = null;
}

export function endGame(game) {
  if (!game || game.status !== 'playing') throw new Error('没有正在进行的对局');
  const next = copy(game);
  next.endReason = 'host';
  addLog(next, next.players[next.turn].id, '：房主结束本局，按当前声望与发展卡数量结算');
  finishGame(next);
  return next;
}

function endAction(game, playerId) {
  const player = game.players[game.turn];
  if (!settleNobleOrDiscard(game, playerId)) {
    if (game.finalRound === null && player.score >= 15) game.finalRound = game.turn;
    return;
  }
  if (game.finalRound === null && player.score >= 15) game.finalRound = game.turn;
  finishTurn(game, playerId);
}

function takeAction(game, playerId, action) {
  const player = currentPlayer(game, playerId);
  if (!takeIsLegal(game, action.gems)) throw new Error('取宝石动作无效');
  for (const color of COLORS) {
    const amount = action.gems[color] ?? 0;
    player.gems[color] += amount;
    game.bank[color] -= amount;
  }
  addLog(game, playerId, `拿取宝石（${gemsText(action.gems)}）`);
  endAction(game, playerId);
}

function buyAction(game, playerId, action) {
  const player = currentPlayer(game, playerId);
  const marketMatch = cardInMarket(game, action.cardId);
  const reservedMatch = reservedCard(player, action.cardId);
  const match = marketMatch ?? reservedMatch;
  if (!match) throw new Error('卡牌不可购买');
  const payment = paymentFor(player, match.card, action.payment);
  for (const color of ALL_GEM_TYPES) {
    player.gems[color] -= payment[color];
    game.bank[color] += payment[color];
  }
  if (match.source === 'market') {
    game.market[match.level].splice(match.index, 1);
    const replacement = game.decks[match.level].pop();
    if (replacement) game.market[match.level].push(replacement);
  } else player.reserved.splice(match.index, 1);
  player.cards.push(match.card);
  player.bonuses[match.card.bonus] += 1;
  player.score += match.card.points;
  addLog(game, playerId, `购买 ${match.card.id}（${cardText(match.card)}）`);
  endAction(game, playerId);
}

function reserveAction(game, playerId, action) {
  const player = currentPlayer(game, playerId);
  if (player.reserved.length >= 3) throw new Error('最多预留 3 张卡');
  let match;
  if (action.cardId) match = cardInMarket(game, action.cardId);
  else if (LEVELS.includes(action.level)) {
    const card = game.decks[action.level].at(-1);
    if (card) match = { level: action.level, card, source: 'deck' };
  }
  if (!match) throw new Error('预留卡牌不可用');
  if (match.source === 'market') {
    game.market[match.level].splice(match.index, 1);
    const replacement = game.decks[match.level].pop();
    if (replacement) game.market[match.level].push(replacement);
  } else game.decks[match.level].pop();
  player.reserved.push(match.card);
  if (game.bank.gold > 0) { game.bank.gold -= 1; player.gems.gold += 1; }
  addLog(game, playerId, `预留发展卡（${cardText(match.card)}）`);
  endAction(game, playerId);
}

function discardAction(game, playerId, action) {
  const player = currentPlayer(game, playerId);
  if (game.pending?.type !== 'discard' || !validGems(action.gems) || sum(action.gems) !== game.pending.count) throw new Error('返还宝石数量无效');
  for (const color of ALL_GEM_TYPES) {
    const amount = action.gems[color] ?? 0;
    if (amount > player.gems[color]) throw new Error('不能返还没有的宝石');
    player.gems[color] -= amount;
    game.bank[color] += amount;
  }
  game.pending = null;
  addLog(game, playerId, `返还宝石（${gemsText(action.gems)}）`);
  if (game.nobleAwardedThisTurn) finishTurn(game, playerId);
  else endAction(game, playerId);
}

function nobleAction(game, playerId, action) {
  const player = currentPlayer(game, playerId);
  if (game.pending?.type !== 'noble' || !game.pending.nobleIds.includes(action.nobleId)) throw new Error('贵族选择无效');
  game.pending = null;
  takeNoble(game, playerId, action.nobleId);
  if (game.finalRound === null && player.score >= 15) game.finalRound = game.turn;
  if (sum(player.gems) > 10) game.pending = { type: 'discard', count: sum(player.gems) - 10 };
  else finishTurn(game, playerId);
}

function hasNormalMoves(game, player) {
  const canTake = COLORS.some((color) => game.bank[color] > 0);
  const canPurchase = LEVELS.some((level) => game.market[level].some((card) => canBuy(player, card))) || player.reserved.some((card) => canBuy(player, card));
  // Private-table rule: when buying and taking are impossible, reserving is
  // optional. A player may explicitly pass rather than be forced to reserve.
  return canTake || canPurchase;
}

function discardChoices(player, count, limit = 56) {
  const result = [];
  const choice = zeroGems();
  const walk = (index, remaining) => {
    if (result.length >= limit) return;
    if (index === ALL_GEM_TYPES.length) {
      if (remaining === 0) result.push(Object.fromEntries(ALL_GEM_TYPES.filter((color) => choice[color] > 0).map((color) => [color, choice[color]])));
      return;
    }
    const color = ALL_GEM_TYPES[index];
    const maximum = Math.min(player.gems[color], remaining);
    for (let amount = 0; amount <= maximum; amount += 1) {
      choice[color] = amount;
      walk(index + 1, remaining - amount);
      if (result.length >= limit) return;
    }
    choice[color] = 0;
  };
  walk(0, count);
  return result;
}

export function legalActions(game, playerId) {
  if (game.status !== 'playing') return [];
  const player = game.players[game.turn];
  if (!player || player.id !== playerId) return [];
  if (game.pending?.type === 'noble') return game.pending.nobleIds.map((nobleId) => ({ type: 'noble', nobleId }));
  if (game.pending?.type === 'discard') {
    return discardChoices(player, game.pending.count).map((gems) => ({ type: 'discard', gems }));
  }
  const actions = [];
  for (const a of [{ white: 1 }, { blue: 1 }, { green: 1 }, { red: 1 }, { black: 1 }, { white: 1, blue: 1 }, { white: 1, green: 1 }, { white: 1, red: 1 }, { white: 1, black: 1 }, { blue: 1, green: 1 }, { blue: 1, red: 1 }, { blue: 1, black: 1 }, { green: 1, red: 1 }, { green: 1, black: 1 }, { red: 1, black: 1 }, { white: 1, blue: 1, green: 1 }, { white: 1, blue: 1, red: 1 }, { white: 1, blue: 1, black: 1 }, { white: 1, green: 1, red: 1 }, { white: 1, green: 1, black: 1 }, { white: 1, red: 1, black: 1 }, { blue: 1, green: 1, red: 1 }, { blue: 1, green: 1, black: 1 }, { blue: 1, red: 1, black: 1 }, { green: 1, red: 1, black: 1 }]) if (takeIsLegal(game, a)) actions.push({ type: 'take', gems: a });
  for (const color of COLORS) if (takeIsLegal(game, { [color]: 2 })) actions.push({ type: 'take', gems: { [color]: 2 } });
  for (const level of LEVELS) for (const card of game.market[level]) if (canBuy(player, card)) actions.push({ type: 'buy', cardId: card.id, payment: paymentFor(player, card) });
  for (const card of player.reserved) if (canBuy(player, card)) actions.push({ type: 'buy', cardId: card.id, payment: paymentFor(player, card) });
  if (player.reserved.length < 3) {
    for (const level of LEVELS) for (const card of game.market[level]) actions.push({ type: 'reserve', cardId: card.id });
    for (const level of LEVELS) if (game.decks[level].length) actions.push({ type: 'reserve', level });
  }
  if (!hasNormalMoves(game, player)) actions.push({ type: 'pass' });
  return actions;
}

export function applyAction(game, playerId, action) {
  if (!game || game.status !== 'playing') throw new Error('对局已结束');
  if (!action || typeof action.type !== 'string') throw new Error('动作无效');
  const next = copy(game);
  const player = currentPlayer(next, playerId);
  if (next.pending) {
    if (next.pending.type === 'discard') {
      if (action.type !== 'discard') throw new Error('请先返还宝石');
      discardAction(next, playerId, action);
    } else {
      if (action.type !== 'noble') throw new Error('请先选择贵族');
      nobleAction(next, playerId, action);
    }
    return next;
  }
  if (action.type !== 'pass') next.consecutivePasses = 0;
  if (action.type === 'take') takeAction(next, playerId, action);
  else if (action.type === 'buy') buyAction(next, playerId, action);
  else if (action.type === 'reserve') reserveAction(next, playerId, action);
  else if (action.type === 'pass') {
    if (hasNormalMoves(next, player)) throw new Error('仍可拿取宝石或购买卡牌，不能跳过');
    next.consecutivePasses = (next.consecutivePasses || 0) + 1;
    addLog(next, playerId, '跳过回合');
    endAction(next, playerId);
  } else throw new Error('未知动作');
  return next;
}

export function viewGame(game, playerId) {
  const view = copy(game);
  delete view.nobleAwardedThisTurn;
  view.decks = Object.fromEntries(LEVELS.map((level) => [level, game.decks[level].length]));
  view.players = view.players.map((player) => {
    if (player.id !== playerId) player.reserved = player.reserved.map((card) => ({ id: 'hidden', level: card.level }));
    return player;
  });
  return view;
}
