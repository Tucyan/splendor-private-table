# LLM Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可追溯且默认脱敏的 LLM 日志系统，能够定位高级 AI 每次兜底、每次重试、请求失败和赛后经验同步失败的具体原因。

**Architecture:** 在 LLM 客户端边界生成一次 `requestId`，所有请求、响应、重试和失败事件携带 `requestId`、`gameId`、`playerId`、`turn`、`attempt` 和 `phase`。日志以结构化 JSONL 写入独立目录，同时向 systemd journal 输出一行摘要；prompt、API Key、Authorization、完整模型内容和玩家隐私不写入日志。经验反思沿用持久化 job/episode，但将失败状态、错误码、尝试次数和最后失败时间写入 job，并在房间快照中只暴露安全摘要。

**Tech Stack:** Node.js 22+、原生 `fs/promises`、systemd journal、Node 内置 `node:test`，不新增日志依赖。

---

### Task 1: 定义脱敏日志配置与事件写入器

**Files:**
- Create: `src/llm-logger.js`
- Modify: `src/llm-config.js`
- Modify: `.env.example`
- Test: `test/llm-logger.test.js`

- [ ] **Step 1: Write the failing tests for event shape, redaction, and disabled logging**

```js
test('writes one structured event without secrets or prompt contents', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-llm-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = new LlmLogger({ directory, apiKey: 'secret-key' });
  await logger.write({
    type: 'llm.response', requestId: 'req-1', gameId: 'game-1',
    prompt: 'private prompt', authorization: 'Bearer secret-key',
    data: { finishReason: 'stop', content: '{"actionIndex":0}' },
  });
  const lines = (await readFile(join(directory, 'llm-events.jsonl'), 'utf8')).trim().split('\n');
  const event = JSON.parse(lines[0]);
  assert.equal(event.requestId, 'req-1');
  assert.equal(Object.hasOwn(event, 'prompt'), false);
  assert.equal(JSON.stringify(event).includes('secret-key'), false);
  assert.equal(JSON.stringify(event).includes('actionIndex'), false);
  assert.equal(event.data.finishReason, 'stop');
});

test('disabled logger does not create a log file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'splendor-llm-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logger = new LlmLogger({ directory, enabled: false });
  await logger.write({ type: 'llm.request', requestId: 'req-2' });
  await assert.rejects(readFile(join(directory, 'llm-events.jsonl'), 'utf8'), { code: 'ENOENT' });
});
```

- [ ] **Step 2: Run the logger tests and verify the expected failure**

Run: `node --test test/llm-logger.test.js`

Expected: FAIL because `src/llm-logger.js` and `LlmLogger` do not exist yet.

- [ ] **Step 3: Implement the minimal structured logger**

Implement `LlmLogger` with this public contract:

```js
new LlmLogger({ directory, enabled = true, apiKey, maxBytes = 10 * 1024 * 1024 })
await logger.write({ type, level = 'info', requestId, gameId, playerId, turn, attempt, phase, data })
```

The implementation must:

1. Add `timestamp` and `pid` to every event.
2. Keep only the allowlisted top-level keys `timestamp`, `pid`, `level`, `type`, `requestId`, `gameId`, `playerId`, `turn`, `attempt`, `phase`, `durationMs`, `status`, `reasonCode`, `data`.
3. Keep `data` to JSON-safe scalar fields and bounded arrays; never accept `prompt`, `messages`, `authorization`, `apiKey`, `content`, `body`, or `stack`.
4. Redact the configured API key from serialized values before writing.
5. Append one JSON object per line with mode `0o600`, create the directory lazily, and serialize writes through an internal promise queue.
6. If the file exceeds `maxBytes`, rename it to `llm-events.previous.jsonl` and start a new file; retain only that one previous file.
7. Swallow logging failures after writing a one-line `console.error('[llm-log] write failed')` summary so logging cannot break a game.

Extend `loadLlmConfig` with `LLM_LOG_DIR` (default `data/logs/llm`) and `LLM_LOG_ENABLED` (default `true`), and include these only in the private config object, never in `publicLlmConfig`.

- [ ] **Step 4: Run the logger tests and config tests**

Run: `node --test test/llm-logger.test.js test/llm-config.test.js`

Expected: PASS with no secret text in the generated JSONL.

- [ ] **Step 5: Document the new environment variables**

