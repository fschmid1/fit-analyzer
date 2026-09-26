import { getGoogleConnection } from "./googleCalendarConnection.js";
import { formatPlanForPrompt, readTrainingPlan } from "./calendarPlan.js";

/**
 * The single calendar/planning guidance block shared by interactive trainer
 * chat and the unattended weekly Plan refresh, so the two entry points cannot
 * drift. Resurrected from the previously-dead trainerSystemPrompt.ts calendar
 * section and extended with the weekly contract (ADR-0003).
 */

/** The guidance for a user, or "" when no Training calendar is connected. */
export async function buildCalendarGuidance(userId: string): Promise<string> {
	const connection = getGoogleConnection(userId);
	if (!connection?.calendarId || !connection.tz) return "";

	let planText = "(no planned workouts on the calendar)";
	try {
		const plan = await readTrainingPlan(userId);
		planText = formatPlanForPrompt(plan);
	} catch {
		// A calendar read failure must not break prompt building; the coach
		// still gets the tool guidance and can read the plan via the tools.
	}

	return [
		"",
		"## Training Calendar",
		`The athlete's Google Calendar is connected. A dedicated "Training" calendar holds their planned workouts; the athlete's day is in the ${connection.tz} timezone.`,
		"",
		"Use add_workouts_to_calendar to push the plan. Always send the COMPLETE forward plan, never just the changes: it upserts (workouts already on the calendar update in place, entries missing from your list are removed, and events the athlete edited by hand are never touched). Workouts in the past are ignored. Workouts default to 17:00 when you omit a start time; infer better times from the athlete's activity history when it suggests one.",
		"The Plan week is Monday–Sunday in the athlete's timezone. Keep the upcoming Plan week fully populated — that is what the weekly refresh guarantees. Revise workouts only where recent activity, health, or the athlete's feedback warrants it; otherwise keep the existing plan.",
		"",
		"Current forward plan (authoritative — read back from the calendar):",
		planText,
		"",
	].join("\n");
}
