# Coach Tool System — Implementation Plan

## Overview

Add a tool-calling system to the coach/trainer so the LLM can autonomously invoke tools to gather more information during a conversation. Six tools are planned, starting with web search via DuckDuckGo.

### Tools

| # | Tool | What it does | External API |
|---|------|-------------|-------------|
| 1 | **Web search** | Search DuckDuckGo for current info about training, nutrition, events, etc. | DuckDuckGo Instant Answer (free, no key) |
| 2 | **Activity lookup** | Fetch full detail (summary, intervals, peaks) for any past activity by date or ID | None (DB query) |
| 3 | **Training load (PMC)** | Compute TSS, CTL, ATL, TSB from recent activities | None (math on existing data) |
| 4 | **Weather history** | Look up weather (temp, wind, precip) for a past ride's date + location | Open-Meteo Archive (free, no key) |
| 5 | **Power curve compare** | Compare current power-duration curve against all-time bests | None (math on existing data) |
| 6 | **Event countdown** | Given a target event date, compute weeks remaining + training phase | None (date math) |

### Tool invocation

- **LLM-initiated**: The coach decides when to call tools based on conversation context
- **Both providers**: OpenRouter and Ollama Cloud both support native tool calling
- **UI display**: Collapsible cards between user message and assistant response

---

## Architecture

```
User sends message
  │
  ▼
POST /api/trainer/chat { messages, threadId, streamId, tools }
  │
  ▼
trainerToolLoop.ts orchestrator:
  ┌─────────────────────────────────────────────┐
  │ 1. Send messages + tool defs to LLM        │
  │ 2. Stream response chunks                   │
  │ 3. If finish_reason = "tool_calls":         │
  │    a. Emit TOOL_CALL_* chunks               │
  │    b. Execute tool via registry             │
  │    c. Emit TOOL_RESULT chunk                │
  │    d. Append tool result to messages        │
  │    e. GOTO 1 (new LLM request)              │
  │ 4. If finish_reason = "stop": DONE         │
  └─────────────────────────────────────────────┘
  │
  ▼
SSE stream → trainerStreamRegistry → Web client
  │
  ▼
trainerStreamConnection.ts parses new chunk types
  │
  ▼
TrainerChat / CompareColumn intercept chunks
  │
  ▼
ToolCallCard renders between user msg and assistant response
```

---

## Phase 1: Shared Types

**File:** `packages/shared/src/types.ts`

Add new types for the tool system:

```typescript
// ─── Tool system types ───

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;       // text for the LLM to read
  display: unknown;      // structured data for UI rendering
  error?: string;
}

// UI-facing tool call state (used in the chat message list)
export interface UIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "executing" | "done" | "error";
  result?: ToolResult;
}

// Custom stream chunks for tool calls (extend beyond @tanstack/ai StreamChunk)
export type ToolStreamChunk =
  | { type: "TOOL_CALL_START"; toolCallId: string; toolName: string; timestamp: number }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string; timestamp: number }
  | { type: "TOOL_CALL_END"; toolCallId: string; toolName: string; arguments: Record<string, unknown>; timestamp: number }
  | { type: "TOOL_RESULT"; toolCallId: string; toolName: string; content: string; display: unknown; error?: string; timestamp: number };
```

---

## Phase 2: Server — Tool Registry

**Directory:** `apps/server/src/lib/tools/`

### `registry.ts` — Generic tool registry

```typescript
import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";

type ToolHandler = (args: Record<string, unknown>, userId: string) => Promise<ToolResult>;

const tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();

export function registerTool(definition: ToolDefinition, handler: ToolHandler): void {
  tools.set(definition.name, { definition, handler });
}

export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map((t) => t.definition);
}

export function getTool(name: string): { definition: ToolDefinition; handler: ToolHandler } | undefined {
  return tools.get(name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { id: "", name, content: "", display: null, error: `Unknown tool: ${name}` };
  }
  return tool.handler(args, userId);
}
```

### `webSearch.ts` — DuckDuckGo Instant Answer

