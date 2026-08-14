# Architecture Deepening: Trainer God-Module Split

Extract the six subsystems inlined in `apps/server/src/routes/trainer.ts` (1575 LOC) into separate modules, each with its own seam. This is the overarching plan — candidates 2–7 are the individual extractions.

---

## Why

`routes/trainer.ts` is the god module: 1575 LOC, ~16 endpoints, ~14 SQL statements, compaction engine (~250 LOC), token tracking + cache, thread CRUD, history pagination, import/export, analysis streaming, provider config, Kimi metadata, message sanitization. Every change to any of these subsystems touches the same file. Nothing is testable without a running server and a live LLM.

## What

Split into thin route dispatch + sub-modules:

1. **Compaction engine** — see plan 05
2. **Thread repository** — CRUD + token tracking (see plan 09)
3. **History store** — paginated GET + full-replace PUT (see plan 09)
4. **Provider config** — model resolution, `getProviderConfig`, `getKimiRequestMetadata`, `sanitizeMessagesForModel` (see plan 10)
5. **Trainer route** — thin Hono dispatch, ~100 LOC, accepts injected modules

## Implementation order

1. Extract compaction engine (plan 05) — self-contained, no route dependencies
2. Extract provider config (plan 10) — self-contained, used by both chat and compaction
3. Extract thread repo + history store (plan 09) — persistence seam
4. Route becomes dispatch-only

## Dependencies

- Blocked by: none (can start immediately)
- Blocks: none (each sub-module can ship independently)
- Related: plan 07 (persistence seam) — the thread repo and history store are the trainer-specific instances of the general pattern

## Effort

~2-3 sessions total. Each sub-module is independently shippable.