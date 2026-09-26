import type {
	CalendarRemovalResult,
	CalendarSyncResult,
	PlannedWorkout,
} from "@fit-analyzer/shared";
import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getCalendarContext } from "../../lib/googleCalendarConnection.js";
import {
	deleteEvent,
	insertEvent,
	listUpcomingEvents,
	patchEvent,
} from "../googleCalendarClient.js";
import {
	eventFocus,
	filterRemovals,
	mergePlan,
	toCalendarEventSnapshot,
	type CalendarEventSnapshot,
	type SyncRow,
} from "../googleCalendarSync.js";

/**
 * Coach tools for the training calendar. The coach pushes whole plans via
 * add_workouts_to_calendar (Plan sync: create/update/delete by Sync key) and
 * clears ranges via remove_workouts_from_calendar. The calendar is the plan
 * store — nothing is persisted besides the events themselves.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toolError(name: string, message: string): ToolResult {
	return { id: "", name, content: "", display: null, error: message };
}

/**
 * Parse the loosely-typed `workouts` argument the model sends. Returns rows
 * or an error string; never throws.
 */
function parseWorkouts(
	raw: unknown,
): { workouts: PlannedWorkout[] } | { error: string } {
	if (!Array.isArray(raw)) return { error: "workouts must be an array" };
	const workouts: PlannedWorkout[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i] as Record<string, unknown>;
		const date = typeof item.date === "string" ? item.date.trim() : "";
		const focus = typeof item.focus === "string" ? item.focus.trim() : "";
		if (!date || !focus) {
			return { error: `workouts[${i}]: date and focus are required` };
		}
		const durationMinutes =
			typeof item.durationMinutes === "number" && item.durationMinutes > 0
				? Math.round(item.durationMinutes)
				: null;
		if (durationMinutes == null) {
			return {
				error: `workouts[${i}] "${focus}": durationMinutes must be a positive number`,
			};
		}
		const startTime =
			typeof item.startTime === "string" && item.startTime.trim() !== ""
				? item.startTime.trim()
				: null;
		const description =
			typeof item.description === "string" && item.description.trim() !== ""
				? item.description.trim()
				: null;
		workouts.push({ date, startTime, durationMinutes, focus, description });
	}
	return { workouts };
}

function rowOf(ev: CalendarEventSnapshot): SyncRow {
	const dateTime = ev.start?.dateTime ?? "";
	return {
		date: dateTime.slice(0, 10),
		startTime: dateTime.slice(11, 16),
		focus: eventFocus(ev),
	};
}

function summarize(rows: SyncRow[]): string {
	return rows.map((r) => `${r.date} ${r.startTime} ${r.focus}`).join("; ");
}

function fetchExisting(
	accessToken: string,
	calendarId: string,
): Promise<CalendarEventSnapshot[]> {
	return listUpcomingEvents(accessToken, calendarId).then((events) =>
		events.map(toCalendarEventSnapshot),
	);
}

// ─── add_workouts_to_calendar ─────────────────────────────────────────────────

export const addWorkoutsDefinition: ToolDefinition = {
	name: "add_workouts_to_calendar",
	description:
		"Add or revise planned workouts on the athlete's Training calendar. Sends a whole plan: workouts already on the calendar are updated in place, calendar entries missing from your list are removed, and events the athlete edited by hand are never touched. Always send the complete plan, not just the changes. Workouts in the past are ignored.",
	parameters: {
		type: "object",
		properties: {
			workouts: {
				type: "array",
				description:
					"The complete planned workload going forward. Use date-based entries; the calendar carries the authoritative schedule.",
				items: {
					type: "object",
					description:
						"One planned workout. durationMinutes is required; startTime defaults to 17:00 in the athlete's timezone when omitted.",
					properties: {
						date: {
							type: "string",
							description: "Workout date as YYYY-MM-DD",
						},
						startTime: {
							type: "string",
							description:
								"Start time as HH:MM in the athlete's timezone (24h). Infer from conversation/activity patterns; omit for the afternoon default.",
						},
						durationMinutes: {
							type: "number",
							description: "Session length in minutes",
						},
						focus: {
							type: "string",
							description:
								"Session title used as the event name, e.g. 'Threshold intervals 3x10min'",
						},
						description: {
							type: "string",
							description:
								"Optional session notes shown in the event body (targets, nutrition, purpose)",
						},
					},
				},
			},
		},
		required: ["workouts"],
	},
};

