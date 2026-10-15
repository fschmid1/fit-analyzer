# The coach's reply shape is prompt-enforced, and the tool cards carry the data

The coach's replies read as walls of prose: long, repetitive, and hard to scan on a phone. We decided the athlete's reading experience is governed by an explicit reply-shape contract in the system prompt, parameterised by a per-user **Verbosity** (Concise, Standard or Detailed, default Concise), rather than by trimming or restructuring the model's output in the renderer.

The contract has three parts. Replies are a lead sentence followed by bullets, never running prose. The coach interprets rather than transcribes, because tool results are already rendered to the athlete on screen as **Tool cards** — the numbers, tables and charts are visible without the coach repeating them. And the coach calls tools silently, emitting exactly one shaped reply after the tools have run, with no preamble and no commentary between tool calls; that last rule removes a large share of the length in tool-heavy turns and costs nothing to enforce.

Length language was stripped from every other prompt — "concise, actionable" in the base prompt, "short summary message" in the plan-refresh instruction, "Brief"/"concise" in the analysis section bodies — so the shape block is the single source of truth for how much is written. The five analysis sections survive with shape-rule bodies, and the weekly plan-refresh summary honours the athlete's Verbosity. The block is appended after the variable-free `BASE_SYSTEM_PROMPT` rather than folded into it, so the base stays the byte-identical, cacheable prefix (see apps/server ADR-0001 on prompt caching).

Why prompt-enforced: the renderer cannot tell a long reply that earned its length from one that did not, and the actual failure was the coach re-narrating data the athlete could already see. The fix belonged at the point where the coach decides what to say.

## Considered Options

- **A hard word ceiling in the prompt** — rejected: it yields clipped prose that drops the interpretation, which is the part worth reading. Verbosity scales the shape parameters (bullets, rationale clauses, extra sections) instead of a word count.
- **Renderer truncation, a "show more" on long replies** — rejected: it hides a good long answer in order to disguise a sloppy one, and makes every reply harder to scan. The only collapse affordance stays on Tool cards and reasoning, where content is genuinely optional.
- **A summary/detail envelope, rendered collapsed from the first `##`** — deferred: it needs the coach to hold a markdown convention with no schema behind it. Revisit if prompt enforcement demonstrably fails.
- **Verbosity modes that add or remove sections** — rejected: it fights the analysis report's fixed section contract, and the skeleton is structure rather than verbosity.
- **Structured card output instead of prose** — rejected: a parts model would ripple through rendering, compaction and token estimation to solve a shaping problem the prompt can already state.

## Consequences

- Enforcement is soft. A model that ignores the contract produces a verbose reply and nothing catches it. The Verbosity setting is the response to drift, not a guarantee that drift cannot happen.
- The mode applies in Compare mode too, so a side-by-side run measures the experience the athlete actually gets rather than each model's natural verbosity.
- Verbosity lives in the prompt tail, so changing it costs nothing in prompt-cache hits.
- The athlete cannot ask for an unbounded reply at any mode; the contract caps every one. "More detail than the mode allows, because the athlete asked" stays available to the coach *within* a mode.
- Any new coach surface must route through the shape block, or it will read differently from every other reply. Two builders do this today: `buildCoachSystemPrompt` for chat and the weekly Plan refresh, and the analysis prompt plus `buildReplyShapeGuidance` for a single activity.
- Editing prompt shape is now a single-file change, but every future prompt addition has to leave length to that file or the four-way disagreement this change removed comes back.
