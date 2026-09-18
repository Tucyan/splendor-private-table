# Splendor AI Strategy and DeepSeek Advanced Implementation

## Goal
Complete both AI plans: expose a second-step AI difficulty picker after “邀请一位 AI 商人”, connect the local simple/normal/hard/hell strategies, and add fully isolated DeepSeek basic/advanced modes with observable tactical context, persistent post-game learning, synchronization, recovery, benchmarking, and documentation.

## Fixed Decisions
- Work on branch `codex/ai-strategy-optimization` in the existing checkout so current untracked prerequisite files are preserved.
- `src/ai.js` is frozen at SHA-256 `887EC85897D2693456F6ECAE9E026B2F263798BFF9A82E2620BF69237E6DA388`.
- Clicking “邀请 AI 入座” opens a new difficulty/type menu containing local simple/normal/hard/hell and DeepSeek basic/advanced choices.
- Existing `mode: deepseek` remains the basic mode; omitted mode remains compatible with the basic DeepSeek route.
- Feature code follows test-first development; each implementation task receives spec and quality review before progression.

## Phases
| Phase | Status | Notes |
|---|---|---|
| 1. Review plans, preserve baseline, define routing | complete | Two-step six-mode menu and routes passed spec/quality review; focused 57/57 and full 99/99 passed; frozen hash unchanged. |
| 2. Local AI benchmark, tuning, and UI/server integration | complete | Default paired quick benchmark completes 12/12 under a 30s global deadline; statistics and docs passed spec/quality review. |
| 3. DeepSeek basic compatibility and advanced observation/evaluation | complete | Public observation, bounded context, tactical facts, target invalidation, finish-score regression, cleanup, and budget flags passed spec/quality repair. |
| 4. Persistent memory locking, reflection lifecycle, and sync barrier | complete | Memory store, jobs/episodes, bounded reflection coordinator, end snapshots, and room finish enqueue are implemented and tested. |
| 5. Advanced DeepSeek decision entry and fallback | complete | Independent advanced chooser now builds bounded context, validates action index, supports timeout/cancel, and falls back independently. |
| 6. Benchmarks, documentation, full verification, final review | complete | `npm run check` passed 159/159; hash, runtime ignore, docs, and focused advanced/reflection tests verified. |

## Acceptance Checklist
- [x] Difficulty/type selection appears only after choosing to invite an AI merchant.
- [x] Local simple/normal/hard/hell modes select only original legal actions and obey information boundaries.
- [x] DeepSeek basic request behavior and `src/ai.js` bytes remain unchanged.
- [x] Advanced public observation/context/evaluation never exposes hidden deck or opponent reserve identities.
- [x] Persistent memory uses FIFO + token lock + atomic replacement, backups, recovery and idempotent game IDs.
- [x] Reflection snapshots/jobs are bounded, key-gated, retry-capped and visible to the room lifecycle.
- [x] Advanced chooser consumes bounded context and validates model action indices with independent fallback.
- [x] DeepSeek advanced uses tactical facts, public observations, bounded in-game plans, and relevant persistent lessons.
- [x] One game ID produces at most one committed learning result, including restart/recovery cases.
- [x] Memory writes use FIFO serialization, a token-owned directory lock, lock-local re-read/merge, backup validation, and atomic replacement.
- [x] Reflection status and synchronization failures are visible; basic/local games never wait on advanced reflection.
- [x] Benchmarks report sample size, seats, timing, truncation/fallback, and do not claim strength without evidence.
- [x] All focused tests and `npm run check` pass (172/172); runtime memory and temporary data remain untracked.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| Planning-file replacement patch targeted each file twice | 1 | Deleted and re-added the three files in separate patch operations. |
| PowerShell passed `src/ai-advanced-*.js` as a literal path to ripgrep | 1 | Re-ran ripgrep on `src`/`test` directories with `-g` filters. |
