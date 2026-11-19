import type {
	CalendarRemovalResult,
	CalendarSyncResult,
	CalendarSyncRow,
	PlanRemovalResult,
	PlanSyncResult,
	PlanTargetId,
	PlanTargetRemovalResult,
	PlanTargetStatus,
	PlanTargetSyncResult,
	PlannedWorkout,
} from "@fit-analyzer/shared";
import { planTargetLabel } from "@fit-analyzer/shared";
import {
	deleteEvent,
	insertEvent,
	listUpcomingEvents,
	patchEvent,
} from "./googleCalendarClient.js";
import {
	getCalendarContext,
	getGoogleConnection,
} from "./googleCalendarConnection.js";
import {
	eventFocus,
	filterRemovals,
	mergePlan,
	rowOfEvent,
	toCalendarEventSnapshot,
	type CalendarEventSnapshot,
} from "./googleCalendarSync.js";
import {
	deleteIntervalsIcuEvents,
	listIntervalsIcuEvents,
	upsertIntervalsIcuEvents,
	type IntervalsIcuEvent,
} from "./intervalsIcuClient.js";
import { getIntervalsIcuConnection } from "./intervalsIcuConnection.js";
import {
	icuEventSyncKey,
	icuRemovalCandidates,
	mergeIcuPlan,
} from "./intervalsIcuPlanSync.js";
import {
	forgetPlanSyncMark,
	getPlanSyncMarks,
	recordPlanSyncMark,
} from "./planSyncMarks.js";
import { planEventWindow } from "./planSyncCore.js";
import { getTrainingTimezone } from "./trainingTimezone.js";

/**
 * Plan targets: one plan, many destinations (ADR-0005).
 *
 * The coach authors a plan once and this module fans it out. IntervalsIcu is
 * the primary target when connected — it is the only target the coach reads
 * back, and the only one whose athlete edits are honoured. Google Calendar is
 * a projection: always overwritten from the plan, with the overwritten edits
 * reported to the coach. With Google alone, Google is primary and behaviour is
 * exactly what it was before.
 *
 * Every target enforces the same absolute rule: a workout that has started is
 * never created, updated or deleted.
 */

export interface PlanFilters {
	fromDate: string | null;
	toDate: string | null;
	focus: string | null;
}

export function getConnectedPlanTargets(userId: string): PlanTargetStatus[] {
	const google = getGoogleConnection(userId);
	const icu = getIntervalsIcuConnection(userId);
	// A rejected key cannot hold the plan; the target behaves as disconnected so
	// a Google projection can still carry it until the athlete reconnects.
	const icuConnected = Boolean(icu?.api_key) && icu?.key_valid !== 0;
	const googleConnected = Boolean(google?.calendarId);
	return [
		{
			target: "intervalsIcu",
			connected: icuConnected,
			primary: icuConnected,
			detail: icu?.athlete_name ?? icu?.athlete_id ?? null,
		},
		{
			target: "google",
			connected: googleConnected,
			primary: !icuConnected && googleConnected,
			detail: google?.calendarId ?? null,
		},
	];
}

/** The target that owns the plan, or null when nothing is connected. */
export function primaryPlanTarget(
	targets: PlanTargetStatus[],
): PlanTargetId | null {
	return targets.find((t) => t.connected && t.primary)?.target ?? null;
}

function requireTimezone(userId: string): string {
	const timezone = getTrainingTimezone(userId);
	if (!timezone) throw new Error("Training timezone is not set");
	return timezone;
}

// ─── Google Calendar adapter ──────────────────────────────────────────────────

async function fetchGoogleEvents(userId: string): Promise<{
	accessToken: string;
	calendarId: string;
	timezone: string;
	events: CalendarEventSnapshot[];
}> {
	const context = await getCalendarContext(userId);
	const events = await listUpcomingEvents(
		context.accessToken,
		context.calendarId,
	);
	return { ...context, events: events.map(toCalendarEventSnapshot) };
}

