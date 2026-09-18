import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, legalActions } from '../src/game.js';
import { CARDS } from '../src/data.js';
import {
  AdvancedObservationMemory,
  AdvancedPlanMemory,
  buildAdvancedContext,
} from '../src/ai-advanced-context.js';

const players = () => [{ id: 'p1', name: 'one' }, { id: 'p2', name: 'two' }];
const card = id => CARDS.find(value => value.id === id);

test('public market reserves are remembered and removed after purchase', () => {
  const memory = new AdvancedObservationMemory();
  let before = createGame(players());
  before.market = { 1: [card('green-L1-01')], 2: [], 3: [] };
  const reserve = legalActions(before, 'p1').find(action => action.type === 'reserve' && action.cardId === 'green-L1-01');
  const afterReserve = applyAction(before, 'p1', reserve);
  memory.record({ gameId: 'g1', observerId: 'p2', before, after: afterReserve, actorId: 'p1', action: reserve });

  let remembered = memory.get('g1', 'p2');
  assert.deepEqual(remembered.observedReserved.p1, [{
    cardId: 'green-L1-01', level: 1, points: 0, bonus: 'green',
    cost: { white: 0, blue: 0, green: 0, red: 3, black: 0 },
  }]);

  before = structuredClone(afterReserve);
  before.turn = 0;
  before.players[0].gems = { white: 0, blue: 0, green: 0, red: 3, black: 0, gold: 1 };
  const purchase = { type: 'buy', cardId: 'green-L1-01', payment: { red: 3 } };
  const afterPurchase = applyAction(before, 'p1', purchase);
  memory.record({ gameId: 'g1', observerId: 'p2', before, after: afterPurchase, actorId: 'p1', action: purchase });
  remembered = memory.get('g1', 'p2');
  assert.deepEqual(remembered.observedReserved.p1, []);
});

test('blind reserves retain only public level and never leak hidden card identity or cost', () => {
  const memory = new AdvancedObservationMemory();
  const before = createGame(players());
  before.decks[2] = [{ id: 'secret-card-identity', level: 2, points: 9, bonus: 'black', cost: { white: 99 } }];
  const action = legalActions(before, 'p1').find(value => value.type === 'reserve' && value.level === 2);
  const after = applyAction(before, 'p1', action);
  memory.record({ gameId: 'g1', observerId: 'p2', before, after, actorId: 'p1', action });
  const result = memory.get('g1', 'p2');
  assert.equal(result.events.at(-1).level, 2);
  assert.equal(result.events.at(-1).visibility, 'blind');
  assert.doesNotMatch(JSON.stringify(result), /secret-card-identity|99|points|cost/);
  assert.deepEqual(result.observedReserved.p1, []);
});

test('opponent gems remain attached to the public opponent identity in context', () => {
  const game = createGame(players());
  game.players[1].gems = { white: 2, blue: 1, green: 0, red: 0, black: 0, gold: 1 };
  game.players[1].bonuses.blue = 2;
  game.players[1].score = 4;
  const context = buildAdvancedContext(game, 'p1');
  assert.deepEqual(context.table.opponents[0], {
    playerId: 'p2', seat: 1, gems: game.players[1].gems, bonuses: game.players[1].bonuses,
    cards: game.players[1].cards, score: 4, nobles: game.players[1].nobles,
    reservedCount: 0, observedReserved: [], unknownReservedCount: 0,
  });
});

test('plan targets are invalidated when the card leaves the visible market', () => {
  const memory = new AdvancedPlanMemory();
  const game = createGame(players());
  const targetId = game.market[1][0].id;
  memory.set('g1', 'p1', {
    primaryTarget: targetId,
    backupTarget: game.market[2][0].id,
    nobleTarget: game.nobles[0].id,
    expectedActions: ['take white', 'buy target'],
    lastAction: { type: 'take', note: 'build toward primary' },
    rationale: { note: 'discount useful for visible cards' },
  });
  game.market[1] = game.market[1].filter(value => value.id !== targetId);
  const valid = memory.validate('g1', 'p1', game);
  assert.equal(valid.primaryTarget, null);
  assert.equal(valid.backupTarget, game.market[2][0].id);
  assert.deepEqual(valid.expectedActions, []);
  assert.equal(valid.rationale.type, 'target_invalidated');
});