- Calls `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
- Returns `ToolResult` with:
  - `content`: formatted text summary for the LLM (AbstractText + top RelatedTopics)
  - `display`: `{ query, abstract, abstractUrl, relatedTopics[] }` for UI

Tool definition:
```typescript
{
  name: "web_search",
  description: "Search the web for current information about training, nutrition, events, weather, or any topic relevant to coaching.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" }
    },
    required: ["query"]
  }
}
```

### `activityLookup.ts` — Activity lookup by date or ID

- Queries DB for activities matching date or ID (reuses existing prepared statements from `activities.ts`)
- Returns full summary + intervals + peak powers
- Tool definition:
```typescript
{
  name: "activity_lookup",
  description: "Fetch detailed data for a past activity by date (e.g. '2024-06-12') or activity ID. Returns power, heart rate, cadence, intervals, and peak powers.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "Activity date in YYYY-MM-DD format" },
      activityId: { type: "string", description: "Activity ID" }
    },
    required: []
  }
}
```
- At least one of `date` or `activityId` must be provided (validated in handler)

### `trainingLoad.ts` — PMC (Performance Management Chart)

- Computes TSS, CTL, ATL, TSB from recent activities
- TSS = (NP / FTP)² × duration_hours × 100
- CTL = 42-day exponentially weighted moving average of TSS
- ATL = 7-day EWMA of TSS
- TSB = CTL - ATL (form = fitness - fatigue)
- Uses estimated FTP from `computeAllTimeEstimates`
- Tool definition:
```typescript
{
  name: "training_load",
  description: "Compute Training Stress Score (TSS), Chronic Training Load (CTL/fitness), Acute Training Load (ATL/fatigue), and Training Stress Balance (TSB/form) from recent activities.",
  parameters: {
    type: "object",
    properties: {
      days: { type: "number", description: "Number of days to look back (default 42)" }
    },
    required: []
  }
}
```

### `weatherHistory.ts` — Open-Meteo Archive

- Calls `https://archive-api.open-meteo.com/v1/archive?latitude=...&longitude=...&start_date=...&end_date=...&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant`
- Free, no API key required
- Tool definition:
```typescript
{
  name: "weather_history",
  description: "Look up historical weather conditions (temperature, precipitation, wind) for a specific date and location. Useful for contextualizing ride performance.",
  parameters: {
    type: "object",
    properties: {
      date: { type: "string", description: "Date in YYYY-MM-DD format" },
      lat: { type: "number", description: "Latitude" },
      lng: { type: "number", description: "Longitude" }
    },
    required: ["date", "lat", "lng"]
  }
}
```

### `powerCurve.ts` — Power-duration curve comparison

- For a given activity (or most recent), compute peak powers at standard durations (5s, 30s, 1min, 5min, 10min, 20min, 60min)
- Compare against all-time bests using `peakPowerFromSeconds` from `@fit-analyzer/shared`
- Tool definition:
```typescript
{
  name: "power_curve",
  description: "Compare the power-duration curve of a specific activity against the athlete's all-time bests. Identifies strengths and weaknesses across different durations.",
  parameters: {
    type: "object",
    properties: {
      activityId: { type: "string", description: "Activity ID (defaults to most recent)" }
    },
    required: []
  }
}
```

### `eventCountdown.ts` — Event countdown

- Given a target event date, compute weeks remaining, suggest training phase
- Phases: Base (12+ weeks), Build (8-12), Peak (4-8), Taper (1-4), Race week (0-1)
- Tool definition:
```typescript
{
  name: "event_countdown",
  description: "Calculate weeks until a target event and suggest the appropriate training phase (Base, Build, Peak, Taper, Race Week).",
  parameters: {
    type: "object",
    properties: {
      eventDate: { type: "string", description: "Event date in YYYY-MM-DD format" },
      eventName: { type: "string", description: "Optional event name for context" }
    },
    required: ["eventDate"]
  }
}
```

### `init.ts` — Register all tools at server startup