async function syncGoogleTarget(
	userId: string,
	plan: PlannedWorkout[],
	respectEdits: boolean,
): Promise<CalendarSyncResult> {
	const { accessToken, calendarId, timezone, events } =
		await fetchGoogleEvents(userId);
	const { actions, result } = mergePlan(plan, events, timezone, Date.now(), {
		respectEdits,
	});

	// Report only what actually landed: the merge predicts, the API applies.
	const applied = {
		created: [] as CalendarSyncRow[],
		updated: [] as CalendarSyncRow[],
		deletedRows: [] as CalendarSyncRow[],
	};
	for (const action of actions) {
		if (action.kind === "skipEdited" || action.kind === "skipStarted") continue;
		try {
			if (action.kind === "create") {
				await insertEvent(accessToken, calendarId, action.event);
				applied.created.push(action.row);
			} else if (action.kind === "update") {
				await patchEvent(accessToken, calendarId, action.eventId, action.event);
				applied.updated.push(action.row);
			} else {
				await deleteEvent(accessToken, calendarId, action.event.id);
				applied.deletedRows.push(rowOfEvent(action.event));
			}
		} catch (err) {
			const label =
				action.kind === "remove"
					? eventFocus(action.event)
					: action.event.summary;
			result.errors.push(
				`${action.kind} failed for "${label}": ${(err as Error).message}`,
			);
		}
	}
	return {
		...result,
		created: applied.created,
		updated: applied.updated,
		deleted: applied.deletedRows.length,
		deletedRows: applied.deletedRows,
	};
}

async function removeFromGoogleTarget(
	userId: string,
	filters: PlanFilters,
	respectEdits: boolean,
): Promise<{
	removed: CalendarSyncRow[];
	skipped: number;
	overwritten: CalendarSyncRow[];
	errors: string[];
}> {
	const { accessToken, calendarId, timezone, events } =
		await fetchGoogleEvents(userId);
	const { remove, skippedEdits, overwritten } = filterRemovals(
		events,
		filters,
		timezone,
		Date.now(),
		{ respectEdits },
	);
	const removed: CalendarSyncRow[] = [];
	const errors: string[] = [];
	for (const event of remove) {
		try {
			await deleteEvent(accessToken, calendarId, event.id);
		} catch (err) {
			errors.push((err as Error).message);
			continue;
		}
		const start = event.start?.dateTime ?? "";
		removed.push({
			date: start.slice(0, 10),
			startTime: start.slice(11, 16),
			focus: eventFocus(event),
		});
	}
	return { removed, skipped: skippedEdits, overwritten, errors };
}

// ─── IntervalsIcu adapter ─────────────────────────────────────────────────────

async function fetchIcuEvents(userId: string): Promise<{
	apiKey: string;
	timezone: string;
	events: IntervalsIcuEvent[];
}> {
	const connection = getIntervalsIcuConnection(userId);
	if (!connection?.api_key) throw new Error("intervals.icu is not connected");
	const timezone = requireTimezone(userId);
	const { oldest, newest } = planEventWindow();
	const events = await listIntervalsIcuEvents(
		connection.api_key,
		oldest,
		newest,
	);
	return { apiKey: connection.api_key, timezone, events };
}

async function syncIcuTarget(
	userId: string,
	plan: PlannedWorkout[],
	respectEdits: boolean,
): Promise<CalendarSyncResult> {
	const { apiKey, timezone, events } = await fetchIcuEvents(userId);
	const { actions, writtenAt, result } = mergeIcuPlan(
		plan,
		events,
		getPlanSyncMarks(userId, "intervalsIcu"),
		timezone,
		Date.now(),
		{ respectEdits },
	);

	// Report only what actually landed: the merge predicts, the API applies.
	const applied = {
		created: [] as CalendarSyncRow[],
		updated: [] as CalendarSyncRow[],
		deletedRows: [] as CalendarSyncRow[],
	};

	const upserts = actions.filter((a) => a.kind === "upsert");
	if (upserts.length > 0) {
		try {
			await upsertIntervalsIcuEvents(
				apiKey,
				upserts
					.map((a) => (a.kind === "upsert" ? a.event : null))
					.filter((e): e is NonNullable<typeof e> => e !== null),
			);
			for (const action of upserts) {
				if (action.kind !== "upsert") continue;
				recordPlanSyncMark(userId, "intervalsIcu", {
					syncKey: action.key,
					writtenAt,
				});
				if (action.existingId != null) applied.updated.push(action.row);
				else applied.created.push(action.row);
			}
		} catch (err) {
			result.errors.push(`Write failed: ${(err as Error).message}`);
		}
	}

	const deletes = actions.filter((a) => a.kind === "delete");
	if (deletes.length > 0) {
		try {
			await deleteIntervalsIcuEvents(
				apiKey,
				deletes.map((a) => (a.kind === "delete" ? a.event.id : 0)),
			);
			for (const action of deletes) {
				if (action.kind !== "delete") continue;
				applied.deletedRows.push(action.row);
				forgetPlanSyncMark(userId, "intervalsIcu", action.key);
			}
		} catch (err) {
			result.errors.push(`Delete failed: ${(err as Error).message}`);
		}
	}

	return {
		...result,
		created: applied.created,
		updated: applied.updated,
		deleted: applied.deletedRows.length,
		deletedRows: applied.deletedRows,
	};
}

