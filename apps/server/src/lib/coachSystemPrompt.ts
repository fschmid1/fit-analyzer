import { buildPlanGuidance } from "./planGuidance.js";
import {
	getCoachInstructionsSettings,
	getCoachVerbositySettings,
} from "./coachSettings.js";
import { buildCoachInstructionsGuidance } from "./coachInstructionsGuidance.js";
import { buildReplyShapeGuidance } from "./replyShapeGuidance.js";
import {
	BASE_SYSTEM_PROMPT,
	buildCurrentTimeText,
} from "./trainerBasePrompt.js";

/**
 * The coach system prompt: the static base, the calendar/plan block, the
 * athlete's reply shape, the athlete's own instructions, and the current-time
 * line. One builder for interactive chat and the unattended weekly Plan
 * refresh, so the two cannot drift.
 *
 * The analysis prompt (/analyze/:activityId) deliberately does not use this —
 * it has its own section contract and, per apps/server ADR-0001, no timestamp.
 * It appends buildReplyShapeGuidance and buildCoachInstructionsGuidance itself.
 */
export async function buildCoachSystemPrompt(userId: string): Promise<string> {
	const [planGuidance, verbosity, instructions] = await Promise.all([
		buildPlanGuidance(userId),
		getCoachVerbositySettings(userId),
		getCoachInstructionsSettings(userId),
	]);

	return [
		`${BASE_SYSTEM_PROMPT}${planGuidance}`,
		buildReplyShapeGuidance(verbosity),
		buildCoachInstructionsGuidance(instructions),
		buildCurrentTimeText(new Date()),
	]
		.filter(Boolean)
		.join("\n\n");
}
