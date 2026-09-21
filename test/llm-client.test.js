import test from 'node:test';
import assert from 'node:assert/strict';

import { requestLlmJson } from '../src/llm-client.js';

const config = {
  enabled: true,
  apiKey: 'test-secret-key',
  apiUrl: 'https://llm.example.test/v1/chat/completions',
  timeoutMs: 1000,
  extraBody: { top_p: 0.7, stream: true, model: 'unsafe', response_format: { type: 'text' } },
};

const messages = [
  { role: 'system', content: 'Return a JSON object only.' },
  { role: 'user', content: 'Summarize this as JSON.' },
];

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function successfulResponse(overrides = {}) {
  return response({
    choices: [{ message: { content: '{"answer":"ok"}', reasoning_content: 'private reasoning' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
    ...overrides,
  });
}

test('posts a real chat-completions envelope and returns only parsed JSON data', async () => {
  let request;
  const result = await requestLlmJson({
    config,
    model: 'chosen-model',
    messages,
    maxTokens: 321,
    temperature: 0.35,
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return successfulResponse();
    },
  });

  assert.equal(request.url, config.apiUrl);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret-key');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(request.body, {
    top_p: 0.7,
    model: 'chosen-model',
    messages,
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: 321,
    temperature: 0.35,
  });
  assert.deepEqual(result, {
    data: { answer: 'ok' },
    usage: { prompt_tokens: 3, completion_tokens: 4 },
    finishReason: 'stop',
  });
  assert.equal(Object.hasOwn(result, 'reasoning_content'), false);
});

test('rejects disabled or incomplete configs, empty model, and prompts without JSON wording', async () => {
  const cases = [
    { config: { ...config, enabled: false }, model: 'm', messages },
    { config: { ...config, apiKey: '' }, model: 'm', messages },
    { config: { ...config, apiUrl: '' }, model: 'm', messages },
    { config, model: '', messages },
    { config, model: 'm', messages: [] },
    { config, model: 'm', messages: [{ role: 'user', content: 'plain text only' }] },
  ];
  for (const input of cases) {
    await assert.rejects(
      requestLlmJson({ ...input, fetchImpl: async () => response({}) }),
      (error) => error.code === 'LLM_JSON_PROMPT_REQUIRED',
    );
  }
});

test('allows JSON wording in any message content and defaults optional request values', async () => {
  let body;
  const result = await requestLlmJson({
    config: { ...config, extraBody: {} },
    model: 'm',
    messages: [{ role: 'user', content: 'Use /JSON/ please.' }],
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response({ choices: [{ message: { content: '{}' } }] });
    },
  });
  assert.deepEqual(body, {
    model: 'm',
    messages: [{ role: 'user', content: 'Use /JSON/ please.' }],
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: 512,
    temperature: 0.2,
  });
  assert.deepEqual(result, { data: {}, usage: null, finishReason: null });
});

test('rejects empty and non-string completion content with a stable code', async () => {
  for (const content of ['', '   ', null, { answer: 'not a string' }]) {
    await assert.rejects(
      requestLlmJson({ config, model: 'm', messages, fetchImpl: async () => successfulResponse({ choices: [{ message: { content } }] }) }),
      (error) => error.code === 'LLM_EMPTY_CONTENT',
    );
  }
});

test('rejects malformed JSON and truncated completions', async () => {
  await assert.rejects(
    requestLlmJson({ config, model: 'm', messages, fetchImpl: async () => successfulResponse({ choices: [{ message: { content: '{bad' } }] }) }),
    (error) => error.code === 'LLM_INVALID_JSON',
  );
  await assert.rejects(
    requestLlmJson({ config, model: 'm', messages, fetchImpl: async () => successfulResponse({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }) }),
    (error) => error.code === 'LLM_TRUNCATED',
  );
});

test('extracts short HTTP error messages without returning the response body', async () => {
  const cases = [
    [400, { error: { message: 'bad request details' } }],
    [401, 'invalid API key from provider'],
  ];
  for (const [status, body] of cases) {
    await assert.rejects(
      requestLlmJson({ config, model: 'm', messages, fetchImpl: async () => response(body, status) }),
      (error) => error.code === `LLM_HTTP_${status}`
        && error.status === status
        && error.message.includes(typeof body === 'string' ? body : body.error.message)
        && error.message.length < 500
        && !Object.hasOwn(error, 'body'),
    );
  }
});

test('truncates long HTTP errors and redacts secrets and request messages', async () => {
  const longSecretBody = `prefix ${'x'.repeat(900)} test-secret-key ${JSON.stringify(messages)} suffix`;
  await assert.rejects(
    requestLlmJson({ config, model: 'm', messages, fetchImpl: async () => response(longSecretBody, 400) }),
    (error) => error.code === 'LLM_HTTP_400'
      && error.message.length <= 500
      && !error.message.includes('test-secret-key')
      && !error.message.includes(messages[0].content)
      && !error.message.includes('Authorization'),
  );
});

test('wraps network failures with a safe cause and redacts the API key', async () => {
  await assert.rejects(
    requestLlmJson({
      config,
      model: 'm',
      messages,
      fetchImpl: async () => { throw new Error(`socket failed with test-secret-key`); },
    }),
    (error) => error.code === 'LLM_NETWORK_ERROR'
      && error.cause instanceof Error
      && !error.cause.message.includes('test-secret-key')
      && !error.message.includes('test-secret-key'),
  );
});

test('converts timeout aborts to LLM_TIMEOUT and cleans up the timer', async () => {
  const abortSignal = await new Promise((resolve) => {
    requestLlmJson({
      config: { ...config, timeoutMs: 10 },
      model: 'm',
      messages,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          abortSignalValue = options.signal;
          reject(new Error('aborted by timeout'));
        }, { once: true });
      }),
    }).then(() => assert.fail('request should time out')).catch((error) => {
      assert.equal(error.code, 'LLM_TIMEOUT');
      resolve(abortSignalValue);
    });
    let abortSignalValue;
  });
  assert.equal(abortSignal.aborted, true);
});

test('converts external cancellation to LLM_ABORTED', async () => {
  const controller = new AbortController();
  await assert.rejects(
    requestLlmJson({
      config: { ...config, timeoutMs: 1000 },
      model: 'm',
      messages,
      signal: controller.signal,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('external cancellation')), { once: true });
        controller.abort();
      }),
    }),
    (error) => error.code === 'LLM_ABORTED',
  );
});

test('removes the external abort listener after a completed request', async () => {
  let added = 0;
  let removed = 0;
  const signal = {
    aborted: false,
    addEventListener(type, listener) {
      assert.equal(type, 'abort');
      added += 1;
      this.listener = listener;
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'abort');
      assert.equal(listener, this.listener);
      removed += 1;
    },
  };
  await requestLlmJson({
    config: { ...config, timeoutMs: 10_000 },
    model: 'm',
    messages,
    signal,
    fetchImpl: async () => successfulResponse(),
  });
  assert.equal(added, 1);
  assert.equal(removed, 1);
});
