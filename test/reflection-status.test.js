import test from 'node:test';
import assert from 'node:assert/strict';
import { reflectionStatusView } from '../public/reflection-status.js';

const advancedRoom = (status, extra = {}) => ({
  game: { status: 'finished' },
  players: [{ id: 'human', ai: false, mode: 'human' }, { id: 'bot', ai: true, mode: 'llm-advanced' }],
  reflectionStatus: status === undefined ? undefined : { state: status, ...extra },
});

test('advanced finished games expose the syncing status', () => {
  assert.deepEqual(reflectionStatusView(advancedRoom('syncing')), {
    state: 'syncing', kind: 'pending', label: '经验同步中', detail: '正在整理这局公开信息，稍后保存为长期经验。',
  });
});

test('saved and failed reflection statuses are explicit', () => {
  assert.equal(reflectionStatusView(advancedRoom('saved', { lessons: 2 })).state, 'saved');
  assert.match(reflectionStatusView(advancedRoom('saved', { lessons: 2 })).detail, /2/);
  assert.equal(reflectionStatusView(advancedRoom('failed', { error: 'timeout' })).state, 'failed');
  assert.equal(reflectionStatusView(advancedRoom('failed', { error: 'timeout' })).kind, 'error');
});

test('continue status explains that the prior experience remains active', () => {
  const view = reflectionStatusView(advancedRoom('continue', { reason: 'timeout' }));
  assert.deepEqual(view, {
    state: 'continue', kind: 'warning', label: '同步失败，继续使用上次经验', detail: '本局仍可正常进行；新的经验将在下次同步时重试。',
  });
});

test('basic and local games never expose reflection status', () => {
  const basic = { ...advancedRoom('syncing'), players: [{ id: 'human', ai: false }, { id: 'bot', ai: true, mode: 'llm-basic' }] };
  const local = { ...advancedRoom('saved'), players: [{ id: 'human', ai: false }, { id: 'bot', ai: true, mode: 'local-hell' }] };
  const playing = { ...advancedRoom('syncing'), game: { status: 'playing' } };
  assert.equal(reflectionStatusView(basic), null);
  assert.equal(reflectionStatusView(local), null);
  assert.equal(reflectionStatusView(playing), null);
});

test('nested status snapshots and unknown states degrade safely', () => {
  const room = { ...advancedRoom(), reflectionStatus: undefined, reflection: { status: 'saved', lessons: 1 } };
  assert.equal(reflectionStatusView(room).state, 'saved');
  const unknown = { ...advancedRoom('unexpected') };
  assert.deepEqual(reflectionStatusView(unknown), {
    state: 'syncing', kind: 'pending', label: '经验同步中', detail: '正在整理这局公开信息，稍后保存为长期经验。',
  });
});
