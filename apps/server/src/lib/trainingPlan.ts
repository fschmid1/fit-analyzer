import type { PlanWorkout, TrainingPlanResponse } from "@fit-analyzer/shared";
import {
	getCalendarContext,
	getGoogleConnection,
} from "./googleCalendarConnection.js";
import { listUpcomingEvents } from "./googleCalendarClient.js";
import {
	toCalendarEventSnapshot,
	toPlanWorkout,
} from "./googleCalendarSync.js";
import { getIntervalsIcuConnection } from "./intervalsIcuConnection.js";
import {
	listIntervalsIcuEvents,
	type IntervalsIcuEvent,
} from "./intervalsIcuClient.js";
import {
	icuEventSyncKey,
	icuEventToPlanWorkout,
} from "./intervalsIcuPlanSync.js";
import { getPlanSyncMarks } from "./planSyncMarks.js";
import { getConnectedPlanTargets, primaryPlanTarget } from "./planTargets.js";
import { planTargetLabel } from "@fit-analyzer/shared";
import { planEventWindow } from "./planSyncCore.js";
import { getTrainingTimezone } from "./trainingTimezone.js";
import { wallClockMinute } from "./wallClock.js";

/**
 * Read the plan back from its primary target. The target is the plan of record
 * (ADR-0002, narrowed by ADR-0005), so this is a projection only — nothing is
 * persisted. Used by the /plan screen and as the forward-plan input to a Plan
 * refresh, whichever target is primary.
 *
 * The pure projections live in googleCalendarSync.ts / intervalsIcuPlanSync.ts
 * so they can be tested without the db singleton; this module is the thin I/O
 * layer plus the target choice.
 */

export async function readTrainingPlan(
	userId: string,
): Promise<TrainingPlanResponse> {
	const targets = getConnectedPlanTargets(userId);
	const primary = primaryPlanTarget(targets);
	const timezone = getTrainingTimezone(userId);
	if (!primary || !timezone) {
		return {
			connected: false,
			timezone,
			workouts: [],
			today: null,
			primary: null,
			targets,
		};
	}

	const now = new Date();
	let workouts: PlanWorkout[];

	if (primary === "intervalsIcu") {
		const connection = getIntervalsIcuConnection(userId);
		if (!connection?.api_key) throw new Error("intervals.icu is not connected");
		const { oldest, newest } = planEventWindow(now);
		const events = await listIntervalsIcuEvents(
			connection.api_key,
			oldest,
			newest,
		);
		const marks = new Map(
			getPlanSyncMarks(userId, "intervalsIcu").map((m) => [m.syncKey, m]),
		);
		workouts = events
			.map((ev) => {
				const key = icuEventSyncKey(ev);
				return icuEventToPlanWorkout(
					ev,
					timezone,
					now,
					key ? (marks.get(key) ?? null) : null,
				);
			})
			.filter((w): w is PlanWorkout => w !== null);
	} else {
		const google = getGoogleConnection(userId);
		if (!google?.calendarId) throw new Error("Google Calendar not connected");
		const { accessToken, calendarId } = await getCalendarContext(userId);
		const events = await listUpcomingEvents(accessToken, calendarId);
		workouts = events
			.map((ev) => toPlanWorkout(toCalendarEventSnapshot(ev), timezone, now))
			.filter((w): w is PlanWorkout => w !== null);
	}

	workouts.sort((a, b) =>
		`${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`),
	);

	return {
		connected: true,
		timezone,
		workouts,
		today: wallClockMinute(now, timezone).slice(0, 10),
		primary,
		targets,
	};
}

/**
 * The forward plan as plain text for the coach. Empty string when nothing is
 * connected or scheduled.
 */
export function formatPlanForPrompt(plan: TrainingPlanResponse): string {
	if (!plan.connected) return "";
	if (plan.workouts.length === 0) {
		return `(no planned workouts on ${plan.primary ? planTargetLabel(plan.primary) : "the plan"})`;
	}
	return plan.workouts
		.map(
			(w) =>
				`- ${w.date} ${w.startTime} (${w.durationMinutes} min, ${w.sport}): ${w.focus}${
					w.steps.length > 0 ? ` [${w.steps.length} step(s)]` : ""
				}${w.edited ? " [athlete-edited — leave as is]" : ""}`,
		)
		.join("\n");
}

/**
 * Read-only plan context: the athlete's races, notes, holidays, sickness and
 * season targets. These are never written by this app (ADR-0005 Q17); they
 * exist so the coach plans around them. Google Calendar has no such
 * distinction, so it contributes nothing here — its events already come back
 * with the plan.
 */
export async function readPlanContext(userId: string): Promise<string> {
	const targets = getConnectedPlanTargets(userId);
	const primary = primaryPlanTarget(targets);
	if (primary !== "intervalsIcu") return "";
	const connection = getIntervalsIcuConnection(userId);
	if (!connection?.api_key) return "";

	const { oldest, newest } = planEventWindow();
	let events: IntervalsIcuEvent[];
	try {
		events = await listIntervalsIcuEvents(connection.api_key, oldest, newest);
	} catch {
		return "";
	}

	const lines: string[] = [];
	for (const ev of events) {
		if (icuEventSyncKey(ev)) continue;
		const category = ev.category ?? "NOTE";
		const start = (ev.start_date_local ?? "").slice(0, 10);
		if (!start) continue;
		const label = ev.name?.trim() || category;
		lines.push(`- ${start} ${category}: ${label}`);
	}
	if (lines.length === 0) return "";
	return [
		"Read-only entries on the athlete's intervals.icu calendar (races, notes, holidays, illness, season targets). Plan around them; never change them:",
		...lines,
	].join("\n");
}
