# LLM Timeout and Reasoning Strength Implementation Plan

> **For agentic workers:** Implement task-by-task with test-first changes and verify each focused test before continuing.

**Goal:** Remove the default hard timeout from LLM calls and let room hosts choose an environment-configured reasoning strength for advanced LLM players, including a disabled option.

**Architecture:** Treat `LLM_TIMEOUT_MS=0` as no request deadline and make it the default, while preserving positive values as opt-in limits. Parse `LLM_REASONING_EFFORTS` on the server, publish only validated choices, add a second advanced-LLM selection dialog, validate/store the selected value, and translate it into provider request fields (`thinking` plus optional `reasoning_effort`). Keep basic LLM calls and unrelated room/reflection lifecycle deadlines unchanged.

**Tech Stack:** Node.js 22, native `node:test`, browser JavaScript, environment-based config.

---

### Task 1: Configure unlimited request timeout and allowed reasoning strengths

**Files:**
- Modify `test/llm-config.test.js`
- Modify `src/llm-config.js`
- Modify `.env.example`

- [ ] Test timeout defaults to `0`, accepts `LLM_TIMEOUT_MS=0`, and still accepts positive explicit timeouts.
- [ ] Test `LLM_REASONING_EFFORTS` parsing, validation, fallback defaults, and always-available `off` choice.
- [ ] Run `node --test test/llm-config.test.js` and confirm the new expectations fail first.
- [ ] Implement parsing and expose the safe choice list through `publicLlmConfig`.
- [ ] Rerun the focused test and confirm it passes.

### Task 2: Pass selected strength through advanced AI requests

**Files:**
- Modify `test/ai-advanced.test.js`
- Modify `src/ai-advanced.js`
- Modify `test/rooms.test.js`
- Modify `src/rooms.js`
- Modify `src/server.js`

- [ ] Test advanced requests map `off` to disabled thinking and `low`/`high`/`max` to enabled thinking plus that effort.
- [ ] Test room AI insertion validates the selected strength against configured options and preserves the selection on the player.
- [ ] Run the focused AI and room tests red before implementing.
- [ ] Implement per-player strength propagation; leave basic LLM requests unchanged and default internal/debug players to `off`.
- [ ] Rerun the focused tests green.

### Task 3: Add the advanced-LLM reasoning submenu

**Files:**
- Modify `public/app.js`
- Modify `test/server.test.js` if public config contract coverage needs updating

- [ ] Confirm the server snapshot exposes configured choices but no provider secrets.
- [ ] When `LLM · 高级` is selected, display a second dialog with the configured efforts plus `关闭`, then POST the selected effort with `mode=llm-advanced`.
- [ ] Keep all other AI choices on the existing one-step path.
- [ ] Run focused server tests and syntax checks.

### Task 4: Verify full behavior

**Files:**
- Review changed files and `.env.example`

- [ ] Run `npm test` from the branch worktree.
- [ ] Verify `LLM_TIMEOUT_MS=0` creates no request abort timer and positive values still enforce one.
- [ ] Verify the final diff contains no `.env` secrets or unrelated runtime log changes.