```typescript
import { registerTool } from "./registry.js";
import { webSearchTool } from "./webSearch.js";
import { activityLookupTool } from "./activityLookup.js";
import { trainingLoadTool } from "./trainingLoad.js";
import { weatherHistoryTool } from "./weatherHistory.js";
import { powerCurveTool } from "./powerCurve.js";
import { eventCountdownTool } from "./eventCountdown.js";

export function initTools(): void {
  registerTool(webSearchTool.definition, webSearchTool.handler);
  registerTool(activityLookupTool.definition, activityLookupTool.handler);
  registerTool(trainingLoadTool.definition, trainingLoadTool.handler);
  registerTool(weatherHistoryTool.definition, weatherHistoryTool.handler);
  registerTool(powerCurveTool.definition, powerCurveTool.handler);
  registerTool(eventCountdownTool.definition, eventCountdownTool.handler);
}
```

Called from `apps/server/src/index.ts` at startup.

---

## Phase 3: Server — Tool-Aware Streaming

### `trainerStream.ts` changes

- Accept `tools?: ToolDefinition[]` parameter
- Include `tools` in the OpenRouter request body
- Parse `delta.tool_calls` from SSE chunks (OpenRouter streams tool calls as JSON delta fragments)
- Accumulate tool call fragments by `index`
- When a tool call is complete, yield `TOOL_CALL_START`, `TOOL_CALL_ARGS` (per fragment), `TOOL_CALL_END`
- Return accumulated `toolCalls: ToolCall[]` alongside the generator
- Handle `finish_reason: "tool_calls"` — don't emit `TEXT_MESSAGE_END` or `RUN_FINISHED`; the orchestrator handles continuation

### `ollamaTrainerStream.ts` changes

- Accept `tools?: ToolDefinition[]` parameter
- Include `tools` in the Ollama request body
- Parse `message.tool_calls` from NDJSON chunks
- Same chunk emission pattern as OpenRouter

### New file: `trainerToolLoop.ts` — The orchestrator

```typescript
export async function* createTrainerToolLoop(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ModelMessage[];
  provider: "openrouter" | "ollama-cloud";
  includeReasoning?: boolean;
  metadata?: Record<string, unknown>;
  threadId?: string;
  userId: string;
  maxToolRounds?: number; // safety limit, default 5
}): AsyncGenerator<StreamChunk | ToolStreamChunk> {
  // 1. Yield RUN_STARTED
  // 2. Call provider stream generator with tools
  // 3. Collect all chunks
  // 4. If finish_reason === "tool_calls":
  //    a. Extract tool calls from the accumulated response
  //    b. For each tool call:
  //       - Yield TOOL_CALL_START
  //       - Yield TOOL_CALL_ARGS (replay the fragments)
  //       - Yield TOOL_CALL_END
  //       - Execute tool via registry
  //       - Yield TOOL_RESULT
  //    c. Append assistant message with tool_calls + tool result messages to messages array
  //    d. GOTO 2 (new stream request with updated messages)
  // 5. If finish_reason === "stop": yield RUN_FINISHED, done
  // 6. Safety: max 5 tool rounds to prevent infinite loops
}
```

Key design decisions for the loop:
- Each tool round is a **new HTTP request** to the LLM API (not a continuation of the same stream)
- The orchestrator merges all rounds into a single `AsyncIterable` so the registry and client see one continuous stream
- `RUN_STARTED` is emitted once at the beginning; `RUN_FINISHED` once at the end
- Tool call chunks are interleaved between text chunks from different rounds
- The `messageId` for the final text response is generated in round 1 and reused if the loop continues

### `trainer.ts` changes (POST `/chat`)

- Call `createTrainerToolLoop` instead of `createTrainerStream` / `createOllamaTrainerStream` directly
- Pass `userId` and `getToolDefinitions()` to the loop
- The stream registry doesn't need changes — it buffers arbitrary chunks

---

## Phase 4: Web — Stream Connection & Chunk Handling

### `trainerStreamConnection.ts` changes

- Widen the chunk type from `StreamChunk` to `StreamChunk | ToolStreamChunk`
- The `streamSseResponse` function already parses `JSON.parse(data)` — just widen the type
- The queue's `push` method and `subscribe` generator handle the wider type
- No structural changes needed

### `trainerHelpers.ts` additions

