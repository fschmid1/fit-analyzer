import { buildCalendarGuidance } from "./calendarGuidance.js";
import { getCoachVerbositySettings } from "./coachSettings.js";
import { buildReplyShapeGuidance } from "./replyShapeGuidance.js";
import {
	BASE_SYSTEM_PROMPT,
	buildCurrentTimeText,
} from "./trainerBasePrompt.js";

/**
 * The coach system prompt: the static base, the calendar/plan block, the
 * athlete's reply shape, and the current-time line. One builder for interactive
 * chat and the unattended weekly Plan refresh, so the two cannot drift.
 *
 * The analysis prompt (/analyze/:activityId) deliberately does not use this —
 * it has its own section contract and, per apps/server ADR-0001, no timestamp.
 * It appends buildReplyShapeGuidance itself.
 */
export async function buildCoachSystemPrompt(userId: string): Promise<string> {
	const [calendarGuidance, verbosity] = await Promise.all([
		buildCalendarGuidance(userId),
		getCoachVerbositySettings(userId),
	]);

	return [
		`${BASE_SYSTEM_PROMPT}${calendarGuidance}`,
		buildReplyShapeGuidance(verbosity),
		buildCurrentTimeText(new Date()),
	].join("\n\n");
}
