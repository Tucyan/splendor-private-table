import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, legalActions, viewGame } from '../src/game.js';
import { CARDS, NOBLES, COLORS, GOLD } from '../src/data.js';

test('an exhausted bank permits either reserving or manually passing when nothing is affordable',()=>{
  let game=createGame(players());game.bank=emptyGems();
  assert.ok(legalActions(game,'p1').some(a=>a.type==='reserve'));
  assert.ok(legalActions(game,'p1').some(a=>a.type==='pass'));
  assert.equal(applyAction(game,'p1',{type:'pass'}).turn,1);
  game=applyAction(game,'p1',{type:'reserve',level:1});
  assert.equal(game.turn,1);assert.equal(game.players[0].reserved.length,1);
});

test('one complete cycle of truly blocked players concludes the game instead of looping forever',()=>{
  let game=createGame(players());game.bank=emptyGems();
  game.market={1:[],2:[],3:[]};game.decks={1:[],2:[],3:[]};
  assert.deepEqual(legalActions(game,'p1'),[{type:'pass'}]);
  game=applyAction(game,'p1',{type:'pass'});assert.equal(game.status,'playing');
  game=applyAction(game,'p2',{type:'pass'});
  assert.equal(game.status,'finished');assert.equal(game.endReason,'stalemate');
  assert.deepEqual(game.winners,['p1','p2']);
});

