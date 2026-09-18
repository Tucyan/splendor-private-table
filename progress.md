# Progress

## 2026-09-18
- Read both implementation plans and the project instructions.
- Read the branch isolation, plan execution, subagent development, TDD, review, and verification workflows.
- Recovered the prior completed planning files and replaced them with records for the current AI work.
- Inspected the current room scheduler, server mode entry, UI invitation dialog, frozen DeepSeek entry, and opt-in local strategy implementation.
- Ran the clean baseline: 87 tests passed, 0 failed.
- Created branch `codex/ai-strategy-optimization` while preserving all untracked prerequisite files.
- Recorded the frozen `src/ai.js` SHA-256.
- Dispatched the first TDD implementation subagent for the combined difficulty menu, local strategy routing, DeepSeek basic compatibility, and advanced dependency injection.
- Inspected the full room scheduler and rules engine to identify the future reflection transition point and a custom-score pending-step regression risk.
- Completed the combined routing task through TDD, spec-review repair, and code-quality review.
- Verified the two-step menu, six modes, compatibility aliases, key gating, pending routing, fallback/cancellation behavior, and frozen `src/ai.js` hash.
- Fresh focused verification passed 57/57; the independent quality reviewer ran the full suite at 99/99.
- Completed the local benchmark task through TDD and two review repair loops.
- Added reproducible quick/full paired schedules, legal state simulation, detailed metrics, CLI safety caps, whole-run deadline, timeout/skipped accounting, and documentation.
- The one default quick run completed 12/12 in about 8.9 seconds; no heuristic weights were changed because the small, heavily truncated sample is not strength evidence.
- Completed advanced observation/context/evaluation with two review repair loops; focused verification passed 52/52 after the final boundedness fixes.
- Completed persistent memory store and lock protocol; 16/16 memory tests pass, including real child-process contention and recovery cases.
- Added bounded reflection snapshots/coordinator and integrated durable end-job enqueue on advanced-game finishes and actions.
- Added the production advanced DeepSeek chooser with bounded context, legal-index validation, timeout/cancellation, and independent fallback.
- Full `npm run check` verification: 159 tests passed, 0 failed.
- Updated compatibility/documentation assertions for the now-real advanced chooser and re-ran the full suite: 159/159 passed.
- Final SHA-256 verification for frozen `src/ai.js`: `887EC85897D2693456F6ECAE9E026B2F263798BFF9A82E2620BF69237E6DA388`.
- Confirmed `data/ai-memory/deepseek-advanced/` is ignored by Git and no runtime snapshot entered the worktree status.
