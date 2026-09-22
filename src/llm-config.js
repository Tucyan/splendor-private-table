const REQUIRED_KEYS = ['LLM_API_KEY', 'LLM_API_URL', 'LLM_MODEL'];
const PROTECTED_EXTRA_FIELDS = ['model', 'messages', 'response_format', 'stream'];
const DEFAULT_REASONING_EFFORTS = ['low', 'high', 'max'];
const VALID_REASONING_EFFORTS = new Set(DEFAULT_REASONING_EFFORTS);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function parseTimeout(rawValue) {
  if (!hasValue(rawValue)) return 0;
  const text = String(rawValue).trim();
  const timeoutMs = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(timeoutMs)) {
    throw new Error('LLM_TIMEOUT_MS must be a non-negative integer');
  }
  return timeoutMs;
}

function parseReasoningEfforts(rawValue) {
  if (!hasValue(rawValue)) return [...DEFAULT_REASONING_EFFORTS];
  const efforts = String(rawValue).split(',').map(value => value.trim()).filter(Boolean);
  if (efforts.some(effort => !VALID_REASONING_EFFORTS.has(effort))) {
    throw new Error('LLM_REASONING_EFFORTS must be a comma-separated list of low, high, and/or max');
  }
  const uniqueEfforts = [...new Set(efforts)];
  if (!uniqueEfforts.length) throw new Error('LLM_REASONING_EFFORTS must include low, high, or max');
  return uniqueEfforts;
}

function parseExtraBody(rawValue) {
  if (!hasValue(rawValue)) return {};

  let extraBody;
  try {
    extraBody = JSON.parse(String(rawValue));
  } catch {
    throw new Error('LLM_REQUEST_EXTRA_JSON must be valid JSON');
  }
  if (extraBody === null || typeof extraBody !== 'object' || Array.isArray(extraBody)) {
    throw new Error('LLM_REQUEST_EXTRA_JSON must be a JSON object');
  }
  for (const field of PROTECTED_EXTRA_FIELDS) {
    if (Object.hasOwn(extraBody, field)) {
      throw new Error(`LLM_REQUEST_EXTRA_JSON cannot override ${field}`);
    }
  }
  return extraBody;
}

function parseBoolean(rawValue, fallback) {
  if (!hasValue(rawValue)) return fallback;
  const value = String(rawValue).trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error('LLM_LOG_ENABLED and DEBUG_AUTO_PLAY_SAVE_EXPERIENCE must be boolean');
}

function parsePositiveInt(rawValue, fallback, name) {
  if (!hasValue(rawValue)) return fallback;
  const text = String(rawValue).trim();
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function parseDebugAutoPlay(env) {
  if (!hasValue(env.DEBUG_AUTO_PLAY_NAME)) return null;
  const mode = hasValue(env.DEBUG_AUTO_PLAY_MODE) ? String(env.DEBUG_AUTO_PLAY_MODE).trim() : 'llm-advanced';
  const modes = new Set(['llm-basic', 'llm-advanced', 'local-simple', 'local-normal', 'local-hard', 'local-hell']);
  if (!modes.has(mode)) throw new Error('DEBUG_AUTO_PLAY_MODE is invalid');
  return Object.freeze({
    name: String(env.DEBUG_AUTO_PLAY_NAME).trim().slice(0, 24),
    mode,
    delayMs: parsePositiveInt(env.DEBUG_AUTO_PLAY_DELAY_MS, 900, 'DEBUG_AUTO_PLAY_DELAY_MS'),
    maxTurns: parsePositiveInt(env.DEBUG_AUTO_PLAY_MAX_TURNS, 200, 'DEBUG_AUTO_PLAY_MAX_TURNS'),
    saveExperience: parseBoolean(env.DEBUG_AUTO_PLAY_SAVE_EXPERIENCE, false),
  });
}

function validateUrl(rawUrl) {
  const urlText = String(rawUrl).trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(urlText);
  } catch {
    throw new Error('LLM_API_URL must be a valid http or https URL');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('LLM_API_URL must use http or https');
  }
  return urlText;
}

export function loadLlmConfig(env = process.env) {
  const values = Object.fromEntries(REQUIRED_KEYS.map((key) => [key, env[key]]));
  const missing = REQUIRED_KEYS.filter((key) => !hasValue(values[key]));
  if (missing.length === REQUIRED_KEYS.length) {
    return Object.freeze({
      enabled: false,
      apiKey: undefined,
      apiUrl: undefined,
      model: undefined,
      advancedModel: undefined,
      reflectionModel: undefined,
      timeoutMs: parseTimeout(env.LLM_TIMEOUT_MS),
      reasoningEfforts: parseReasoningEfforts(env.LLM_REASONING_EFFORTS),
      extraBody: freezeDeep({}),
      logEnabled: parseBoolean(env.LLM_LOG_ENABLED, true),
      logDirectory: hasValue(env.LLM_LOG_DIR) ? String(env.LLM_LOG_DIR).trim() : 'data/logs/llm',
      debugAutoPlay: parseDebugAutoPlay(env),
    });
  }
  if (missing.length > 0) {
    throw new Error(`Missing required LLM configuration variables: ${missing.join(', ')}`);
  }

  const model = String(values.LLM_MODEL).trim();
  const advancedModel = hasValue(env.LLM_ADVANCED_MODEL)
    ? String(env.LLM_ADVANCED_MODEL).trim()
    : model;
  const reflectionModel = hasValue(env.LLM_REFLECTION_MODEL)
    ? String(env.LLM_REFLECTION_MODEL).trim()
    : advancedModel;

  return Object.freeze({
    enabled: true,
    apiKey: String(values.LLM_API_KEY).trim(),
    apiUrl: validateUrl(values.LLM_API_URL),
    model,
    advancedModel,
    reflectionModel,
    timeoutMs: parseTimeout(env.LLM_TIMEOUT_MS),
    reasoningEfforts: parseReasoningEfforts(env.LLM_REASONING_EFFORTS),
    extraBody: freezeDeep(parseExtraBody(env.LLM_REQUEST_EXTRA_JSON)),
    logEnabled: parseBoolean(env.LLM_LOG_ENABLED, true),
    logDirectory: hasValue(env.LLM_LOG_DIR) ? String(env.LLM_LOG_DIR).trim() : 'data/logs/llm',
    debugAutoPlay: parseDebugAutoPlay(env),
  });
}

export function publicLlmConfig(config) {
  return Object.freeze({
    enabled: config.enabled,
    baseModel: config.model,
    advancedModel: config.advancedModel,
    reflectionModel: config.reflectionModel,
    reasoningEfforts: ['off', ...(config.reasoningEfforts || DEFAULT_REASONING_EFFORTS)],
  });
}