export const addWorkoutsHandler: ToolHandler = async (args, context) => {
	const parsed = parseWorkouts(args.workouts);
	if ("error" in parsed) {
		return toolError("add_workouts_to_calendar", parsed.error);
	}
	if (parsed.workouts.length === 0) {
		return toolError("add_workouts_to_calendar", "workouts must not be empty");
	}

	try {
		const { accessToken, calendarId, timezone } = await getCalendarContext(
			context.userId,
		);
		const existing = await fetchExisting(accessToken, calendarId);
		const { actions, result } = mergePlan(
			parsed.workouts,
			existing,
			timezone,
			Date.now(),
		);

		let failures = 0;
		for (const action of actions) {
			try {
				if (action.kind === "create") {
					await insertEvent(accessToken, calendarId, action.event);
				} else if (action.kind === "update") {
					await patchEvent(
						accessToken,
						calendarId,
						action.eventId,
						action.event,
					);
				} else if (action.kind === "remove") {
					await deleteEvent(accessToken, calendarId, action.event.id);
				}
			} catch (err) {
				failures += 1;
				const label =
					action.kind === "remove"
						? eventFocus(action.event)
						: action.event.summary;
				result.errors.push(
					`${action.kind} failed for "${label}": ${(err as Error).message}`,
				);
			}
		}

		const content = buildSyncContent(result);
		return {
			id: "",
			name: "add_workouts_to_calendar",
			content,
			display: result,
		};
	} catch (err) {
		return toolError("add_workouts_to_calendar", (err as Error).message);
	}
};

function buildSyncContent(result: CalendarSyncResult): string {
	const lines: string[] = [];
	if (result.created.length)
		lines.push(`Created ${result.created.length} planned workout(s)`);
	if (result.updated.length)
		lines.push(`Updated ${result.updated.length} existing event(s)`);
	if (result.deleted)
		lines.push(`Removed ${result.deleted} event(s) no longer in the plan`);
	if (result.skipped.length || result.skippedEdits)
		lines.push(
			`Left ${result.skipped.length + result.skippedEdits} event(s) untouched because the athlete edited them in Google Calendar`,
		);
	if (result.notScheduled?.length) {
		const rows = result.notScheduled
			.map((r) => `${r.date} ${r.startTime} ${r.focus}`)
			.join("; ");
		lines.push(`Not scheduled (already started): ${rows}`);
	}
	if (result.errors.length)
		lines.push(`Problems: ${result.errors.join(" | ")}`);
	if (!lines.length) lines.push("Calendar already matches this plan");
	return lines.join("\n");
}

// ─── remove_workouts_from_calendar ────────────────────────────────────────────

export const removeWorkoutsDefinition: ToolDefinition = {
	name: "remove_workouts_from_calendar",
	description:
		"Remove planned workouts you previously added to the Training calendar (e.g. after a plan change or injury break). Prefer add_workouts_to_calendar with a revised plan when the athlete still trains — removal is for clearing entries entirely. Events the athlete edited by hand are never removed.",
	parameters: {
		type: "object",
		properties: {
			fromDate: {
				type: "string",
				description: "Only remove workouts on or after this date (YYYY-MM-DD)",
			},
			toDate: {
				type: "string",
				description: "Only remove workouts on or before this date (YYYY-MM-DD)",
			},
			focus: {
				type: "string",
				description:
					"Only remove workouts whose title contains this text, e.g. 'Threshold'",
			},
		},
		required: [],
	},
};

export const removeWorkoutsHandler: ToolHandler = async (args, context) => {
	const str = (v: unknown): string | null =>
		typeof v === "string" && v.trim() !== "" ? v.trim() : null;

	const fromDate = str(args.fromDate);
	const toDate = str(args.toDate);
	const focus = str(args.focus);
	for (const [label, value] of [
		["fromDate", fromDate],
		["toDate", toDate],
	] as const) {
		if (value && !DATE_RE.test(value)) {
			return toolError(
				"remove_workouts_from_calendar",
				`${label} must be YYYY-MM-DD`,
			);
		}
	}

	try {
		const { accessToken, calendarId, timezone } = await getCalendarContext(
			context.userId,
		);
		const existing = await fetchExisting(accessToken, calendarId);
		const { remove, skippedEdits } = filterRemovals(
			existing,
			{ fromDate, toDate, focus },
			timezone,
			Date.now(),
		);

		const failures: string[] = [];
		for (const event of remove) {
			try {
				await deleteEvent(accessToken, calendarId, event.id);
			} catch (err) {
				failures.push((err as Error).message);
			}
		}

		const removed: SyncRow[] = remove.map(rowOf);
		const result: CalendarRemovalResult = {
			removed,
			skipped: skippedEdits,
			filters: { fromDate, toDate, focus },
		};

		const lines = [
			removed.length
				? `Removed ${removed.length} planned workout(s): ${summarize(removed)}`
				: "No matching planned workouts found",
		];
		if (skippedEdits)
			lines.push(
				`${skippedEdits} event(s) skipped because the athlete edited them in Google Calendar`,
			);
		if (failures.length) lines.push(`Problems: ${failures.join(" | ")}`);

		return {
			id: "",
			name: "remove_workouts_from_calendar",
			content: lines.join("\n"),
			display: result,
		};
	} catch (err) {
		return toolError("remove_workouts_from_calendar", (err as Error).message);
	}
};
