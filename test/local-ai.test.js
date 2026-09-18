import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from '../src/local-ai.js';
import { createGame, legalActions, applyAction } from '../src/game.js';
import { COLORS, CARDS_BY_LEVEL } from '../src/data.js';

const options = difficulty => ({ difficulty, seed: 42, maxNodes: 12000, maxTimeMs: 5000 });
const card = (id, points, cost = {}, bonus = 'white', level = 1) => ({
  id, points, level, bonus, cost: Object.fromEntries(COLORS.map(c => [c, cost[c] || 0])),
});
function fixture(count = 2) {
  const g = createGame(Array.from({ length: count }, (_, i) => ({ id: `p${i}` })));
  g.market = { 1: [], 2: [], 3: [] }; g.decks = { 1: [], 2: [], 3: [] }; g.nobles = [];
  return g;
}
const choose = (g, difficulty, actions = legalActions(g, g.players[g.turn].id)) =>
  ai.chooseLocalDifficultyAction(g, g.players[g.turn].id, actions, options(difficulty));

test('exports a separate opt-in algorithm without changing existing AI entry points', () => {
  assert.equal(typeof ai.chooseLocalDifficultyAction, 'function');
  assert.equal(typeof ai.analyzeLocalDifficulty, 'function');
});

for (const difficulty of ['normal', 'hard', 'hell']) {
  test(`${difficulty}: takes a winning move at a custom finish score and respects seat order`, () => {
    const g = fixture(); g.finishScore = 5; g.turnOrder = ['p1', 'p0'];
    g.players[0].score = 4; g.players[1].score = 4;
    g.market[1] = [card('engine', 0), card('win', 1)];
    const a = choose(g, difficulty);
    assert.equal(a.cardId, 'win');
    assert.deepEqual(applyAction(g, 'p0', a).winners, ['p0']);
  });
  test(`${difficulty}: returns an original legal action without mutating the game`, () => {
    const g = createGame([{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }]);
    const before = structuredClone(g), actions = legalActions(g, 'p0');
    const a = choose(g, difficulty, actions);
    assert.ok(actions.includes(a)); assert.doesNotThrow(() => applyAction(g, 'p0', a));
    assert.deepEqual(g, before);
  });
  test(`${difficulty}: settles discards, noble choices and exhausted-board passes`, () => {
    const g = fixture(); g.players[0].gems = { white: 2, blue: 2, green: 2, red: 2, black: 2, gold: 1 };
    g.pending = { type: 'discard', count: 1 };
    assert.equal(choose(g, difficulty).gems.gold || 0, 0);
    g.pending = { type: 'noble', nobleIds: ['a', 'b'] };
    g.nobles = [{ id: 'a', points: 3, cost: Object.fromEntries(COLORS.map(c => [c, 0])) },
      { id: 'b', points: 4, cost: Object.fromEntries(COLORS.map(c => [c, 0])) }];
    assert.equal(choose(g, difficulty).nobleId, 'b');
    const blocked = fixture(); for (const c in blocked.bank) blocked.bank[c] = 0;
    assert.equal(choose(blocked, difficulty).type, 'pass');
  });
}
test('normal values a noble-completing discount over an unrelated free card', () => {
  const g = fixture(); g.players[0].bonuses.white = 2;
  g.nobles = [{ id: 'n', points: 3, cost: { white: 3, blue: 0, green: 0, red: 0, black: 0 } }];
  g.market[1] = [card('unrelated', 0, {}, 'blue'), card('noble', 0)];
  assert.equal(choose(g, 'normal').cardId, 'noble');
});

test('normal can save resources for points instead of buying any affordable engine card', () => {
  const g = fixture(); g.players[0].bonuses.white = 6;
  g.market[1] = [card('redundant', 0), card('valuable', 5, { blue: 2 }, 'red')];
  const a = choose(g, 'normal');
  assert.equal(a.type, 'take'); assert.equal(a.gems.blue, 2);
});

for (const difficulty of ['normal', 'hard']) {
  test(`${difficulty}: decisions cannot depend on real hidden identities or deck order`, () => {
    const g = createGame([{ id: 'p0' }, { id: 'p1' }]);
    g.players[1].reserved.push(g.decks[1].pop());
    const changed = structuredClone(g);
    const replacement = changed.decks[1].pop();
    changed.decks[1].push(changed.players[1].reserved[0]);
    changed.players[1].reserved[0] = replacement;
    for (const deck of Object.values(changed.decks)) deck.reverse();
    assert.deepEqual(choose(g, difficulty), choose(changed, difficulty));
  });
}

test('hell knows the next blind draw comes from the end of each deck', () => {
  const g = fixture();
  const bad = card('bad', 0, { white: 9 }), good = card('good', 5);
  g.decks[1] = [bad, good]; g.decks[2] = [good, bad];
  const actions = [{ type: 'reserve', level: 1 }, { type: 'reserve', level: 2 }];
  assert.equal(choose(g, 'hell', actions).level, 1);
  g.decks[1].reverse(); g.decks[2].reverse();
  assert.equal(choose(g, 'hell', actions).level, 2);
});