```typescript
import type { ToolStreamChunk, UIToolCall } from "@fit-analyzer/shared";

export function isToolChunk(
  chunk: StreamChunk | ToolStreamChunk,
): chunk is ToolStreamChunk {
  return chunk.type.startsWith("TOOL_");
}

// Accumulate tool calls from stream chunks
export function applyToolChunks(
  toolCalls: UIToolCall[],
  chunk: ToolStreamChunk,
): UIToolCall[] {
  // TOOL_CALL_START: add new UIToolCall with status "executing"
  // TOOL_CALL_ARGS: update arguments (accumulate JSON fragments)
  // TOOL_CALL_END: finalize arguments
  // TOOL_RESULT: set status "done"/"error" and attach result
}
```

### `TrainerChat.tsx` changes

- Track `toolCalls: UIToolCall[]` state alongside messages
- In the resume effect and the `useChat` flow, intercept tool chunks:
  - When a tool chunk arrives, update `toolCalls` state instead of messages
  - Tool calls are grouped with the **next** assistant message (the one that follows tool execution)
- In the message list rendering:
  - Before each assistant message, check if there are tool calls that preceded it
  - Render `ToolCallCard` components for those tool calls
  - Tool calls during streaming (no following assistant message yet) render standalone
- Tool calls are **not persisted** — they're ephemeral. On history load, they don't appear.
- On retry/delete, tool calls associated with the deleted messages are cleared.

### `CompareColumn.tsx` changes

- Same tool call tracking and rendering as TrainerChat
- Tool calls appear in each compare column independently

---

## Phase 5: Web — UI Components

### New component: `ToolCallCard.tsx`

**File:** `apps/web/src/components/trainer/ToolCallCard.tsx`

States:

**EXECUTING (tool is running):**
```
┌──────────────────────────────────────────┐
│ 🔍 Searching the web...                  │  ← icon + tool name + spinner
│ "best cycling nutrition for endurance"   │  ← query in muted text
└──────────────────────────────────────────┘
```

**DONE (collapsed):**
```
┌──────────────────────────────────────────┐
│ 🔍 Web Search ▸                          │  ← icon + tool name + expand arrow
│ "best cycling nutrition for endurance"   │
└──────────────────────────────────────────┘
```

**DONE (expanded):**
```
┌──────────────────────────────────────────┐
│ 🔍 Web Search ▾                          │
│ "best cycling nutrition for endurance"   │
├──────────────────────────────────────────┤
│ Summary: Carbohydrate intake during...   │  ← formatted result content
│ Source: example.com                      │
│                                          │
│ Related topics:                          │
│ • Cycling nutrition guide               │
│ • Pre-ride meal timing                  │
│ • Electrolyte strategies                │
└──────────────────────────────────────────┘
```

**ERROR:**
```
┌──────────────────────────────────────────┐
│ 🔍 Web Search                            │
│ "best cycling nutrition for endurance"   │
│ ⚠ Search failed: rate limited           │  ← red error text
└──────────────────────────────────────────┘
```

Each tool gets a distinct icon from `lucide-react`:
- `web_search` → `Globe`
- `activity_lookup` → `Search`
- `training_load` → `TrendingUp`
- `weather_history` → `CloudSun`
- `power_curve` → `Zap`
- `event_countdown` → `Calendar`

The card uses the same dark theme (`bg-[#1a1533]/80`, `border-[rgba(139,92,246,0.1)]`) but with a distinct left border accent color per tool type.

### `ChatMessageRow.tsx` changes

- Accept optional `toolCalls?: UIToolCall[]` prop
- Render `ToolCallCard` components above the assistant bubble
- Tool cards are slightly indented (smaller max-width, `ml-4`)

### `CompareMessageRow.tsx` changes

- Same as ChatMessageRow — accept `toolCalls` prop, render cards above assistant bubble

---

## Phase 6: Tool Display Content Formatting

Each tool's `display` field contains structured data for the UI:

