const PROTECTED_BODY_FIELDS = ['model', 'messages', 'response_format', 'stream'];
const VALID_MESSAGE_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'function']);
const INTERNAL_ERRORS = new WeakSet();

function createError(code, message, extras = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  INTERNAL_ERRORS.add(error);
  return error;
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function safeText(value, apiKey, messages = []) {
  let text = String(value ?? '');
  const serializedMessages = messages.length > 0 ? JSON.stringify(messages) : null;
  if (serializedMessages) text = text.split(serializedMessages).join('[REDACTED]');
  for (const message of messages) {
    if (message && typeof message.content === 'string' && message.content) {
      const serializedMessage = JSON.stringify(message);
      if (serializedMessage) text = text.split(serializedMessage).join('[REDACTED]');
      const serializedContent = JSON.stringify(message.content);
      if (serializedContent) text = text.split(serializedContent).join('[REDACTED]');
    }
  }
  if (hasText(apiKey)) {
    text = text.split(String(apiKey)).join('[REDACTED]');
  }
  text = text.replace(/authorization\s*:\s*[^\s"'`,}]+/gi, '[REDACTED]');
  text = text.replace(/authorization/gi, '[REDACTED]');
  text = text.replace(/Bearer\s+[^\s"'`,}]+/gi, 'Bearer [REDACTED]');
  for (const message of messages) {
    if (message && typeof message.content === 'string' && message.content) {
      text = text.split(message.content).join('[REDACTED]');
    }
  }
  return text;
}

const TRUSTED_CAUSE_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'ReferenceError',
  'AbortError',
  'DOMException',
  'NetworkError',
]);

function safeCause(cause, apiKey, messages) {
  const message = safeText(cause instanceof Error ? cause.message : cause, apiKey, messages);
  const result = new Error(message || 'Unknown network error');
  if (cause instanceof Error && TRUSTED_CAUSE_NAMES.has(cause.name)) result.name = cause.name;
  return result;
}

async function readBodyText(response) {
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.json === 'function') {
    const body = await response.json();
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
  return '';
}

function extractHttpMessage(rawText) {
  if (!rawText) return 'Provider returned an HTTP error';
  if (typeof rawText !== 'string') {
    try {
      rawText = JSON.stringify(rawText);
    } catch {
      rawText = String(rawText);
    }
  }
  try {
    const body = JSON.parse(rawText);
    const message = body?.error?.message ?? body?.message ?? body?.error;
    if (hasText(message)) return typeof message === 'string' ? message : JSON.stringify(message);
  } catch {
    // The provider may return plain text instead of JSON.
  }
  return rawText;
}

function validateInput({ config, model, messages }) {
  if (!config || typeof config !== 'object') {
    throw createError('LLM_INVALID_REQUEST', 'LLM request configuration is invalid');
  }
  if (config.enabled !== true || !hasText(config.apiKey) || !hasText(config.apiUrl)) {
    throw createError('LLM_JSON_PROMPT_REQUIRED', 'An enabled LLM config, model, and JSON prompt are required');
  }
  if (typeof config.apiKey !== 'string' || typeof config.apiUrl !== 'string') {
    throw createError('LLM_INVALID_REQUEST', 'LLM request configuration is invalid');
  }
  if (typeof model !== 'string') {
    throw createError('LLM_INVALID_REQUEST', 'LLM model must be a non-empty string');
  }
  if (!hasText(model)) {
    throw createError('LLM_JSON_PROMPT_REQUIRED', 'An enabled LLM config, model, and JSON prompt are required');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw createError('LLM_JSON_PROMPT_REQUIRED', 'An enabled LLM config, model, and JSON prompt are required');
  }
  if (messages.some((message) => (
    !message
    || typeof message !== 'object'
    || typeof message.role !== 'string'
    || !hasText(message.role)
    || !VALID_MESSAGE_ROLES.has(message.role)
    || typeof message.content !== 'string'
    || !hasText(message.content)
  ))) {
    throw createError('LLM_INVALID_REQUEST', 'LLM messages must contain valid role and content fields');
  }
  if (!messages.some((message) => /json/i.test(message.content))) {
    throw createError('LLM_JSON_PROMPT_REQUIRED', 'An enabled LLM config, model, and JSON prompt are required');
  }
}

export async function requestLlmJson({
  config,
  model,
  messages,
  maxTokens = 512,
  temperature = 0.2,
  signal,
  fetchImpl = fetch,
}) {
  validateInput({ config, model, messages });

  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  let timer;
  const onExternalAbort = () => {
    externallyAborted = true;
    controller.abort();
  };

  if (signal?.aborted) {
    throw createError('LLM_ABORTED', 'LLM request was cancelled');
  }
  if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });
  const timeoutMs = Number(config.timeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
  }

  const body = {
    ...(config.extraBody && typeof config.extraBody === 'object' ? config.extraBody : {}),
    model,
    messages,
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: maxTokens,
    temperature,
  };
  // Keep this explicit so a future extraBody change cannot override the protocol fields.
  for (const field of PROTECTED_BODY_FIELDS) {
    if (field === 'model') body.model = model;
    if (field === 'messages') body.messages = messages;
    if (field === 'response_format') body.response_format = { type: 'json_object' };
    if (field === 'stream') body.stream = false;
  }

  try {
    const response = await fetchImpl(config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (timedOut) throw createError('LLM_TIMEOUT', 'LLM request timed out');
    if (externallyAborted) throw createError('LLM_ABORTED', 'LLM request was cancelled');

    const status = Number(response?.status);
    const isOk = response?.ok === true || (status >= 200 && status < 300);
    if (!isOk) {
      const rawText = await readBodyText(response);
      if (timedOut) throw createError('LLM_TIMEOUT', 'LLM request timed out');
      if (externallyAborted) throw createError('LLM_ABORTED', 'LLM request was cancelled');
      const prefix = `LLM provider HTTP ${status}: `;
      const detail = safeText(String(extractHttpMessage(rawText) ?? ''), config.apiKey, messages)
        .slice(0, Math.max(0, 500 - prefix.length));
      throw createError(`LLM_HTTP_${status}`, `${prefix}${detail}`, { status });
    }

    let envelope;
    try {
      envelope = await response.json();
    } catch (cause) {
      if (timedOut) throw createError('LLM_TIMEOUT', 'LLM request timed out');
      if (externallyAborted) throw createError('LLM_ABORTED', 'LLM request was cancelled');
      if (cause instanceof SyntaxError) {
        throw createError('LLM_INVALID_JSON', 'LLM response was not valid JSON');
      }
      throw createError('LLM_NETWORK_ERROR', 'LLM network request failed', {
        cause: safeCause(cause, config.apiKey, messages),
      });
    }
    if (timedOut) throw createError('LLM_TIMEOUT', 'LLM request timed out');
    if (externallyAborted) throw createError('LLM_ABORTED', 'LLM request was cancelled');

    const choice = envelope?.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw createError('LLM_TRUNCATED', 'LLM response was truncated');
    }
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw createError('LLM_EMPTY_CONTENT', 'LLM response content was empty');
    }
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      throw createError('LLM_INVALID_JSON', 'LLM response content was not valid JSON');
    }
    return {
      data,
      usage: envelope.usage ?? null,
      finishReason: choice?.finish_reason ?? null,
    };
  } catch (error) {
    if (timedOut) throw createError('LLM_TIMEOUT', 'LLM request timed out');
    if (externallyAborted) throw createError('LLM_ABORTED', 'LLM request was cancelled');
    if (error && typeof error === 'object' && INTERNAL_ERRORS.has(error)) {
      throw error;
    }
    throw createError('LLM_NETWORK_ERROR', 'LLM network request failed', {
      cause: safeCause(error, config.apiKey, messages),
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
