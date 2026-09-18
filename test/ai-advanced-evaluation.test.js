import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions } from '../src/game.js';
import { CARDS } from '../src/data.js';
import { analyzeAdvancedActions, evaluateCardTactics } from '../src/ai-advanced-evaluation.js';

const players = () => [{ id: 'p1' }, { id: 'p2' }];
const emptyGems = () => ({ white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 });
const card = id => CARDS.find(value => value.id === id);
const scorer = { id: 'public-three-point', level: 2, points: 3, bonus: 'blue', cost: { white: 0, blue: 0, green: 0, red: 0, black: 3 } };
const gameWithOpenMarket = (options = {}) => {
  const game = createGame(players(), options);
  game.market = { 1: [card('white-L1-01')], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game.nobles = [];
  return game;
};

test('card tactics report discounts, gold payment, remaining deficit and bank access', () => {
  const game = gameWithOpenMarket();
  const player = game.players[0];
  player.bonuses = { white: 1, blue: 0, green: 0, red: 0, black: 0 };
  player.gems = { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 1 };
  game.bank.blue = 0;
  const tactic = evaluateCardTactics(game, player, {
    id: 'cost-card', level: 2, points: 1, bonus: 'blue',
    cost: { white: 2, blue: 2, green: 0, red: 0, black: 0 },
  });
  assert.deepEqual(tactic.discountedCost, { white: 1, blue: 2, green: 0, red: 0, black: 0 });
  assert.equal(tactic.goldUse, 1);
  assert.deepEqual(tactic.remainingDeficit, { white: 0, blue: 1, green: 0, red: 0, black: 0 });
  assert.equal(tactic.bankCanSupply, false);
  assert.equal(tactic.reachable, false);
  assert.equal(tactic.expectedActions, null);
});

test('exact taking estimate respects separate same-color pairs and color diversity', () => {
  const game = gameWithOpenMarket();
  game.bank.white = 6;
  game.bank.blue = 6;
  const player = { bonuses: emptyGems(), gems: emptyGems() };
  const tactic = evaluateCardTactics(game, player, {
    id: 'two-color-demand', level: 3, points: 0, bonus: 'green',
    cost: { white: 6, blue: 6, green: 0, red: 0, black: 0 },
  });
  assert.equal(tactic.expectedActions, 6);
  assert.equal(tactic.reachable, true);
});

test('unavailable bank supply is reported as an unreachable card target', () => {
  const game = gameWithOpenMarket();
  game.bank.white = 0;
  const player = { bonuses: emptyGems(), gems: emptyGems() };
  const tactic = evaluateCardTactics(game, player, {
    id: 'unreachable', level: 1, points: 0, bonus: 'green',
    cost: { white: 1, blue: 0, green: 0, red: 0, black: 0 },
  });
  assert.equal(tactic.reachable, false);
  assert.equal(tactic.expectedActions, null);
});

test('one step candidate evaluation uses original action references and leaves input untouched', () => {
  const game = gameWithOpenMarket();
  const actions = legalActions(game, 'p1');
  const beforeGame = structuredClone(game);
  const beforeActions = structuredClone(actions);
  const result = analyzeAdvancedActions(game, 'p1', actions, { seed: 23, maxNodes: 64, maxTimeMs: 30 });
  assert.equal(actions[result.actionIndex], result.action);
  assert.deepEqual(game, beforeGame);
  assert.deepEqual(actions, beforeActions);
  assert.equal(result.candidates.length, actions.length);
});

test('custom finish score and automatic noble points are included in exact one-step facts', () => {
  const game = gameWithOpenMarket({ finishScore: 8, turnOrder: ['p1', 'p2'] });
  game.players[0].score = 5;
  game.players[0].gems = { white: 0, blue: 0, green: 0, red: 0, black: 3, gold: 0 };
  game.market[1] = [card('blue-L1-01')];
  game.players[0].bonuses = emptyGems();
  game.nobles = [{ id: 'n-blue', points: 3, cost: { white: 0, blue: 1, green: 0, red: 0, black: 0 } }];
  const actions = legalActions(game, 'p1');
  const index = actions.findIndex(action => action.type === 'buy' && action.cardId === 'blue-L1-01');
  assert.notEqual(index, -1);
  const result = analyzeAdvancedActions(game, 'p1', actions);
  const facts = result.candidates[index].facts;
  assert.equal(facts.scoreAfter, 8);
  assert.deepEqual(facts.noblesAwarded, ['n-blue']);
  assert.deepEqual(facts.cardTactics.nobleEligibility.eligibleAfterBuy, ['n-blue']);
  assert.equal(facts.cardTactics.nobleEligibility.maxPointsAfterBuy, 3);
  assert.equal(facts.reachesFinishScore, true);
  assert.equal(facts.finalRoundStarted, true);
});

test('opponent finish threats distinguish taking the lead from a determined win', () => {
  const game = gameWithOpenMarket({ finishScore: 8, turnOrder: ['p2', 'p1'] });
  game.turn = 0;
  game.players[1].score = 5;
  game.players[1].gems = { white: 0, blue: 0, green: 0, red: 0, black: 3, gold: 0 };
  game.market[2] = [scorer];
  const result = analyzeAdvancedActions(game, 'p1', legalActions(game, 'p1'));
  const threat = result.opponentThreats.find(value => value.actorId === 'p2' && value.cardId === 'public-three-point');
  assert.equal(threat.reachesFinishScore, true);
  assert.equal(threat.leadsAfterAction, true);
  assert.equal(threat.wouldWinIfGameEnded, true);
  assert.equal(threat.determinedWinner, false);
  assert.equal(threat.endsGameNow, false);
});

test('threat analysis includes only an observed opponent reserved card', () => {
  const game = gameWithOpenMarket({ finishScore: 8 });
  game.players[1].score = 5;
  game.players[1].gems = { white: 0, blue: 0, green: 0, red: 0, black: 3, gold: 0 };
  game.players[1].reserved = [{ id: 'known-reserved', level: 2, points: 3, bonus: 'blue', cost: { white: 0, blue: 0, green: 0, red: 0, black: 3 } }];
  const observation = { observedReserved: { p2: [{ cardId: 'known-reserved', level: 2, points: 3, bonus: 'blue', cost: { white: 0, blue: 0, green: 0, red: 0, black: 3 } }] } };
  const result = analyzeAdvancedActions(game, 'p1', legalActions(game, 'p1'), { observation });
  const threat = result.opponentThreats.find(value => value.actorId === 'p2' && value.cardId === 'known-reserved');
  assert.equal(threat.source, 'reserved');
  assert.equal(threat.reachesFinishScore, true);
});

test('final-round tie is resolved by fewer cards under the configured turn order', () => {
  const game = gameWithOpenMarket({ finishScore: 10, turnOrder: ['p1', 'p2'] });
  game.turn = 0;
  game.finalRound = 0;
  game.players[0].score = 10;
  game.players[0].cards = [1, 2, 3].map((_, i) => ({ id: `p1-${i}`, level: 1, bonus: 'white', points: 0, cost: emptyGems() }));
  game.players[1].score = 7;
  game.players[1].gems = { white: 0, blue: 0, green: 0, red: 0, black: 3, gold: 0 };
  game.market[2] = [scorer];
  const result = analyzeAdvancedActions(game, 'p1', legalActions(game, 'p1'));
  const threat = result.opponentThreats.find(value => value.actorId === 'p2' && value.cardId === 'public-three-point');
  assert.equal(threat.endsGameNow, true);
  assert.equal(threat.determinedWinner, true);
  assert.equal(threat.wouldWinIfGameEnded, true);
});

test('discard candidate facts quantify the value of the returned token', () => {
  const game = gameWithOpenMarket();
  game.pending = { type: 'discard', count: 1 };
  game.players[0].gems = { white: 1, blue: 0, green: 0, red: 0, black: 1, gold: 0 };
  game.market[1] = [{ ...card('white-L1-01'), cost: { white: 2, blue: 0, green: 0, red: 0, black: 0 } }];
  const actions = legalActions(game, 'p1');
  const result = analyzeAdvancedActions(game, 'p1', actions);
  const discardWhite = result.candidates.find(item => item.action.gems.white === 1).facts;
  const discardBlack = result.candidates.find(item => item.action.gems.black === 1).facts;
  assert.ok(discardWhite.discardOpportunityCost > discardBlack.discardOpportunityCost);
});

test('a pending noble choice is resolved through the supplied legal noble actions', () => {
  const game = gameWithOpenMarket();
  game.market = { 1: [], 2: [], 3: [] };
  game.bank = emptyGems();
  game.players[0].bonuses = { white: 3, blue: 3, green: 3, red: 3, black: 3 };
  game.nobles = [
    { id: 'n-a', points: 3, cost: { white: 3, blue: 3, green: 0, red: 0, black: 0 } },
    { id: 'n-b', points: 3, cost: { white: 0, blue: 0, green: 3, red: 3, black: 0 } },
  ];
  const actions = legalActions(game, 'p1');
  assert.deepEqual(actions, [{ type: 'pass' }]);
  const result = analyzeAdvancedActions(game, 'p1', actions);
  assert.deepEqual(result.candidates[0].facts.noblesAwarded, ['n-a']);
  assert.equal(result.candidates[0].facts.scoreGain, 3);
});

test('evaluation ignores hidden opponent reserve identities and deck order with a fixed seed', () => {
  const first = gameWithOpenMarket();
  const second = structuredClone(first);
  first.players[1].reserved = [{ id: 'private-first', level: 2, points: 9, bonus: 'red', cost: { white: 9 } }];
  second.players[1].reserved = [{ id: 'private-second', level: 2, points: 0, bonus: 'blue', cost: { black: 1 } }];
  first.decks = { 1: [...cardDeck(first, 1)].reverse(), 2: cardDeck(first, 2), 3: cardDeck(first, 3) };
  second.decks = { 1: [...cardDeck(second, 1)].reverse(), 2: [...cardDeck(second, 2)].reverse(), 3: cardDeck(second, 3) };
  const actions = legalActions(first, 'p1');
  assert.deepEqual(analyzeAdvancedActions(first, 'p1', actions, { seed: 71 }), analyzeAdvancedActions(second, 'p1', actions, { seed: 71 }));
});

function cardDeck(game, level) {
  return game.decks[level];
}
