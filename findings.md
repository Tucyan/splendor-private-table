# Findings

## Starting State
- The repository is dependency-free Node.js ESM and uses `node:test`.
- Baseline on 2026-09-18: 87 tests passed, 0 failed, in about 11.6 seconds.
- The checkout started on `main` one commit ahead of origin with untracked AI plan and local-AI prerequisite files; no existing tracked changes were overwritten.
- `src/local-ai.js` and `test/local-ai.test.js` already contain an opt-in implementation and extensive legality/information-boundary tests, but no room or UI route uses it yet.
- Current room modes are only `deepseek` and `local`; pending steps always call the frozen `localAction`.
- The current UI directly submits the mode from the first AI dialog. The requested design requires a second menu after clicking the invite action.

## Compatibility Boundary
- Frozen `src/ai.js` SHA-256: `887EC85897D2693456F6ECAE9E026B2F263798BFF9A82E2620BF69237E6DA388`.
- Existing `mode: deepseek` is the compatibility route.
- Runtime DeepSeek advanced memory must be ignored under `data/ai-memory/deepseek-advanced/`.

## Risks to Verify
- The local AI plan requires benchmark evidence before making a stronger mode default; the menu can expose explicit choices without asserting a guaranteed strength gradient.
- Advanced context must never serialize the full game or raw game log because those contain hidden identities.
- Windows snapshot replacement must preserve the old authoritative file when rename/replace fails.
- Room deletion and reset must not erase persisted reflection jobs or immutable end snapshots.
- `game.js::endAction` contains one hard-coded `15` in the branch that leaves a pending noble/discard step; the AI plans require custom finish-score correctness, so a focused regression test is needed before changing this rule path.
- `RoomStore.publish()` immediately schedules the next AI turn, while finish/reset/delete paths cancel tasks independently. Reflection capture needs a single idempotent transition hook rather than scattered fire-and-forget calls.

## Completed Routing Review
- The first dialog is now an invitation/continuation step; the second dialog presents all six choices.
- `local` is normalized to `local-simple`; local normal/hard/hell use the bounded opt-in evaluator, including pending noble/discard decisions.
- Both DeepSeek modes are key-gated and have independent chooser injection points. The advanced production default remains a temporary placeholder until the dedicated advanced entry task.
- Independent spec review approved the routing. Independent quality review found no Critical/Important issues; full suite at this checkpoint was 99/99.

## Local Benchmark Evidence
- The quick benchmark is a paired design: 3 unique fixed decks (one per player count), each reused across four mode rotations; it is not 12 independent deck samples.
- With maxSteps raised to 240, the single required default run completed 12/12 games in about 8.9 seconds, with no errors and a roughly 90.5% truncated-search rate.
- The high truncation rate means quick results describe constrained-budget behavior, not full hard/hell search strength; no strategy weights were changed.
- The runner now has a 30-second default whole-run deadline and 600-second hard ceiling, with explicit timeout/skipped accounting and attempted-game denominators.

## Advanced Context Evidence
- Advanced observation/context/evaluation tests now cover public reserve identity tracking, blind reserve masking, opponent identity binding, bounded plans/experiences/tactics, exact legal token-taking estimates, custom finish scores, endgame threats, pending noble/discard resolution, hidden-identity invariance, and room cleanup.
- Quality review found and the implementation fixed unbounded null-cache growth, missing truncated flags on threat search, unbounded tactical expected-actions fields, and missing manual-finish observation.

## Memory Store Evidence
- `AiMemoryStore` persists schema-v1 snapshots, jobs, and episodes under the configurable advanced-memory directory.
- Locking uses a same-process FIFO queue plus token-owned `mkdir` lock; lock-local reads merge the latest revision before atomic replacement.
- Tests cover two real Node processes, live/dead lock owners, corrupt primary/backup recovery, replacement failure preservation, retry cap, and idempotent processed game IDs.

## Reflection and Advanced Decision Evidence
- Reflection snapshots cap public evidence and observers, response lessons are limited to candidate entries, missing keys skip network calls, and room finish/action transitions enqueue durable episodes/jobs without blocking the game loop.
- `chooseAdvancedAction` constructs bounded context/tactical facts, sends only indexed legal actions, validates the returned index, honors abort/timeout, and falls back to a separate local action.
