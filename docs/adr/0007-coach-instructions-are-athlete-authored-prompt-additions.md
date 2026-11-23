# The athlete can append their own instructions to the coach prompt

The coach already exposes a per-user **Verbosity** (ADR-0004), but that only scales length and shape. Athletes who wanted the coach to assume a weekday-indoor schedule, explain jargon, or always connect a session to the goal event had no way to say so short of repeating themselves in every chat. We added a free-form **Coach instructions** field: the athlete's own text, stored per user and appended to every coach system prompt.

The block is one more variable prompt tail after the reply-shape guidance, built by a single `buildCoachInstructionsGuidance` helper. It carries a heading, a precedence sentence, and the athlete's text inside an `<athlete_instructions>` delimiter so the model reads it as quoted instructions rather than prompt structure. The precedence sentence is explicit: the athlete's instructions apply "as long as they do not contradict the rules above; where they conflict, the rules above win." That keeps the fixed rules — interpret rather than transcribe, call tools silently, ask before changing the profile — out of the athlete's reach while leaving tone, emphasis and format to them.

The text is trimmed and stored in `user_settings.coach_instructions`, empty by default. The server rejects values over 2000 characters with a 400 instead of silently truncating, so an athlete who hits the cap knows their text was not saved. The web textarea carries the same limit and a live counter. Because both the trainer chat / weekly Plan refresh (`buildCoachSystemPrompt`) and the activity analysis prompt use the helper, the athlete's instructions apply consistently across every coach surface, while the base prompt stays the byte-identical cacheable prefix (apps/server ADR-0001).

## Considered Options

- **A per-thread override, like the coach model** — rejected: the instructions are about the athlete's standing preferences, not one conversation. Repeating them per thread would make them easy to lose and impossible to audit.
- **Let the athlete replace the system prompt wholesale** — rejected: it is one paste away from removing the tool-call, data-integrity and confirmation rules the product depends on, with no way to recover the coach's behaviour.
- **Structured preference fields (tone, jargon, schedule)** — deferred: every field is a schema and a UI control, and the useful requests are open-ended. Free text covers the long tail now; structure can be added later when a pattern proves common.
- **Inject the text into the static base prompt** — rejected: it would invalidate the byte-identical cacheable prefix on every change, and blur the line between built-in rules and athlete additions.

## Consequences

- Enforcement is soft: a model can still ignore the athlete's text, just as it can ignore the Verbosity shape.
- Every future coach surface must append the helper (alongside `buildReplyShapeGuidance`) or that surface will silently drop the athlete's instructions.
- The cap is a product constraint, not a prompt-length discovery: 2000 characters is enough for a paragraph of preferences and small enough to leave room for the data blocks.
- Instructions never remove the built-in guardrails, so the athlete cannot use the field to disable confirmation prompts or silent tool calls.