test('hard and hell deny an opponent an immediate game-winning purchase', () => {
  for (const difficulty of ['hard', 'hell']) {
    const g = fixture(); g.finishScore = 5; g.players[1].score = 4; g.players[1].gems.blue = 2;
    g.players[0].gems.red = 2;
    g.market[1] = [card('tempting', 1, { red: 2 }), card('threat', 1, { blue: 2 })];
    const a = choose(g, difficulty);
    assert.equal(a.type, 'reserve'); assert.equal(a.cardId, 'threat');
  }
});

test('search respects a tiny node budget and reports truncated work', () => {
  const g = fixture(); g.market[1] = [card('a', 1)];
  const actions = legalActions(g, 'p0');
  const result = ai.analyzeLocalDifficulty(g, 'p0', actions, { ...options('hard'), maxNodes: 1 });
  assert.ok(actions.includes(result.action)); assert.ok(result.nodes <= 1); assert.equal(result.truncated, true);
});

test('invalid difficulty and empty actions are rejected explicitly', () => {
  const g = fixture();
  assert.throws(() => choose(g, 'invalid'), /difficulty|难度/);
  assert.throws(() => choose(g, 'normal', []), /动作/);
});

test('hard completes a rollout pass within 1200 transitions on a four-player opening', () => {
  const g = fixture(4);
  // Fixed public market, full hidden decks; independent of random createGame.
  for (const level of [1, 2, 3]) {
    g.market[level] = structuredClone(CARDS_BY_LEVEL[level].slice(0, 4));
    g.decks[level] = structuredClone(CARDS_BY_LEVEL[level].slice(4));
  }
  const result = ai.analyzeLocalDifficulty(g, 'p0', legalActions(g, 'p0'), {
    ...options('hard'), maxNodes: 1200,
  });
  assert.ok(result.completedRollouts >= 1, JSON.stringify(result));
});

test('hell avoids revealing a winning replacement to the next player', () => {
  const g = fixture(); g.finishScore = 5; g.players[1].score = 4;
  g.players[0].gems.red = 1;
  g.market[1] = [card('trigger', 1, { red: 1 })]; g.decks[1] = [card('opponent-win', 1)];
  const actions = [legalActions(g, 'p0').find(a => a.type === 'buy'), { type: 'take', gems: { blue: 2 } }];
  assert.equal(choose(g, 'hell', actions).type, 'take');
});

test('hell does not read opponents reserved card identities', () => {
  const g = fixture();
  g.players[1].reserved = [{ level: 1, get id() { throw new Error('hidden identity read'); },
    get cost() { throw new Error('hidden cost read'); } }];
  assert.doesNotThrow(() => choose(g, 'hell'));
});

test('terminal tie-breaking prefers fewer purchased cards', () => {
  const g = fixture(); g.turnOrder = ['p1', 'p0']; g.finalRound = 1;
  g.players[0].score = g.players[1].score = 5;
  g.players[1].cards = [card('owned', 0)]; g.market[1] = [card('unneeded', 0)];
  for (const difficulty of ['normal', 'hard', 'hell']) {
    const a = choose(g, difficulty);
    assert.notEqual(a.type, 'buy');
    assert.deepEqual(applyAction(g, 'p0', a).winners, ['p0']);
  }
});

for (const count of [2, 3, 4]) {
  test(`mixed algorithms complete a legal ${count}-player game`, () => {
    let g = fixture(count); g.finishScore = 5;
    for (const level of [1, 2, 3]) {
      // Reproducible interleaved colors, preserving exactly the base-set cards.
      const deck = structuredClone(CARDS_BY_LEVEL[level]).sort((a, b) =>
        a.id.slice(-2).localeCompare(b.id.slice(-2)) || a.id.localeCompare(b.id));
      g.market[level] = deck.splice(0, 4); g.decks[level] = deck;
    }
    let steps = 0;
    while (g.status === 'playing' && steps++ < 240) {
      const playerId = g.players[g.turn].id;
      const actions = legalActions(g, playerId);
      const difficulty = ['normal', 'hard', 'hell'][steps % 3];
      const result = ai.analyzeLocalDifficulty(g, playerId, actions, {
        ...options(difficulty), maxNodes: 1200,
      });
      assert.ok(actions.includes(result.action));
      g = applyAction(g, playerId, result.action);
      for (const c of [...COLORS, 'gold']) {
        const supply = c === 'gold' ? 5 : count === 2 ? 4 : count === 3 ? 5 : 7;
        assert.equal(g.bank[c] + g.players.reduce((n, p) => n + p.gems[c], 0), supply);
      }
    }
    assert.equal(g.status, 'finished', `still playing after ${steps} actions`);
    assert.ok(g.winners.length > 0);
  });
}
