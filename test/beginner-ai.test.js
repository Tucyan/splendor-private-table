import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalActions, applyAction } from '../src/game.js';
import { beginnerAction } from '../src/beginner-ai.js';

const card = (id, level, points, cost = {}) => ({
  id, level, points, bonus: 'white',
  cost: { white: 0, blue: 0, green: 0, red: 0, black: 0, ...cost },
});

function fixture() {
  const game = createGame([{ id: 'human' }, { id: 'bot' }]);
  game.turn = 1;
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game.nobles = [];
  return game;
}

test('beginner gathers gems before buying and ignores card targets when choosing colors', () => {
  const game = fixture();
  game.market[1] = [card('free', 1, 0), card('target', 1, 1, { red: 3 })];
  const actions = legalActions(game, 'bot');
  const before = structuredClone(game);
  const action = beginnerAction(game, 'bot', actions);
  assert.ok(actions.includes(action));
  assert.equal(action.type, 'take');
  assert.equal(Object.values(action.gems).reduce((sum, count) => sum + count, 0), 3);
  assert.deepEqual(game, before);
  assert.doesNotThrow(() => applyAction(game, 'bot', action));
});

test('beginner buys a low-level affordable card instead of a winning high-level card', () => {
  const game = fixture();
  game.players[1].gems = { white: 1, blue: 1, green: 1, red: 1, black: 1, gold: 0 };
  game.market[1] = [card('cheap', 1, 0, { white: 1 })];
  game.market[3] = [card('winner', 3, 5, { blue: 1 })];
  const action = beginnerAction(game, 'bot', legalActions(game, 'bot'));
  assert.equal(action.type, 'buy');
  assert.equal(action.cardId, 'cheap');
});

test('beginner reserves the cheaper low-level card when its hand is full', () => {
  const game = fixture();
  game.players[1].gems = { white: 2, blue: 2, green: 2, red: 2, black: 2, gold: 0 };
  game.market[1] = [card('expensive', 1, 0, { red: 9 }), card('cheap', 1, 0, { black: 4 })];
  const action = beginnerAction(game, 'bot', legalActions(game, 'bot'));
  assert.equal(action.type, 'reserve');
  assert.equal(action.cardId, 'cheap');
});

test('beginner settles required choices and accepts an exhausted-board pass', () => {
  const game = fixture();
  game.players[1].gems = { white: 2, blue: 2, green: 2, red: 2, black: 2, gold: 1 };
  game.pending = { type: 'discard', count: 1 };
  let actions = legalActions(game, 'bot');
  assert.ok(actions.includes(beginnerAction(game, 'bot', actions)));
  game.pending = { type: 'noble', nobleIds: ['first'] };
  actions = legalActions(game, 'bot');
  assert.equal(beginnerAction(game, 'bot', actions), actions[0]);
  game.pending = null;
  for (const color of Object.keys(game.bank)) game.bank[color] = 0;
  actions = legalActions(game, 'bot');
  assert.equal(beginnerAction(game, 'bot', actions).type, 'pass');
});

test('beginner rejects an empty action list', () => {
  assert.throws(() => beginnerAction(fixture(), 'bot', []), /没有可用动作/);
});