Add to `.env.example`:

```dotenv
LLM_LOG_ENABLED=true
LLM_LOG_DIR=data/logs/llm
```

- [ ] **Step 6: Commit the logging foundation**

```bash
git add src/llm-logger.js src/llm-config.js test/llm-logger.test.js test/llm-config.test.js .env.example
git commit -m "feat: add redacted structured LLM logger"
```

### Task 2: Instrument provider requests and advanced decision retries

**Files:**
- Modify: `src/llm-client.js`
- Modify: `src/ai-advanced.js`
- Modify: `src/rooms.js`
- Test: `test/llm-client.test.js`
- Test: `test/ai-advanced.test.js`
- Test: `test/rooms.test.js`

- [ ] **Step 1: Add failing assertions for request correlation and failure metadata**

Add tests that inject a logger and assert:

```js
assert.deepEqual(events.map(event => event.type), [
  'llm.request', 'llm.response', 'llm.request', 'llm.response',
]);
assert.equal(events[0].requestId, events[1].requestId);
assert.equal(events[2].attempt, 2);
assert.equal(events[2].data.previousReasonCode, 'LLM_INVALID_ACTION');
assert.equal(events.at(-1).data.actionIndex, 0);
```

Add a provider-error test asserting that `LLM_HTTP_503`, `LLM_TIMEOUT`, `LLM_TRUNCATED`, `LLM_INVALID_JSON`, `LLM_EMPTY_CONTENT`, and `LLM_INVALID_ACTION` are preserved as `reasonCode`, while the API key and response body are absent.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test test/llm-client.test.js test/ai-advanced.test.js test/rooms.test.js`

Expected: FAIL because no request-level logger is injected and no event metadata is emitted.

- [ ] **Step 3: Instrument `requestLlmJson` at the network boundary**

Extend its options with `logger`, `requestId`, `correlation`, and `phase`. Generate a UUID when the caller does not provide one. Emit:

```js
{ type: 'llm.request', phase, attempt, model, data: {
  messageCount, promptChars, hasMaxTokens, maxTokens, temperature
} }
```

Before every return or throw emit exactly one matching `llm.response` or `llm.error` event:

```js
{ type: 'llm.response', status, durationMs, data: {
  finishReason, responseChars, usage: { promptTokens, completionTokens, totalTokens }
} }
```

or:

```js
{ type: 'llm.error', reasonCode, status, durationMs, data: { safeMessage } }
```

Never include `messages`, serialized response content, headers, URL query strings, or provider bodies. Keep response usage keys numeric and optional.

- [ ] **Step 4: Pass context from `chooseAdvancedAction` and retain retry diagnostics**

Generate one `requestId` per model call, pass `attempt` and `phase: 'advanced-decision'`, and return these safe fields with fallback results:

```js
{
  source: 'llm-advanced-fallback',
  reasonCode,
  attempts,
  requestIds,
  lastFailure: { reasonCode, message }
}
```

The message must contain only the bounded error reason and invalid action index; it must not contain the prompt or API key. Keep the existing three-attempt behavior and the existing error context sent to the model.

- [ ] **Step 5: Preserve decision metadata in `RoomStore` and the UI-safe snapshot**

In `scheduleAI`, distinguish these cases in events and status:

1. LLM returned an invalid action after all retries: `LLM_INVALID_ACTION`.
2. LLM transport/provider failed: the original `LLM_*` code.
3. `applyAction` or server-side adapter failed after a valid response: `AI_APPLY_ACTION_ERROR`.

Set `aiStatus.attempts`, `aiStatus.reasonCode`, `aiStatus.requestIds`, and a bounded `aiStatus.lastFailure`; do not expose prompt, body, key, or stack. Emit `ai.fallback` with `gameId`, `playerId`, `turn`, and `reasonCode` before applying the local action.

- [ ] **Step 6: Run all decision tests**

Run: `node --test test/llm-client.test.js test/ai-advanced.test.js test/rooms.test.js test/llm-basic-compat.test.js`

Expected: PASS; fallback tests must assert both behavior and reason metadata.

- [ ] **Step 7: Commit decision observability**

```bash
git add src/llm-client.js src/ai-advanced.js src/rooms.js test/llm-client.test.js test/ai-advanced.test.js test/rooms.test.js test/llm-basic-compat.test.js
git commit -m "feat: trace LLM decisions and fallback reasons"
```

### Task 3: Make reflection failures durable and diagnosable

**Files:**
- Modify: `src/ai-reflection.js`
- Modify: `src/ai-memory-store.js`
- Modify: `src/rooms.js`
- Modify: `public/reflection-status.js`
- Test: `test/ai-reflection-lifecycle.test.js`
- Test: `test/ai-memory-store.test.js`
- Test: `test/reflection-status.test.js`

- [ ] **Step 1: Add failing lifecycle tests for persisted failure details**

Add a test with a fake provider returning HTTP 503 and assert:

```js
const result = await coordinator.reflect(snapshot('failed-game'));
assert.equal(result.reasonCode, 'LLM_HTTP_503');
const job = await store.loadJob('failed-game');
assert.equal(job.status, 'failed');
assert.equal(job.attempts, 1);
assert.equal(job.lastError.reasonCode, 'LLM_HTTP_503');
assert.equal(typeof job.lastError.at, 'string');
assert.equal(JSON.stringify(job).includes('api-key'), false);
```

Add a room test asserting the final snapshot contains `reflectionStatus.state === 'failed'`, `reasonCode`, `attempts`, and `gameId`, while not containing provider body or key.

- [ ] **Step 2: Run the reflection tests and verify the new assertions fail**

Run: `node --test test/ai-reflection-lifecycle.test.js test/ai-memory-store.test.js test/reflection-status.test.js`

Expected: FAIL because failed jobs currently retain only a string error and `queueReflection` drops the result metadata.

- [ ] **Step 3: Extend job records with bounded failure metadata**

Change `recordJobAttempt`/`saveJob` payloads to persist:

```js
lastError: {
  reasonCode: 'LLM_HTTP_503',
  message: 'LLM provider HTTP 503: ...',
  at: '2026-09-22T00:00:00.000Z'
}
```

Normalize `message` to 400 characters, strip API keys and response bodies, and preserve only the latest error. Set `status: 'failed'` when attempts reach `maxAttempts`; set `status: 'pending'` otherwise. Keep existing idempotency and lock behavior.

- [ ] **Step 4: Instrument reflection request and commit lifecycle**

Use `phase: 'reflection'` and emit `reflection.queued`, `reflection.attempt`, `reflection.failed`, `reflection.committed`, and `reflection.skipped` events with `gameId`, `requestId`, `attempt`, `reasonCode`, operation count, and duration. `reflection.committed` must include `lessonsAddedOrChanged` and never include lesson text.

- [ ] **Step 5: Propagate safe reflection status to `RoomStore` and frontend**

Make `queueReflection` retain the result summary:

```js
reflectionStatus = {
  state: 'failed', status: 'failed', gameId,
  reasonCode, attempts, lastErrorAt
};
```

Use `state: 'saved'` only after `applyReflection` commits successfully. Keep `null` for host/stalemate/non-normal termination. Update `reflectionStatusView` to display a generic error plus a non-secret reason label; do not display raw provider messages.

- [ ] **Step 6: Run reflection and memory tests**

Run: `node --test test/ai-reflection-lifecycle.test.js test/ai-memory-store.test.js test/reflection-status.test.js`

Expected: PASS, including no-experience-commit tests for aborted games and failed reflections.

- [ ] **Step 7: Commit reflection observability**

```bash
git add src/ai-reflection.js src/ai-memory-store.js src/rooms.js public/reflection-status.js test/ai-reflection-lifecycle.test.js test/ai-memory-store.test.js test/reflection-status.test.js
git commit -m "feat: persist reflection failure diagnostics"
```

### Task 4: Add service-level log access and operational documentation

**Files:**
- Modify: `src/server.js`
- Modify: `deploy/splendor.service`
- Modify: `deploy/update.sh`
- Modify: `.env.example`
- Modify: `README.md`
- Test: `test/server.test.js`

- [ ] **Step 1: Add a failing health/logging configuration test**

Assert that `createServer` passes the configured logger into `RoomStore`, that `/api/health` remains secret-free, and that `LLM_LOG_DIR` is not present in a public room snapshot.

- [ ] **Step 2: Wire one process logger into the server**

Create the logger once in `createServer`, pass it to `RoomStore`, and close/flush it on `server.close`. Keep `console.log` startup output limited to enabled/disabled state and never print the endpoint, key, or model credentials.

- [ ] **Step 3: Configure the systemd service and update script**

Ensure the service has a writable private log directory under `/var/lib/splendor/logs/llm` or the configured `LLM_LOG_DIR`, with ownership `splendor:splendor` and mode `0700`. The update script must preserve `/etc/splendor.env`, create the configured log directory after deployment, and include a smoke check that the logger can append one redacted event without exposing its content in stdout.

- [ ] **Step 4: Document investigation commands**

Add exact commands to `README.md`:

```bash
journalctl -u splendor --since '1 hour ago' -o cat | grep -E 'llm\\.|ai\\.|reflection\\.'
tail -f /var/lib/splendor/logs/llm/llm-events.jsonl
grep -E 'requestId|gameId|reasonCode|attempt' /var/lib/splendor/logs/llm/llm-events.jsonl
```

Document that API keys, full prompts, full completions, and provider bodies are intentionally absent.

- [ ] **Step 5: Run server tests**

Run: `node --test test/server.test.js test/llm-config.test.js`

Expected: PASS with no secret fields in any public response or startup output.

- [ ] **Step 6: Commit operational wiring**

```bash
git add src/server.js deploy/splendor.service deploy/update.sh .env.example README.md test/server.test.js test/llm-config.test.js
git commit -m "feat: expose operational LLM diagnostics safely"
```

### Task 5: End-to-end reproduction, verification, and deployment

**Files:**
- Test: `test/llm-observability.integration.test.js`
- Modify: `docs/verification.md`

- [ ] **Step 1: Add a deterministic integration test for repeated fallback and reflection failure**

Use injected `requestJson`/`fetchImpl` functions that produce:

1. Two invalid action indexes and one HTTP 503 for an advanced decision.
2. A reflection HTTP 503 after a normal game finish.

Assert the action remains legal, the fallback has `reasonCode`, exactly three advanced attempts occur, the reflection job is failed with `lastError.reasonCode`, no lessons are committed, and the JSONL event sequence contains matching `requestId` values.

- [ ] **Step 2: Run the complete local verification**

Run:

```bash
git diff --check
npm test
node --test test/llm-observability.integration.test.js
```

Expected: all tests pass, with no API key or prompt text in log files.

- [ ] **Step 3: Run a redaction audit**

Run a test fixture with an API key and prompt containing unique sentinel text, then assert:

```js
assert.equal(logText.includes(apiKey), false);
assert.equal(logText.includes(promptSentinel), false);
assert.equal(logText.includes(responseSentinel), false);
```

- [ ] **Step 4: Deploy to the server with a rollback point**

Push the implementation branch, then run:

```bash
ssh root@123.57.154.12 "cd /opt/splendor && bash deploy/update.sh --branch <implementation-branch>"
```

Expected: server-side full tests pass, service restarts, and `/api/health` returns `{"ok":true}`. Do not print `/etc/splendor.env` or any API key.

- [ ] **Step 5: Perform one real API smoke test and inspect only metadata**

Send one JSON-only request without logging its prompt or response body. Verify only HTTP status, `finish_reason`, response length, and that an `llm.response` event exists. Then remove or rotate the test event if the operational retention policy requires it.

- [ ] **Step 6: Document the final diagnosis workflow**

Update `docs/verification.md` with the correlation workflow:

```text
ai.fallback -> requestId(s) -> llm.request/llm.error -> reasonCode/attempt -> reflection.failed -> job.lastError
```

- [ ] **Step 7: Commit the verification documentation**

```bash
git add test/llm-observability.integration.test.js docs/verification.md
git commit -m "test: verify end-to-end LLM diagnostics"
```

## Self-Review Checklist

- [ ] Every reported symptom has a traceable event: repeated tactical fallback, provider failure, invalid action, retry exhaustion, reflection failure, and successful commit.
- [ ] Every event has a correlation key and bounded lifecycle metadata.
- [ ] API keys, Authorization headers, complete prompts, complete completions, and provider response bodies are excluded by construction and covered by tests.
- [ ] Aborted/non-normal games do not enqueue reflection jobs or report a false sync state.
- [ ] Failed reflection jobs remain recoverable and expose only safe reason metadata.
- [ ] The implementation has focused tests before each production change and a full end-to-end test before deployment.