test('a plan yields to a public opponent buy that can trigger the finish score', () => {
  const memory = new AdvancedPlanMemory();
  const game = createGame(players(), { finishScore: 8 });
  game.market[1] = [card('blue-L1-01')];
  game.players[1].score = 6;
  game.players[1].gems = { white: 0, blue: 0, green: 0, red: 0, black: 3, gold: 0 };
  game.nobles = [{ id: 'n-blue', points: 3, cost: { white: 0, blue: 1, green: 0, red: 0, black: 0 } }];
  memory.set('g1', 'p1', { primaryTarget: 'blue-L1-01', expectedActions: ['take black'] });

  const valid = memory.validate('g1', 'p1', game);
  assert.equal(valid.primaryTarget, null);
  assert.equal(valid.rationale.type, 'urgent_endgame');

  const reservedGame = createGame(players(), { finishScore: 8 });
  reservedGame.market[1] = [card('white-L1-01')];
  reservedGame.players[1].score = 6;
  reservedGame.players[1].gems = { white: 0, blue: 0, green: 0, red: 0, black: 3, gold: 0 };
  reservedGame.players[1].reserved = [{ id: 'known-threat', level: 2, points: 0, bonus: 'blue', cost: { white: 0, blue: 0, green: 0, red: 0, black: 3 } }];
  reservedGame.nobles = [{ id: 'n-blue', points: 3, cost: { white: 0, blue: 1, green: 0, red: 0, black: 0 } }];
  memory.set('g2', 'p1', { primaryTarget: 'white-L1-01', expectedActions: ['take green'] });
  const reservedValid = memory.validate('g2', 'p1', reservedGame, {
    observedReserved: { p2: [{ cardId: 'known-threat', level: 2, points: 0, bonus: 'blue', cost: { white: 0, blue: 0, green: 0, red: 0, black: 3 } }] },
  });
  assert.equal(reservedValid.primaryTarget, null);
  assert.equal(reservedValid.rationale.type, 'urgent_endgame');
});

test('context caps experiences and stays identical when hidden identities and deck order change', () => {
  const first = createGame(players());
  const second = structuredClone(first);
  first.players[1].reserved = [{ id: 'hidden-A', level: 1, points: 9, bonus: 'black', cost: { white: 8 } }];
  second.players[1].reserved = [{ id: 'hidden-B', level: 1, points: 0, bonus: 'white', cost: { blue: 1 } }];
  first.decks = { 1: [...first.decks[1]].reverse(), 2: first.decks[2], 3: first.decks[3] };
  second.decks = { 1: [...first.decks[1]].reverse(), 2: [...second.decks[2]].reverse(), 3: second.decks[3] };
  const experiences = Array.from({ length: 12 }, (_, index) => ({ id: `e${index}`, text: `experience ${index}` }));
  const a = buildAdvancedContext(first, 'p1', { experiences });
  const b = buildAdvancedContext(second, 'p1', { experiences });
  assert.deepEqual(a, b);
  assert.equal(a.experiences.length, 8);
  assert.equal(a.table.finishScore, first.finishScore);
  assert.deepEqual(a.table.turnOrder, first.turnOrder);
  assert.equal(a.table.opponents[0].unknownReservedCount, 1);
  assert.equal(a.table.opponents[0].observedReserved.length, 0);
});

