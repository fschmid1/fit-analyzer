# Architecture Deepening: Provider Stream Adapters

Extract the shared AG-UI emission skeleton from the two provider stream files, leaving only wire-format parsing as provider-specific adapters.

---

## Why

`trainerStream.ts` (OpenRouter SSE → AG-UI, 352 LOC) and `ollamaTrainerStream.ts` (Ollama NDJSON → AG-UI, 335 LOC) are structurally identical with ~80 LOC of shared emission skeleton:

**Duplicated:**
- `safeParseArgs(raw)` — byte-identical in both files
- `messageContentToString(content)` — byte-identical
- `RUN_STARTED` + eager `TEXT_MESSAGE_START` (before fetch, so tanstack creates the assistant message before STEP_FINISHED arrives)
- `STEP_STARTED`/`STEP_FINISHED` gating for reasoning/thinking content
- `TOOL_CALL_END` emission after stream ends
- `TEXT_MESSAGE_END` gating based on `requiresToolContinuation`
- Final `RUN_FINISHED` with usage mapping

**They differ only in:**
- Wire format: SSE with `data:` lines + `\n\n` split vs NDJSON with `\n` split
- Tool-call strategy: delta accumulation (OpenRouter sends partial `tool_calls` deltas) vs immediate emit (Ollama sends complete tool calls per chunk)
- Reasoning field names: `reasoning`/`reasoning_content`/`reasoning_text` vs `message.thinking`
- Usage field names: `prompt_tokens`/`completion_tokens` vs `prompt_eval_count`/`eval_count`

## Current state

**`trainerStream.ts`** (352 LOC):
- `createTrainerStream(options): AsyncGenerator<StreamChunk>`
- `parseOpenAiSse(response)` — splits on `\n\n`, parses `data:`, handles `[DONE]`
- `toOpenAiTool(tool)`, `toOpenAiMessages(systemPrompt, messages)`
- Per-chunk: reasoning (STEP_STARTED first, then STEP_FINISHED), content (TEXT_MESSAGE_CONTENT), tool_calls (delta accumulation via `toolCallAccumulators` Map + `toolCallOrder` array)
- Post-stream: TOOL_CALL_END for each, TEXT_MESSAGE_END if no tool continuation, RUN_FINISHED

**`ollamaTrainerStream.ts`** (335 LOC):
- `createOllamaTrainerStream(options): AsyncGenerator<StreamChunk>`
- `parseOllamaNdjson(response)` — splits on `\n`, flushes trailing buffer
- `toOllamaMessages` — parses tool_calls arguments from string to object (Ollama wants objects, OpenAI wants strings), adds `tool_name`
- Per-chunk: `message.thinking` (STEP_STARTED/FINISHED), `message.content` (TEXT_MESSAGE_CONTENT), `message.tool_calls` (immediate TOOL_CALL_START + optional ARGS + END, deduped by `seenToolCallIds` Set)
- `chunk.done` → usage mapping, finishReason, break

## Target

**New file:** `apps/server/src/lib/agiEmitter.ts`

**Interface:**
```typescript
interface AgiEmitterOptions {
  messageId: string;
  runId: string;
  tools?: ToolDefinition[];
}

interface AgiEmitter {
  // Lifecycle — called by the parser adapter
  start(): void;
  textStart(): void;
  textContent(content: string): void;
  textEnd(): void;
  stepStart(): void;
  stepFinished(content: string): void;
  toolCallStart(id: string, name: string): void;
  toolCallArgs(id: string, argsDelta: string): void;
  toolCallEnd(id: string, input: unknown): void;
  finished(finishReason: string, usage?: Usage): void;
  error(message: string): void;
  // The parser adapter calls this to drive emission
  chunks(): AsyncGenerator<StreamChunk>;
}
```

**Shared helpers (absorbed into emitter or a shared util):**
- `safeParseArgs`
- `messageContentToString`

**`trainerStream.ts` becomes:**
- `parseOpenAiSse(response)` — wire-format parser only
- `toOpenAiTool`, `toOpenAiMessages` — request building
- Loop: read SSE chunks → call emitter methods → yield `emitter.chunks()`

**`ollamaTrainerStream.ts` becomes:**
- `parseOllamaNdjson(response)` — wire-format parser only
- `toOllamaMessages` — request building
- Loop: read NDJSON chunks → call emitter methods → yield `emitter.chunks()`

## What tests survive

- **Emitter lifecycle:** start → textStart → textContent → textEnd → finished → assert correct chunk sequence
- **Tool call emission:** start → toolCallStart → toolCallArgs → toolCallEnd → finished with `tool_calls` → assert no TEXT_MESSAGE_END
- **STEP gating:** stepStart without prior stepStart → assert STEP_STARTED emitted; second stepStart → no duplicate
- **Usage mapping:** finished with OpenAI usage vs Ollama usage → assert correct `StreamChunk.usage`
- **safeParseArgs:** empty string → `{}`; valid JSON → object; invalid → null

Adapter tests:
- **OpenRouter parser:** mock SSE response → assert correct emitter calls
- **Ollama parser:** mock NDJSON response → assert correct emitter calls

## Files to touch

- `apps/server/src/lib/agiEmitter.ts` (new — ~80 LOC skeleton + shared helpers)
- `apps/server/src/lib/trainerStream.ts` (remove ~80 LOC, keep parser + request building)
- `apps/server/src/lib/ollamaTrainerStream.ts` (remove ~80 LOC, keep parser + request building)
- `apps/server/src/lib/agiEmitter.test.ts` (new)

## Dependencies

- Blocked by: none
- Related: `trainerToolLoop.ts` calls both streams — no change needed (the interface stays `AsyncGenerator<StreamChunk>`)

## Effort

~0.5 session. Smallest extract — the skeleton is clearly delineated.