const ids = (xs) => xs.map((x) => x.id);
const emptyGems = () => Object.fromEntries([...COLORS, GOLD].map((c) => [c, 0]));
const players = (count = 2) => Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}`, ai: false }));

test('base data has exact card and noble counts and valid shapes', () => {
  assert.equal(CARDS.length, 90);
  assert.equal(NOBLES.length, 10);
  assert.deepEqual(COLORS, ['white', 'blue', 'green', 'red', 'black']);
  assert.equal(GOLD, 'gold');
  assert.equal(new Set(ids(CARDS)).size, 90);
  assert.equal(new Set(ids(NOBLES)).size, 10);
  assert.equal(CARDS.filter((c) => c.level === 1).length, 40);
  assert.equal(CARDS.filter((c) => c.level === 2).length, 30);
  assert.equal(CARDS.filter((c) => c.level === 3).length, 20);
  for (const card of CARDS) {
    assert.ok([1, 2, 3].includes(card.level));
    assert.ok(COLORS.includes(card.bonus));
    assert.ok(Number.isInteger(card.points) && card.points >= 0);
    assert.deepEqual(Object.keys(card.cost).sort(), [...COLORS].sort());
  }
  for (const noble of NOBLES) {
    assert.equal(noble.points, 3);
    assert.deepEqual(Object.keys(noble.cost).sort(), [...COLORS].sort());
  }
  assert.deepEqual(NOBLES.map((noble) => Object.values(noble.cost).filter(Boolean).sort((a, b) => a - b)), [
    [3, 3, 3], [3, 3, 3], [4, 4], [4, 4], [4, 4],
    [3, 3, 3], [3, 3, 3], [3, 3, 3], [4, 4], [4, 4],
  ]);
});

test('createGame uses player count supply, deals four market cards and player plus one nobles', () => {
  for (const count of [2, 3, 4]) {
    const game = createGame(players(count));
    assert.equal(game.players.length, count);
    assert.deepEqual(game.bank, { white: count === 2 ? 4 : count === 3 ? 5 : 7, blue: count === 2 ? 4 : count === 3 ? 5 : 7, green: count === 2 ? 4 : count === 3 ? 5 : 7, red: count === 2 ? 4 : count === 3 ? 5 : 7, black: count === 2 ? 4 : count === 3 ? 5 : 7, gold: 5 });
    assert.equal(game.nobles.length, count + 1);
    for (const level of [1, 2, 3]) assert.equal(game.market[level].length, 4);
    assert.equal(game.turn, 0);
    assert.equal(game.pending, null);
  }
});

test('taking three different gems is legal and taking two same gems needs four in bank', () => {
  let game = createGame(players(2));
  const before = structuredClone(game);
  game = applyAction(game, 'p1', { type: 'take', gems: { white: 1, blue: 1, green: 1 } });
  assert.equal(game.players[0].gems.white, 1);
  assert.equal(game.players[0].gems.blue, 1);
  assert.equal(game.players[0].gems.green, 1);
  assert.equal(game.bank.white, before.bank.white - 1);
  assert.equal(game.turn, 1);
  assert.throws(() => applyAction(game, 'p2', { type: 'take', gems: { white: 2 } }), /two|四|bank|宝石/i);
  const reduced = structuredClone(game);
  reduced.bank.white = 3;
  assert.throws(() => applyAction(reduced, 'p2', { type: 'take', gems: { white: 2 } }), /two|四|bank|宝石/i);
});

test('taking fewer different gems is allowed and turn-end hand limit creates discard pending', () => {
  let game = createGame(players(2));
  game.players[0].gems = { white: 8, blue: 2, green: 0, red: 0, black: 0, gold: 0 };
  game = applyAction(game, 'p1', { type: 'take', gems: { blue: 1 } });
  assert.equal(game.pending?.type, 'discard');
  assert.equal(game.pending?.count, 1);
  assert.equal(game.turn, 0);
  assert.throws(() => applyAction(game, 'p2', { type: 'pass' }), /玩家.*回合|pending|discard|返还/i);
  game = applyAction(game, 'p1', { type: 'discard', gems: { white: 1 } });
  assert.equal(game.pending, null);
  assert.equal(game.turn, 1);
});

test('buying applies bonus discounts and gold wildcard payment, then replaces market card', () => {
  let game = createGame(players(2));
  const card = CARDS.find((c) => c.id === 'white-L1-02');
  game.market[1][0] = card;
  game.players[0].bonuses = { white: 0, blue: 0, green: 3, red: 0, black: 0 };
  game.players[0].gems = { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 1 };
  game.bank.gold = 4;
  const before = structuredClone(game);
  game = applyAction(game, 'p1', { type: 'buy', cardId: card.id, payment: { gold: 1 } });
  assert.equal(game.players[0].cards.at(-1).id, card.id);
  assert.equal(game.players[0].bonuses.white, card.bonus === 'white' ? 1 : 0);
  assert.equal(game.players[0].gems.gold, 0);
  assert.equal(game.bank.gold, before.bank.gold + 1);
  assert.equal(game.market[1].length, 4);
  assert.equal(game.turn, 1);
});

test('reserve takes a market or top deck card, gives gold when available, and enforces three-card limit', () => {
  let game = createGame(players(2));
  const card = game.market[1][0];
  game = applyAction(game, 'p1', { type: 'reserve', cardId: card.id });
  assert.equal(game.players[0].reserved.length, 1);
  assert.equal(game.players[0].gems.gold, 1);
  assert.ok(!game.market[1].some((c) => c.id === card.id));
  assert.equal(game.market[1].length, 4);
  game.players[0].reserved = [game.players[0].reserved[0], { ...game.decks[1].pop(), level: 1 }, { ...game.decks[1].pop(), level: 1 }];
  game.turn = 0;
  assert.throws(() => applyAction(game, 'p1', { type: 'reserve', level: 1 }), /three|3|预留/i);
});

test('noble is selected automatically when exactly one qualifies and pending when multiple qualify', () => {
  let game = createGame(players(2));
  game.players[0].bonuses = { white: 3, blue: 3, green: 3, red: 3, black: 3 };
  game.nobles = [
    { id: 'n1', points: 3, cost: { white: 3, blue: 3, green: 0, red: 0, black: 0 } },
    { id: 'n2', points: 3, cost: { white: 0, blue: 0, green: 3, red: 3, black: 0 } },
  ];
  game.bank = emptyGems();
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game = applyAction(game, 'p1', { type: 'pass' });
  assert.equal(game.pending?.type, 'noble');
  assert.deepEqual(game.pending.nobleIds, ['n1', 'n2']);
  game = applyAction(game, 'p1', { type: 'noble', nobleId: 'n2' });
  assert.equal(game.players[0].nobles.at(-1).id, 'n2');
  assert.equal(game.turn, 1);
});

test('fifteen points starts equal-turn final round and resolves tied winners by fewest cards', () => {
  let game = createGame(players(2));
  game.players[0].score = 15;
  game.players[0].cards = [{ id: 'a', level: 1, bonus: 'white', points: 0, cost: emptyGems() }];
  game.bank = emptyGems();
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game = applyAction(game, 'p1', { type: 'pass' });
  assert.equal(game.status, 'playing');
  assert.equal(game.finalRound, 0);
  assert.equal(game.turn, 1);
  game.players[1].score = 15;
  game.players[1].cards = [{ id: 'b', level: 1, bonus: 'blue', points: 0, cost: emptyGems() }, { id: 'c', level: 1, bonus: 'blue', points: 0, cost: emptyGems() }];
  game = applyAction(game, 'p2', { type: 'pass' });
  assert.equal(game.status, 'finished');
  assert.deepEqual(game.winners, ['p1']);
});

test('illegal actions never mutate source and view hides deck order and other reserved cards', () => {
  const game = createGame(players(2));
  const before = structuredClone(game);
  assert.throws(() => applyAction(game, 'p2', { type: 'pass' }), /turn|回合/i);
  assert.deepEqual(game, before);
  const view = viewGame(game, 'p1');
  assert.deepEqual(view.decks, { 1: game.decks[1].length, 2: game.decks[2].length, 3: game.decks[3].length });
  assert.ok(view.players[1].reserved.every((c) => c.id === 'hidden'));
  assert.deepEqual(view.players[0].reserved, game.players[0].reserved);
});

test('legalActions only exposes actions for current player and includes take choices', () => {
  const game = createGame(players(2));
  assert.deepEqual(legalActions(game, 'p2'), []);
  const actions = legalActions(game, 'p1');
  assert.ok(actions.some((a) => a.type === 'take' && Object.values(a.gems).reduce((s, n) => s + n, 0) === 3));
  assert.ok(actions.some((a) => a.type === 'reserve' && a.cardId === game.market[1][0].id));
});

test('final round ends at the last seat when a middle seat reaches fifteen', () => {
  let game = createGame(players(3));
  game.bank = emptyGems();
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game.turn = 1;
  game.players[1].score = 15;
  game = applyAction(game, 'p2', { type: 'pass' });
  assert.equal(game.finalRound, 1);
  assert.equal(game.turn, 2);
  assert.equal(game.status, 'playing');
  game = applyAction(game, 'p3', { type: 'pass' });
  assert.equal(game.status, 'finished');
});

test('reaching fifteen through a noble starts the final round after noble resolution', () => {
  let game = createGame(players(2));
  game.bank = emptyGems();
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game.players[0].score = 12;
  game.players[0].bonuses = { white: 3, blue: 3, green: 3, red: 0, black: 0 };
  game.nobles = [{ id: 'n1', points: 3, cost: { white: 3, blue: 3, green: 3, red: 0, black: 0 } }];
  game = applyAction(game, 'p1', { type: 'pass' });
  assert.equal(game.players[0].score, 15);
  assert.equal(game.finalRound, 0);
  assert.equal(game.turn, 1);
  assert.equal(game.status, 'playing');
});

test('blind reserve log omits the hidden card id and includes player context', () => {
  let game = createGame(players(2));
  const hiddenCard = game.decks[1].at(-1);
  game = applyAction(game, 'p1', { type: 'reserve', level: 1 });
  const reserveLog = game.log.find((entry) => entry.text.includes('预留'));
  assert.ok(reserveLog);
  assert.equal(reserveLog.playerId, 'p1');
  assert.match(reserveLog.text, /玩家1/);
  assert.doesNotMatch(reserveLog.text, new RegExp(hiddenCard.id));
});

test('every bounded discard action returned by legalActions is executable', () => {
  const game = createGame(players(2));
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game.players[0].gems = { white: 1, blue: 1, green: 1, red: 0, black: 0, gold: 0 };
  game.pending = { type: 'discard', count: 3 };
  const actions = legalActions(game, 'p1');
  assert.ok(actions.length > 0);
  for (const action of actions) assert.doesNotThrow(() => applyAction(structuredClone(game), 'p1', action));
});

test('discarding after a noble choice cannot grant a second noble in the same turn', () => {
  let game = createGame(players(2));
  game.players[0].gems = { white: 9, blue: 2, green: 0, red: 0, black: 0, gold: 0 };
  game.players[0].bonuses = { white: 3, blue: 3, green: 3, red: 3, black: 3 };
  game.nobles = [
    { id: 'n1', points: 3, cost: { white: 3, blue: 3, green: 0, red: 0, black: 0 } },
    { id: 'n2', points: 3, cost: { white: 0, blue: 0, green: 3, red: 3, black: 0 } },
  ];
  game.bank = emptyGems();
  game.market = { 1: [], 2: [], 3: [] };
  game.decks = { 1: [], 2: [], 3: [] };
  game = applyAction(game, 'p1', { type: 'pass' });
  assert.equal(game.pending.type, 'noble');
  game = applyAction(game, 'p1', { type: 'noble', nobleId: 'n1' });
  assert.equal(game.pending.type, 'discard');
  game = applyAction(game, 'p1', { type: 'discard', gems: { white: 1 } });
  assert.equal(game.pending, null);
  assert.equal(game.players[0].nobles.length, 1);
});
