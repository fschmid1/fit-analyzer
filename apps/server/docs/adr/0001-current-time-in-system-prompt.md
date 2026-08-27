# Current time lives in the system prompt, not a tool

The trainer chat model must know "now" to resolve relative dates ("yesterday's ride", "last week"), but
instructing it to call a `current_time` tool first did not work: models frequently skipped the call or
misread the tool result and placed events days in the past. The current UTC date and time is injected
inline at the end of the trainer chat system prompt on every request, and the `current_time` tool was
deleted along with every "call current_time first" instruction in other tool descriptions — one source
of truth, no wasted roundtrip.

## Considered Options

- **Tool-only (status quo ante, June 2026)**: `current_time` tool + "MUST call FIRST" mandate. Rejected:
  big hosted models ignored the mandate in practice, anchoring on stale training-data dates instead.
- **Inline timestamp only (chosen)**: prompt is rebuilt per request via `buildSystemPrompt`, so the
  timestamp never goes stale within a thread; the mandate roundtrip disappears.
- **Client-supplied local time + IANA timezone**: correct for relative-date resolution at UTC-midnight
  boundaries for athletes far from UTC. Deferred: adds plumbing (web → server) for a rare edge case.
  Revisit if relative-date bugs appear near midnight for non-UTC athletes.

## Consequences

- Every trainer chat request recomputes the timestamp; system prompts differ per request, so exact
  prefix-level prompt caching is reduced to whatever prefix the variable-free `BASE_SYSTEM_PROMPT` covers.
- Date parsing for tool date strings is UTC everywhere via the shared `parseUtcMidnight` helper
  (`apps/server/src/lib/tools/activityUtils.ts`); the prompt timestamp is UTC too.
- The analysis prompt (`/analyze/:activityId`) deliberately has no timestamp: it targets one known
  activity and needs no "now".