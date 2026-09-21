const REQUIRED_KEYS = ['LLM_API_KEY', 'LLM_API_URL', 'LLM_MODEL'];
const PROTECTED_EXTRA_FIELDS = ['model', 'messages', 'response_format', 'stream'];

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
  if (!hasValue(rawValue)) return 20000;
  const text = String(rawValue).trim();
  const timeoutMs = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('LLM_TIMEOUT_MS must be a positive integer');
  }
  return timeoutMs;
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
      timeoutMs: 20000,
      extraBody: freezeDeep({}),
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
    extraBody: freezeDeep(parseExtraBody(env.LLM_REQUEST_EXTRA_JSON)),
  });
}

export function publicLlmConfig(config) {
  return Object.freeze({
    enabled: config.enabled,
    baseModel: config.model,
    advancedModel: config.advancedModel,
    reflectionModel: config.reflectionModel,
  });
}
