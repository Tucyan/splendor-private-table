import test from 'node:test';
import assert from 'node:assert/strict';
import { createEndSnapshot, validateReflectionResponse, ReflectionCoordinator } from '../src/ai-reflection.js';

const game = () => ({ status: 'finished', endReason: 'host', finishScore: 8, turnOrder: ['a','b'], winners: ['a'], players: [{ id:'a', score:8, cards:[], nobles:[] }, { id:'b', score:4, cards:[], nobles:[] }], log: Array.from({length:20}, (_,i)=>({playerId:'a',text:`event ${i}`})) });

test('end snapshots are bounded and de-identified', () => {
  const snapshot = createEndSnapshot(game(), { gameId:'g1', players:[{id:'ai',ai:true,mode:'deepseek-advanced'}] });
  assert.equal(snapshot.evidence.length, 12); assert.deepEqual(snapshot.observers, ['ai']); assert.equal(snapshot.players[0].cards, 0);
});

test('reflection responses become bounded candidate lessons', () => {
  const lessons = validateReflectionResponse({ lessons: Array.from({length:20}, (_,i)=>({ id:`l${i}`, recommendation:'x' })) });
  assert.equal(lessons.length, 8); assert.ok(lessons.every(lesson => lesson.status === 'candidate'));
});

test('missing keys skip network reflection', async () => {
  let called = false; const coordinator = new ReflectionCoordinator({ fetchImpl: async()=>{called=true;} });
  assert.deepEqual(await coordinator.reflect(createEndSnapshot(game(), {gameId:'g2'}), {key:''}), {status:'skipped', reason:'missing_key'}); assert.equal(called, false);
});