async function removeFromIcuTarget(
	userId: string,
	filters: PlanFilters,
	respectEdits: boolean,
): Promise<{
	removed: CalendarSyncRow[];
	skipped: number;
	overwritten: CalendarSyncRow[];
	errors: string[];
}> {
	const { apiKey, timezone, events } = await fetchIcuEvents(userId);
	const { remove, skippedEdits, overwritten } = icuRemovalCandidates(
		events,
		getPlanSyncMarks(userId, "intervalsIcu"),
		filters,
		timezone,
		Date.now(),
		{ respectEdits },
	);
	const removed: CalendarSyncRow[] = [];
	const errors: string[] = [];
	if (remove.length > 0) {
		try {
			await deleteIntervalsIcuEvents(
				apiKey,
				remove.map((ev) => ev.id),
			);
		} catch (err) {
			return {
				removed,
				skipped: skippedEdits,
				overwritten,
				errors: [(err as Error).message],
			};
		}
		for (const ev of remove) {
			const start = ev.start_date_local ?? "";
			removed.push({
				date: start.slice(0, 10),
				startTime: start.slice(11, 16),
				focus: ev.name ?? "",
			});
			const key = icuEventSyncKey(ev);
			if (key) forgetPlanSyncMark(userId, "intervalsIcu", key);
		}
	}
	return { removed, skipped: skippedEdits, overwritten, errors };
}

// ─── Fan-out ──────────────────────────────────────────────────────────────────

function emptySyncResult(
	target: PlanTargetId,
	error: string,
): PlanTargetSyncResult {
	return {
		target,
		created: [],
		updated: [],
		skipped: [],
		notScheduled: [],
		deleted: 0,
		deletedRows: [],
		skippedEdits: 0,
		overwritten: [],
		errors: [error],
	};
}

export async function syncPlanAcrossTargets(
	userId: string,
	plan: PlannedWorkout[],
): Promise<PlanSyncResult> {
	const targets = getConnectedPlanTargets(userId).filter((t) => t.connected);
	if (targets.length === 0) {
		throw new Error(
			"No plan target is connected. Connect intervals.icu or Google Calendar in Settings.",
		);
	}

	const results = await Promise.all(
		targets.map(async (t): Promise<PlanTargetSyncResult> => {
			try {
				const result =
					t.target === "intervalsIcu"
						? await syncIcuTarget(userId, plan, t.primary)
						: await syncGoogleTarget(userId, plan, t.primary);
				return { target: t.target, ...result };
			} catch (err) {
				return emptySyncResult(t.target, (err as Error).message);
			}
		}),
	);

	return {
		targets: results,
		primary: primaryPlanTarget(targets),
		errors: results.flatMap((r) =>
			r.errors.map((e) => `${planTargetLabel(r.target)}: ${e}`),
		),
	};
}

export async function removePlanAcrossTargets(
	userId: string,
	filters: PlanFilters,
): Promise<{ plan: PlanRemovalResult; errors: string[] }> {
	const targets = getConnectedPlanTargets(userId).filter((t) => t.connected);
	if (targets.length === 0) {
		throw new Error(
			"No plan target is connected. Connect intervals.icu or Google Calendar in Settings.",
		);
	}
	const errors: string[] = [];
	const results: PlanTargetRemovalResult[] = await Promise.all(
		targets.map(async (t): Promise<PlanTargetRemovalResult> => {
			try {
				const out =
					t.target === "intervalsIcu"
						? await removeFromIcuTarget(userId, filters, t.primary)
						: await removeFromGoogleTarget(userId, filters, t.primary);
				errors.push(
					...out.errors.map((e) => `${planTargetLabel(t.target)}: ${e}`),
				);
				return {
					target: t.target,
					removed: out.removed,
					skipped: out.skipped,
					overwritten: out.overwritten,
				};
			} catch (err) {
				errors.push(`${planTargetLabel(t.target)}: ${(err as Error).message}`);
				return { target: t.target, removed: [], skipped: 0, overwritten: [] };
			}
		}),
	);
	return { plan: { targets: results, filters }, errors };
}
