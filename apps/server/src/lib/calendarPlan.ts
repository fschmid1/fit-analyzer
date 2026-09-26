import type { TrainingPlanResponse } from "@fit-analyzer/shared";
import {
	getCalendarContext,
	getGoogleConnection,
} from "./googleCalendarConnection.js";
import { listUpcomingEvents } from "./googleCalendarClient.js";
import {
	toCalendarEventSnapshot,
	toPlanWorkout,
	wallClockMinute,
} from "./googleCalendarSync.js";

/**
 * Read the training calendar back as plan workouts. The calendar is the plan
 * of record (ADR-0002), so this is a projection only — nothing is persisted.
 * Used by the /plan screen and as the forward-plan input to a Plan refresh.
 *
 * This module is the thin I/O layer: the pure projection lives in
 * googleCalendarSync.ts so it can be tested without the db singleton.
 */

/** Project the connected user's upcoming training-calendar events. */
export async function readTrainingPlan(
	userId: string,
): Promise<TrainingPlanResponse> {
	const connection = getGoogleConnection(userId);
	if (!connection?.calendarId || !connection.tz) {
		return {
			connected: false,
			timezone: connection?.tz ?? null,
			workouts: [],
			today: null,
		};
	}

	const { accessToken, calendarId, timezone } =
		await getCalendarContext(userId);
	const now = new Date();
	const events = await listUpcomingEvents(accessToken, calendarId);
	const workouts = events
		.map((ev) => toPlanWorkout(toCalendarEventSnapshot(ev), timezone, now))
		.filter((w): w is NonNullable<typeof w> => w !== null)
		.sort((a, b) =>
			`${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`),
		);

	return {
		connected: true,
		timezone,
		workouts,
		today: wallClockMinute(now, timezone).slice(0, 10),
	};
}

/**
 * The forward plan as plain text for the coach. Empty string when nothing is
 * scheduled, so the model knows it is starting from scratch.
 */
export function formatPlanForPrompt(plan: TrainingPlanResponse): string {
	if (!plan.connected) return "";
	if (plan.workouts.length === 0)
		return "(no planned workouts on the calendar)";
	return plan.workouts
		.map(
			(w) =>
				`- ${w.date} ${w.startTime} (${w.durationMinutes} min): ${w.focus}${
					w.edited ? " [athlete-edited — leave as is]" : ""
				}`,
		)
		.join("\n");
}
