import { localAction } from './ai.js';

const COLORS = ['white', 'blue', 'green', 'red', 'black'];

// A deliberately limited practice opponent: no target card, opponent model or search.
export function beginnerAction(game, playerId, actions) {
  if (!actions.length) throw new Error('没有可用动作');
  if (game.pending) return localAction(game, playerId, actions);

  const player = game.players.find(candidate => candidate.id === playerId);
  const gems = player.gems;
  const total = Object.values(gems).reduce((sum, count) => sum + count, 0);
  const cards = [...Object.values(game.market).flat(), ...player.reserved];
  const cost = card => COLORS.reduce((sum, color) => sum + (card.cost[color] || 0), 0);
  const buy = actions.filter(action => action.type === 'buy').sort((a, b) => {
    const first = cards.find(card => card.id === a.cardId);
    const second = cards.find(card => card.id === b.cardId);
    return first.level - second.level || cost(first) - cost(second) || first.points - second.points;
  })[0];
  if (buy && total >= 5) return buy;

  const take = actions.filter(action => action.type === 'take').sort((a, b) => {
    const value = action => Object.entries(action.gems).reduce((sum, [color, count]) => sum + count * (3 - (gems[color] || 0)), 0);
    return value(b) - value(a);
  })[0];
  if (take && total < 10) return take;
  if (buy) return buy;

  // At the token limit, reserve a cheap visible card for a gold token.
  const reserve = actions.filter(action => action.type === 'reserve' && action.cardId).sort((a, b) => {
    const first = cards.find(card => card.id === a.cardId);
    const second = cards.find(card => card.id === b.cardId);
    return first.level - second.level || cost(first) - cost(second);
  })[0];
  return reserve || take || actions[0];
}
