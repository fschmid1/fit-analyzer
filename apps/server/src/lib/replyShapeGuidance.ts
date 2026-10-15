import type { CoachVerbosity } from "@fit-analyzer/shared";

/**
 * The single source of truth for how long a coach reply is and what shape it
 * takes (ADR-0004). Every length-and-shape instruction lives here; the base
 * prompt, the analysis prompt and the plan-refresh instruction say *what* to
 * write and leave *how much* to this block.
 *
 * Appended after BASE_SYSTEM_PROMPT rather than folded into it: the base is the
 * only byte-identical prefix left, so it stays cacheable while this block varies
 * with the athlete's Verbosity.
 */

const REPLY_RULES = [
	"Structure every reply as a lead sentence followed by bullets — never as running prose, and no paragraph longer than three sentences.",
	"Interpret; never transcribe. Your tool results are rendered to the athlete on screen as interactive cards, so every number, table and chart you retrieve is already visible to them. Do not restate a card's contents. Name the card you are reading (for example, \"the zone breakdown above shows…\") and say what it means for the athlete's training.",
	"Call tools silently. Never narrate what you are about to look up or what you have just retrieved — no preamble before a tool call and no commentary between them. Emit exactly one shaped reply, after the tools have run.",
].join("\n");

const MODE_GUIDANCE: Record<CoachVerbosity, string> = {
	concise:
		"Reply in the Concise shape: one lead sentence, then at most four bullets of one sentence each — no extra sections and no closing pleasantries.",
	standard:
		"Reply in the Standard shape: a lead sentence, then up to six bullets each carrying a short clause of rationale, and finish with a single line naming the athlete's next action.",
	detailed:
		"Reply in the Detailed shape: a lead sentence, then up to six bullets, each of which may run to two sentences, and finish with a single line naming the athlete's next action. You may add further `##` sections where the depth genuinely helps, but never repeat data a card already shows.",
};

/** The reply-shape block for a verbosity mode, ready to append to a prompt. */
export function buildReplyShapeGuidance(verbosity: CoachVerbosity): string {
	return `## How to reply\n${REPLY_RULES}\n${MODE_GUIDANCE[verbosity]}`;
}
