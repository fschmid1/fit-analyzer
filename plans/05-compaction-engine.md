# Architecture Deepening: Compaction Engine

Extract the thread compaction logic from `routes/trainer.ts` (lines 1003–1391) into its own deep module with a single seam.

---

## Why

Compaction is ~250 LOC of self-contained logic — budget computation, batch summarization, oversized-message handling, thread reconstruction — inlined in the trainer route with no seam. It has zero tests and can't be tested without a running server, a live LLM, and a populated database.

## Current state

**Inlined in:** `apps/server/src/routes/trainer.ts` (lines 1003–1391)

**Sub-pieces (all module-private):**
- `estimateTokenLength(text)` — `Math.ceil(len / APPROX_CHARS_PER_TOKEN)`
- `messageTokenLength(m)` — content + toolCall JSON size
- `computeRecentKeepWindow(allMessages, targetContextTokens, reserveTokens)` — two-pass: keep 4 most-recent per role, then shrink tail if over budget → `{ keepEndIds, cutoffIndex }`
- `formatMessageForCompaction(m)` — flattens to `**Athlete/Coach:** …` with tool list
- `buildCompactionPrompt(messagesText)`, `truncateSummary(text)`
- `fetchCompactionSummary(providerConfig, model, prompt)` — non-streaming chat completion (240s timeout)
- `summarizeBatch(toCompact, providerConfig, model)` — single call if under `COMPACTION_MAX_PROMPT_TOKENS`, else chunk + summarize + merge
- `POST /compact/:threadId` handler — dedupes via `activeCompactions` Map, loads thread, computes keep window, summarizes, constructs new messages, creates new thread in a transaction

**Budget constants (lines 107–123):**
```
COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE = 4
COMPACTION_MAX_CONTEXT_TOKENS = 200_000
COMPACTION_RESERVE_TOKENS    = 62_144
COMPACTION_KEPT_BUDGET_TOKENS = 137_856
COMPACTION_MAX_PROMPT_TOKENS  = 24_000
MAX_KEPT_MESSAGE_TOKENS       = 34_464
COMPACTION_MAX_SUMMARY_TOKENS = 4_000
```

**Coupling inside the route:**
- `db` — ~4 prepared statements (`getThreadByIdStmt`, `createThreadStmt`, `insertMessageStmt`, `getMessagesStmt`)
- `getCoachModelSettings` / `resolveThreadModel` — model resolution
- `getProviderConfig` — provider config + API key
- `activeCompactions` Map — dedup keyed `${userId}:${threadId}`

## Target

**New file:** `apps/server/src/lib/compactionEngine.ts`

**Interface:**
```typescript
interface CompactionOptions {
  model: string;
  providerConfig: ProviderConfig;
  // Injected — testable with a fake
  fetchSummary: (prompt: string) => Promise<string>;
  // Optional — for integration use
  abortSignal?: AbortSignal;
}

interface CompactionResult {
  compacted: boolean;
  messages: TrainerMessage[];
  removed: number;
}

async function compactMessages(
  allMessages: TrainerMessage[],
  options: CompactionOptions
): Promise<CompactionResult>;
```

**Implementation absorbs:**
- All budget constants
- `estimateTokenLength`, `messageTokenLength`
- `computeRecentKeepWindow`
- `formatMessageForCompaction`, `buildCompactionPrompt`, `truncateSummary`
- `summarizeBatch` (uses injected `fetchSummary`)
- Oversized-message second pass
- New-message construction (summary messages + kept messages with fresh UUIDs)

**Stays in the route:**
- `activeCompactions` Map (dedup — this is HTTP concurrency, not compaction logic)
- Thread loading from DB
- New thread creation in transaction
- Model + provider resolution
- HTTP response shape

The route handler becomes:
```typescript
// POST /compact/:threadId
const result = await compactMessages(allMessages, {
  model, providerConfig,
  fetchSummary: (prompt) => fetchCompactionSummary(providerConfig, model, prompt),
  abortSignal,
});
if (!result.compacted) return c.json({ compacted: false });
// create new thread + insert result.messages in transaction
```

## What tests survive

The compaction module's interface is pure: messages in, messages out, with an injected `fetchSummary`.

- **Budget math:** `computeRecentKeepWindow` with known message arrays — assert keep/cutoff indices
- **Token estimation:** `messageTokenLength` with tool calls, long content, empty messages
- **Batching:** `summarizeBatch` with messages under/over `COMPACTION_MAX_PROMPT_TOKENS` — assert single call vs chunked
- **Oversized handling:** a kept message exceeding `MAX_KEPT_MESSAGE_TOKENS` — assert it's summarized
- **New-message construction:** summary messages get `createdAt` < first kept message; kept messages get fresh UUIDs
- **Edge cases:** empty `toCompact` → `{compacted: false}`; all messages fit → no summary

All testable with a fake `fetchSummary` that returns canned text. No DB, no LLM, no server.

## Files to touch

- `apps/server/src/lib/compactionEngine.ts` (new — ~250 LOC moved + interface)
- `apps/server/src/routes/trainer.ts` (remove ~250 LOC, replace with `compactMessages` call)
- `apps/server/src/lib/compactionEngine.test.ts` (new — first tests in the repo)

## Dependencies

- Blocked by: none
- Blocks: none
- Related: plan 10 (provider config extraction — `fetchCompactionSummary` moves there or stays as a helper)

## Effort

~1 session. The logic already exists; this is a move + interface design + first tests.