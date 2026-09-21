import test from 'node:test';
import assert from 'node:assert/strict';

import { loadLlmConfig, publicLlmConfig } from '../src/llm-config.js';

const completeEnv = {
  LLM_API_KEY: 'secret-key',
  LLM_API_URL: 'https://llm.example.test/v1',
  LLM_MODEL: 'base-model',
};

test('loads the complete provider-neutral LLM configuration', () => {
  const config = loadLlmConfig({
    ...completeEnv,
    LLM_ADVANCED_MODEL: 'advanced-model',
    LLM_REFLECTION_MODEL: 'reflection-model',
    LLM_TIMEOUT_MS: '30000',
    LLM_REQUEST_EXTRA_JSON: '{"temperature":0.2}',
  });

  assert.deepEqual(config, {
    enabled: true,
    apiKey: 'secret-key',
    apiUrl: 'https://llm.example.test/v1',
    model: 'base-model',
    advancedModel: 'advanced-model',
    reflectionModel: 'reflection-model',
    timeoutMs: 30000,
    extraBody: { temperature: 0.2 },
  });
});

test('disables LLM when all required variables are missing', () => {
  assert.deepEqual(loadLlmConfig({}), {
    enabled: false,
    apiKey: undefined,
    apiUrl: undefined,
    model: undefined,
    advancedModel: undefined,
    reflectionModel: undefined,
    timeoutMs: 20000,
    extraBody: {},
  });
});

test('reports every missing required variable for a partial configuration', () => {
  assert.throws(
    () => loadLlmConfig({ LLM_API_KEY: 'secret-key' }),
    /LLM_API_URL.*LLM_MODEL/,
  );
});

test('falls advanced and reflection models back to the base model', () => {
  const config = loadLlmConfig(completeEnv);
  assert.equal(config.advancedModel, 'base-model');
  assert.equal(config.reflectionModel, 'base-model');

  const advancedOnly = loadLlmConfig({
    ...completeEnv,
    LLM_ADVANCED_MODEL: 'advanced-model',
  });
  assert.equal(advancedOnly.reflectionModel, 'advanced-model');
});

test('returns only safe public model configuration', () => {
  const publicConfig = publicLlmConfig(loadLlmConfig(completeEnv));
  assert.deepEqual(publicConfig, {
    enabled: true,
    baseModel: 'base-model',
    advancedModel: 'base-model',
    reflectionModel: 'base-model',
  });
  assert.equal(Object.hasOwn(publicConfig, 'apiKey'), false);
  assert.equal(Object.hasOwn(publicConfig, 'apiUrl'), false);
});

test('rejects non-http(s) URLs', () => {
  assert.throws(
    () => loadLlmConfig({ ...completeEnv, LLM_API_URL: 'ftp://llm.example.test' }),
    /LLM_API_URL.*http.*https/i,
  );
});

test('requires timeout to be a positive integer and defaults it to 20000', () => {
  assert.equal(loadLlmConfig(completeEnv).timeoutMs, 20000);
  for (const value of ['0', '-1', '1.5', 'not-a-number']) {
    assert.throws(
      () => loadLlmConfig({ ...completeEnv, LLM_TIMEOUT_MS: value }),
      /LLM_TIMEOUT_MS.*positive integer/i,
    );
  }
});

test('requires extra JSON to be a non-array object', () => {
  assert.deepEqual(loadLlmConfig(completeEnv).extraBody, {});
  assert.deepEqual(loadLlmConfig({ ...completeEnv, LLM_REQUEST_EXTRA_JSON: '' }).extraBody, {});
  assert.throws(
    () => loadLlmConfig({ ...completeEnv, LLM_REQUEST_EXTRA_JSON: '{oops' }),
    /LLM_REQUEST_EXTRA_JSON.*JSON/i,
  );
  assert.throws(
    () => loadLlmConfig({ ...completeEnv, LLM_REQUEST_EXTRA_JSON: '[]' }),
    /LLM_REQUEST_EXTRA_JSON.*object/i,
  );
});

test('protects request fields from extra JSON overrides', () => {
  for (const field of ['model', 'messages', 'response_format', 'stream']) {
    assert.throws(
      () => loadLlmConfig({
        ...completeEnv,
        LLM_REQUEST_EXTRA_JSON: JSON.stringify({ [field]: 'override' }),
      }),
      new RegExp(`LLM_REQUEST_EXTRA_JSON.*${field}`),
    );
  }
});

test('freezes the returned configuration and nested extra body', () => {
  const config = loadLlmConfig({
    ...completeEnv,
    LLM_REQUEST_EXTRA_JSON: '{"temperature":0.2}',
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.extraBody), true);
  assert.throws(() => { config.model = 'changed'; }, TypeError);
  assert.throws(() => { config.extraBody.temperature = 0.9; }, TypeError);
});