test('one context can include bounded tactical facts, plan, observations and long-term experiences', () => {
  const game = createGame(players());
  const planMemory = new AdvancedPlanMemory();
  planMemory.set('g1', 'p1', { primaryTarget: game.market[1][0].id, expectedActions: ['take white'] });
  const analysis = {
    actionIndex: 0,
    action: { type: 'take', gems: { white: 1 } },
    candidates: Array.from({ length: 40 }, (_, index) => ({
      actionIndex: index, action: { type: 'take', gems: { white: 1 } }, utility: index,
      facts: { actionType: 'take', scoreAfter: index, debugBlob: 'x'.repeat(10000), cardTactics: {
        cardId: 'unreachable', level: 1, points: 0, discountedCost: { white: 1 }, colorPaid: {},
        goldUse: 0, remainingDeficit: { white: 1 }, reachable: false, bankCanSupply: false,
        expectedActions: null, nobleEligibility: { eligibleAfterBuy: [], maxPointsAfterBuy: 0 },
      } },
    })),
    opponentThreats: Array.from({ length: 40 }, (_, index) => ({ actorId: `p${index}`, cardId: `c${index}`, scoreAfter: index })),
    budget: { nodes: 40, maxNodes: 100, completedCandidates: 40, truncated: false },
    debugBlob: 'x'.repeat(100000),
  };
  const memory = new AdvancedObservationMemory();
  const before = structuredClone(game), after = { ...structuredClone(game), round: 2 };
  memory.record({ gameId: 'g1', observerId: 'p1', before, after, actorId: 'p2', action: { type: 'take', gems: { white: 1 } } });
  const context = buildAdvancedContext(game, 'p1', {
    gameId: 'g1', observationMemory: memory, planMemory, tacticalAnalysis: analysis,
    experiences: ['keep this lesson'],
  });
  assert.ok(context.table.market);
  assert.ok(context.plan);
  assert.equal(context.recentEvents.length, 1);
  assert.deepEqual(context.experiences, [{ id: '0', text: 'keep this lesson' }]);
  assert.equal(context.tacticalAnalysis.actionIndex, 0);
  assert.equal(context.tacticalAnalysis.candidates[0].facts.cardTactics.reachable, false);
  assert.ok(context.tacticalAnalysis.candidates.length <= 12);
  assert.ok(context.tacticalAnalysis.opponentThreats.length <= 12);
  assert.equal(Object.hasOwn(context.tacticalAnalysis, 'debugBlob'), false);
  assert.ok(JSON.stringify(context.tacticalAnalysis).length < 16000);
});

test('terminal event survives event truncation', () => {
  const memory = new AdvancedObservationMemory({ maxEvents: 2 });
  let before = createGame(players());
  let after = structuredClone(before);
  for (let i = 0; i < 3; i += 1) {
    after = { ...after, round: i + 2 };
    memory.record({ gameId: 'g1', observerId: 'p2', before, after, actorId: 'p1', action: { type: 'take', gems: { white: 1 } } });
    before = after;
  }
  const ended = { ...before, status: 'finished', winners: ['p1'] };
  memory.record({ gameId: 'g1', observerId: 'p2', before, after: ended, actorId: 'p1', action: { type: 'pass' } });
  const events = memory.get('g1', 'p2').events;
  assert.equal(events.length, 2);
  assert.equal(events.at(-1).terminal, true);
  assert.deepEqual(events.at(-1).winnerIds, ['p1']);

  const oneEventMemory = new AdvancedObservationMemory({ maxEvents: 1 });
  oneEventMemory.record({ gameId: 'g1', observerId: 'p2', before, after: ended, actorId: 'p1', action: { type: 'pass' } });
  assert.equal(oneEventMemory.get('g1', 'p2').events.length, 1);
  assert.equal(oneEventMemory.get('g1', 'p2').events[0].terminal, true);
});

test('observation event cap never exceeds twelve, even when configured above twelve', () => {
  const memory = new AdvancedObservationMemory({ maxEvents: 100 });
  let before = createGame(players());
  for (let index = 0; index < 15; index += 1) {
    const after = { ...structuredClone(before), round: index + 2 };
    memory.record({ gameId: 'bounded', observerId: 'p2', before, after, actorId: 'p1', action: { type: 'take', gems: { white: 1 } } });
    before = after;
  }
  const ended = { ...before, status: 'finished', winners: ['p1'] };
  memory.record({ gameId: 'bounded', observerId: 'p2', before, after: ended, actorId: 'p1', action: { type: 'pass' } });
  const events = memory.get('bounded', 'p2').events;
  assert.equal(events.length, 12);
  assert.equal(events.at(-1).terminal, true);
});