| Tool | `display` shape |
|------|----------------|
| `web_search` | `{ query, abstract: string, abstractUrl: string, relatedTopics: { text, url }[] }` |
| `activity_lookup` | `{ date, summary: ActivitySummary, intervals: Interval[], peakPowers: {...} }` |
| `training_load` | `{ ftp, tss: number[], ctl: number[], atl: number[], tsb: number[], dates: string[], current: { ctl, atl, tsb } }` |
| `weather_history` | `{ date, location: { lat, lng }, tempMax, tempMin, precip, windMax, windDir }` |
| `power_curve` | `{ activityDate, durations: { seconds, current, allTimeBest, percentOfBest }[] }` |
| `event_countdown` | `{ eventName, eventDate, weeksRemaining, phase, phaseDescription }` |

The `content` field (sent to the LLM) is a formatted text summary. The `display` field drives the UI card's expanded view.

---

## Implementation Order

| # | What | Files | Complexity |
|---|------|-------|------------|
| 1 | Shared types | `packages/shared/src/types.ts` | Low |
| 2 | Tool registry + init | `apps/server/src/lib/tools/registry.ts`, `init.ts` | Low |
| 3 | Web search tool | `apps/server/src/lib/tools/webSearch.ts` | Low |
| 4 | Activity lookup tool | `apps/server/src/lib/tools/activityLookup.ts` | Medium |
| 5 | Training load tool | `apps/server/src/lib/tools/trainingLoad.ts` | Medium |
| 6 | Weather history tool | `apps/server/src/lib/tools/weatherHistory.ts` | Low |
| 7 | Power curve tool | `apps/server/src/lib/tools/powerCurve.ts` | Medium |
| 8 | Event countdown tool | `apps/server/src/lib/tools/eventCountdown.ts` | Low |
| 9 | Tool-aware OpenRouter stream | `apps/server/src/lib/trainerStream.ts` | High |
| 10 | Tool-aware Ollama stream | `apps/server/src/lib/ollamaTrainerStream.ts` | High |
| 11 | Tool loop orchestrator | `apps/server/src/lib/trainerToolLoop.ts` | High |
| 12 | Wire into trainer route | `apps/server/src/routes/trainer.ts` | Medium |
| 13 | Web chunk type widening | `apps/web/src/lib/trainerStreamConnection.ts` | Low |
| 14 | Web helper functions | `apps/web/src/components/trainer/trainerHelpers.ts` | Medium |
| 15 | ToolCallCard component | `apps/web/src/components/trainer/ToolCallCard.tsx` | Medium |
| 16 | Integrate into TrainerChat | `apps/web/src/components/trainer/TrainerChat.tsx` | High |
| 17 | Integrate into ChatMessageRow | `apps/web/src/components/trainer/ChatMessageRow.tsx` | Medium |
| 18 | Integrate into CompareColumn | `apps/web/src/components/trainer/CompareColumn.tsx` | Medium |
| 19 | Integrate into CompareMessageRow | `apps/web/src/components/trainer/CompareMessageRow.tsx` | Low |
| 20 | Register tools at startup | `apps/server/src/index.ts` | Low |

---

## Key Design Decisions

1. **Tool results are ephemeral** — not persisted in `trainer_messages`. Only user/assistant messages are saved. If history is reloaded, tool calls don't reappear. This keeps the DB schema simple and avoids storing potentially stale search results.

2. **Single tool call per round** — the loop handles one set of tool calls per LLM request. If the LLM calls multiple tools in one response, they execute sequentially before the next LLM request. Parallel execution can be added later.

3. **Max 5 tool rounds** — safety limit to prevent infinite tool-calling loops. If the LLM keeps calling tools without producing a text response, the loop terminates with an error.

4. **Tool definitions are static** — registered at server startup. All 6 tools are always available to the coach. Dynamic registration (e.g., per-activity tools) is a future enhancement.

5. **DuckDuckGo is synchronous** — fast enough that we don't need async status updates. The `TOOL_RESULT` chunk arrives quickly after `TOOL_CALL_END`.

6. **Open-Meteo is free, no key** — the weather history tool has zero operational cost.

7. **PMC uses estimated FTP** — from `computeAllTimeEstimates`. If no FTP estimate exists, the tool returns an error telling the coach to ask the user for their FTP.

8. **Activity lookup uses existing DB queries** — reuses the same prepared statements from `activities.ts` routes. No new DB schema needed.
