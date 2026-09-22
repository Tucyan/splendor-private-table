import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmLogger } from '../src/llm-logger.js';

test('writes a redacted structured event without prompt or response content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-llm-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = new LlmLogger({ directory, apiKey: 'secret-key' });
  await logger.write({
    type: 'llm.response', requestId: 'req-1', gameId: 'game-1',
    prompt: 'private prompt', authorization: 'Bearer secret-key',
    data: { finishReason: 'stop', content: '{"actionIndex":0}', responseChars: 18 },
  });
  const lines = (await readFile(join(directory, 'llm-events.jsonl'), 'utf8')).trim().split('\n');
  const event = JSON.parse(lines[0]);
  assert.equal(event.requestId, 'req-1');
  assert.equal(event.gameId, 'game-1');
  assert.equal(Object.hasOwn(event, 'prompt'), false);
  assert.equal(JSON.stringify(event).includes('secret-key'), false);
  assert.equal(JSON.stringify(event).includes('actionIndex'), false);
  assert.equal(event.data.finishReason, 'stop');
  assert.equal(event.data.responseChars, 18);
});

test('disabled logger does not create a log file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-llm-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = new LlmLogger({ directory, enabled: false });
  await logger.write({ type: 'llm.request', requestId: 'req-2' });
  await assert.rejects(readFile(join(directory, 'llm-events.jsonl'), 'utf8'), { code: 'ENOENT' });
});

test('rotates an oversized event file and keeps the previous file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-llm-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = new LlmLogger({ directory, maxBytes: 120 });
  await logger.write({ type: 'llm.error', requestId: 'req-1', data: { reasonCode: 'LLM_TIMEOUT', safeMessage: 'x'.repeat(60) } });
  await logger.write({ type: 'llm.error', requestId: 'req-2', data: { reasonCode: 'LLM_TIMEOUT', safeMessage: 'y'.repeat(60) } });
  const previous = await readFile(join(directory, 'llm-events.previous.jsonl'), 'utf8');
  const current = await readFile(join(directory, 'llm-events.jsonl'), 'utf8');
  assert.match(previous, /req-1/);
  assert.match(current, /req-2/);
});
