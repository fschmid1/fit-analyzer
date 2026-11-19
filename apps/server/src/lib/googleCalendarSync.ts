import {
	DEFAULT_PLANNED_SPORT,
	renderWorkoutSteps,
	type CalendarSyncRow,
	type PlanWorkout,
	type PlannedWorkout,
} from "@fit-analyzer/shared";
import type { GoogleEvent } from "./googleCalendarClient.js";
import {
	PLAN_DATE_RE,
	normalizePlanStartTime,
	planSyncKey,
	planSyncRow,
	validatePlanWorkouts,
} from "./planSyncCore.js";
import { wallClockMinute } from "./wallClock.js";

/**
 * Pure Plan-sync mechanics: sync-key derivation, Google event payloads, and
 * the create/update/delete/skip merge. No I/O — the Google client and the
 * coach tools call these; googleCalendarSync.test.ts pins the semantics.
 *
 * All comparisons are wall-clock in the training timezone: Google keeps the
 * local wall time literal in start.dateTime (RFC 3339 with offset), so
 * slicing gives the training-timezone date/time without IANA math.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Private extended property that marks an event as app-owned. */
export const SYNC_KEY_PROP = "fitAnalyzerSyncKey";

/** Private extended property carrying the workout focus (avoids title parsing). */
export const SYNC_FOCUS_PROP = "fitAnalyzerFocus";

/** Private extended property stamping the last app-write (ms since epoch). */
export const SYNC_STAMP_PROP = "fitAnalyzerSyncStamp";

/** Google Calendar event colorId used for app-owned planned workouts. */
export const PLANNED_WORKOUT_COLOR_ID = "7"; // Peacock — visually distinct.

/** A Google `updated` timestamp must beat our stamp by this much to count
 * as a user edit. The stamp is taken BEFORE our write, so Google's `updated`
 * (set when the write lands) always postdates it — the margin must exceed
 * our worst-case API round trip, not merely scheduler jitter. Writes slower
 * than STAMP_MARGIN_MS are mistaken for user edits and skipped on the next
 * sync (safe direction: the event survives, the coach sees the skip). */
const EDIT_SKEW_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** The subset of a Google Calendar event the sync engine needs. */
export interface CalendarEventSnapshot {
	id: string;
	summary: string | null;
	description: string | null;
	start: { dateTime?: string; date?: string; timeZone?: string } | null;
	end: { dateTime?: string; date?: string; timeZone?: string } | null;
	updated?: string;
	colorId?: string;
	extendedProperties?: {
		private?: Record<string, string>;
	};
}

/** Google Calendar event body for create/update. */
export interface CalendarEventBody {
	summary: string;
	description: string | null;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	colorId: string;
	extendedProperties: { private: Record<string, string> };
}

/**
 * Narrow a Google API event to the snapshot the sync engine operates on. One
 * shared mapper so every read path (Plan sync, removal, plan projection)
 * derives the snapshot identically.
 */
export function toCalendarEventSnapshot(
	ev: GoogleEvent,
): CalendarEventSnapshot {
	return {
		id: ev.id,
		summary: ev.summary ?? null,
		description: ev.description ?? null,
		start: ev.start ?? null,
		end: ev.end ?? null,
		updated: ev.updated,
		colorId: ev.colorId,
		extendedProperties: ev.extendedProperties,
	};
}

/** One row in a Plan sync result, shown in the tool display. */
export type SyncRow = CalendarSyncRow;

/** A plan-sync action produced by merging a plan into existing events. */
export type SyncAction =
	| { kind: "create"; key: string; row: SyncRow; event: CalendarEventBody }
	| {
			kind: "update";
			key: string;
			row: SyncRow;
			eventId: string;
			event: CalendarEventBody;
	  }
	| { kind: "remove"; event: CalendarEventSnapshot }
	| { kind: "skipEdited"; event: CalendarEventSnapshot }
	| { kind: "skipStarted"; event: CalendarEventSnapshot };

export interface MergeResult {
	created: SyncRow[];
	updated: SyncRow[];
	/** Future plan workouts NOT applied because the user edited the event. */
	skipped: SyncRow[];
	/** Plan workouts not scheduled because their start time already passed. */
	notScheduled: SyncRow[];
	/** App events deleted because the new plan no longer contains them. */
	deleted: number;
	/** The deleted events, for display. */
	deletedRows: SyncRow[];
	/** App events not deleted because the user edited them. */
	skippedEdits: number;
	/** Projection only: edits that were overwritten, for the coach's report. */
	overwritten: SyncRow[];
	errors: string[];
}

// ─── Plan projection (read path) ──────────────────────────────────────────────

/**
 * Project one stored event into a PlanWorkout for the /plan screen. Returns
 * null for events with no timed start or whose start already passed. Pure — the
 * read path supplies the calendar rows and the training timezone.
 */
export function toPlanWorkout(
	ev: CalendarEventSnapshot,
	timezone: string,
	now: Date,
): PlanWorkout | null {
	const startWall = eventWallStart(ev);
	if (!startWall) return null;
	if (startWall <= wallClockMinute(now, timezone)) return null;
	const date = startWall.slice(0, 10);
	if (!PLAN_DATE_RE.test(date)) return null;
	const focus = eventFocus(ev);
	if (!focus) return null;
	return {
		id: ev.id,
		date,
		startTime: startWall.slice(11, 16),
		durationMinutes: eventDurationMinutes(ev),
		focus,
		description: ev.description ?? null,
		edited: userEdited(ev),
		sport: DEFAULT_PLANNED_SPORT,
		steps: [],
		target: "google",
	};
}

function eventDurationMinutes(ev: CalendarEventSnapshot): number {
	const start = ev.start?.dateTime;
	const end = ev.end?.dateTime;
	if (!start || !end) return 60;
	const delta =
		(Date.parse(`${end.slice(0, 19)}Z`) -
			Date.parse(`${start.slice(0, 19)}Z`)) /
		60_000;
	return Number.isFinite(delta) && delta > 0 ? Math.round(delta) : 60;
}

// ─── Key + payload derivation ─────────────────────────────────────────────────

/**
 * The Sync key for a planned workout: date + start time + focus, lowercased.
 * Deterministic so repeated syncs recognise their own events; a plan revision
 * that moves a workout to another day yields a new key (delete + create).
 */
export const syncKey = planSyncKey;

/** Event title — the focus, prefixed so app events are recognisable at a glance. */
export function eventTitle(workout: PlannedWorkout): string {
	return `🚴 ${workout.focus}`;
}

/** Wall-clock event body in the training timezone. */
export function buildEvent(
	workout: PlannedWorkout,
	timezone: string,
	nowMs: number,
): CalendarEventBody {
	const start = normalizePlanStartTime(workout.startTime);
	const durationMin =
		typeof workout.durationMinutes === "number" && workout.durationMinutes > 0
			? workout.durationMinutes
			: 60;
	return {
		summary: eventTitle(workout),
		description: buildEventDescription(workout),
		start: { dateTime: `${workout.date}T${start}:00`, timeZone: timezone },
		end: {
			dateTime: `${addMinutes(workout.date, start, durationMin)}:00`,
			timeZone: timezone,
		},
		colorId: PLANNED_WORKOUT_COLOR_ID,
		extendedProperties: {
			private: {
				[SYNC_KEY_PROP]: syncKey(workout),
				[SYNC_FOCUS_PROP]: workout.focus.trim(),
				[SYNC_STAMP_PROP]: String(nowMs),
			},
		},
	};
}

/** The focus a stored event was written with (private property, not the title). */
export function eventFocus(ev: CalendarEventSnapshot): string {
	return (
		ev.extendedProperties?.private?.[SYNC_FOCUS_PROP] ??
		(ev.summary ?? "").replace(/^🚴\s*/, "")
	);
}

/** The event body: the coach's prose, then the rendered structure. */
function buildEventDescription(workout: PlannedWorkout): string | null {
	const parts: string[] = [];
	if (workout.description?.trim()) parts.push(workout.description.trim());
	const steps = workout.steps ?? [];
	if (steps.length > 0) parts.push(renderWorkoutSteps(steps));
	return parts.length > 0 ? parts.join("\n\n") : null;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge a plan into existing app events.
 *
 * - plan workouts → create or update-in-place (by Sync key); workouts that
 *   already started are not created
 * - app events absent from the plan → remove or skipEdited
 * - non-app events → never touched
 * - edit detection: an event hand-edited in Google has an `updated` newer than
 *   our last stamp and is skipped instead of overwritten/removed
 * - started/past events → never touched
 */
export function mergePlan(
	plan: PlannedWorkout[],
	existing: CalendarEventSnapshot[],
	timezone: string,
	nowMs: number,
	options: { respectEdits?: boolean } = {},
): { actions: SyncAction[]; result: MergeResult } {
	const respectEdits = options.respectEdits !== false;
	// A projection is always re-asserted: the primary target owns the plan, so
	// an edit made on the projection is overwritten on the next sync. Started
	// events remain untouchable either way.
	const nowWall = wallClockMinute(new Date(nowMs), timezone);

	const actions: SyncAction[] = [];
	const result: MergeResult = {
		created: [],
		updated: [],
		skipped: [],
		/** Workouts not scheduled because their time already passed. */
		notScheduled: [],
		deleted: 0,
		deletedRows: [],
		skippedEdits: 0,
		overwritten: [],
		errors: [],
	};

	// First event per key; extras (duplicates from manual copies or a past
	// bug) are deleted below so the calendar can't accumulate twins.
	const existingByKey = new Map<string, CalendarEventSnapshot>();
	const duplicateEvents: CalendarEventSnapshot[] = [];
	for (const ev of existing) {
		const key = ev.extendedProperties?.private?.[SYNC_KEY_PROP];
		if (!key) continue;
		if (existingByKey.has(key)) {
			duplicateEvents.push(ev);
		} else {
			existingByKey.set(key, ev);
		}
	}

	// Plan side: validation, keys and the started rule are shared with the
	// IntervalsIcu target, so both accept exactly the same plan.
	const { valid, errors } = validatePlanWorkouts(plan);
	result.errors.push(...errors);
	const seenKeys = new Set(valid.map((v) => v.key));

	for (const { workout, key, startWall } of valid) {
		if (startWall <= nowWall) {
			// Already started or past — not an error, just nothing to schedule.
			result.notScheduled.push(planSyncRow(workout));
			continue;
		}

		const existingEvent = existingByKey.get(key);
		if (!existingEvent) {
			actions.push({
				kind: "create",
				key,
				row: planSyncRow(workout),
				event: buildEvent(workout, timezone, nowMs),
			});
			result.created.push(planSyncRow(workout));
			continue;
		}

		if (respectEdits && userEdited(existingEvent)) {
			actions.push({ kind: "skipEdited", event: existingEvent });
			result.skipped.push(planSyncRow(workout));
			continue;
		}

		// Update in place — only if the payload actually changed.
		const next = buildEvent(workout, timezone, nowMs);
		if (eventsDiffer(existingEvent, next)) {
			// A projection re-asserts the plan, and reports the overwrite.
			if (!respectEdits && userEdited(existingEvent)) {
				result.overwritten.push(planSyncRow(workout));
			}
			actions.push({
				kind: "update",
				key,
				row: planSyncRow(workout),
				eventId: existingEvent.id,
				event: next,
			});
			result.updated.push(planSyncRow(workout));
		}
	}

	// Existing events side: remove app-owned, future, un-edited events the plan
	// no longer contains. Everything else is left alone.
	for (const ev of existing) {
		const key = ev.extendedProperties?.private?.[SYNC_KEY_PROP];
		if (!key) continue;
		const isDuplicate = duplicateEvents.includes(ev);
		if (!isDuplicate && seenKeys.has(key)) continue;

		if (!isFutureEvent(ev, nowWall)) {
			// Started or past: never touched, duplicates included.
			actions.push({ kind: "skipStarted", event: ev });
			continue;
		}
		if (isDuplicate) {
			// Twin events with the same Sync key: remove future extras
			// unconditionally — the canonical (first-seen) one is kept, and a
			// twin belongs to no plan so it can't claim edit protection.
			actions.push({ kind: "remove", event: ev });
			result.deleted += 1;
			result.deletedRows.push(rowOfEvent(ev));
			continue;
		}
		if (respectEdits && userEdited(ev)) {
			actions.push({ kind: "skipEdited", event: ev });
			result.skippedEdits += 1;
			continue;
		}
		actions.push({ kind: "remove", event: ev });
		result.deleted += 1;
		result.deletedRows.push(rowOfEvent(ev));
	}

	return { actions, result };
}

// ─── Removal ──────────────────────────────────────────────────────────────────

/**
 * Pick app-owned future events for remove_planned_workouts.
 * Filters are ANDed; null filters are ignored. Started events and events the
 * user edited are never removed.
 */
export function filterRemovals(
	existing: CalendarEventSnapshot[],
	filters: {
		fromDate: string | null;
		toDate: string | null;
		focus: string | null;
	},
	timezone: string,
	nowMs: number,
	options: { respectEdits?: boolean } = {},
): {
	remove: CalendarEventSnapshot[];
	skippedEdits: number;
	overwritten: SyncRow[];
} {
	const respectEdits = options.respectEdits !== false;
	const nowWall = wallClockMinute(new Date(nowMs), timezone);
	const remove: CalendarEventSnapshot[] = [];
	const overwritten: SyncRow[] = [];
	let skippedEdits = 0;
	for (const ev of existing) {
		const key = ev.extendedProperties?.private?.[SYNC_KEY_PROP];
		if (!key) continue;

		const startWall = eventWallStart(ev);
		if (startWall == null || startWall <= nowWall) continue;
		if (filters.fromDate && startWall.slice(0, 10) < filters.fromDate) continue;
		if (filters.toDate && startWall.slice(0, 10) > filters.toDate) continue;
		if (
			filters.focus &&
			!ev.summary?.toLowerCase().includes(filters.focus.toLowerCase())
		)
			continue;
		if (respectEdits && userEdited(ev)) {
			skippedEdits += 1;
			continue;
		}
		if (!respectEdits && userEdited(ev)) {
			overwritten.push(rowOfEvent(ev));
		}
		remove.push(ev);
	}
	return { remove, skippedEdits, overwritten };
}

// ─── Wall-clock helpers ───────────────────────────────────────────────────────

/** Wall-clock "YYYY-MM-DDTHH:MM" where an event starts, or null if absent. */
function eventWallStart(ev: CalendarEventSnapshot): string | null {
	const dateTime = ev.start?.dateTime;
	if (!dateTime || dateTime.length < 16) return null;
	return `${dateTime.slice(0, 10)}T${dateTime.slice(11, 16)}`;
}

/** An event is future when it hasn't started yet (wall-clock in the training
 * timezone). Started and past events are never touched by sync or removal. */
function isFutureEvent(ev: CalendarEventSnapshot, nowWall: string): boolean {
	const startWall = eventWallStart(ev);
	return startWall != null && startWall > nowWall;
}

function addMinutes(date: string, start: string, minutes: number): string {
	// Pure wall-clock arithmetic via a UTC anchor (same field layout).
	const base = Date.parse(`${date}T${start}:00Z`);
	return new Date(base + minutes * 60_000).toISOString().slice(0, 16);
}

/** Display row for an existing event (used for removals). */
export function rowOfEvent(ev: CalendarEventSnapshot): SyncRow {
	const startWall = eventWallStart(ev) ?? "";
	return {
		date: startWall.slice(0, 10),
		startTime: startWall.slice(11, 16),
		focus: eventFocus(ev),
	};
}

// ─── Edit detection + payload diff ────────────────────────────────────────────

function userEdited(ev: CalendarEventSnapshot): boolean {
	const stamp = Number(ev.extendedProperties?.private?.[SYNC_STAMP_PROP] ?? 0);
	const updatedMs = ev.updated ? Date.parse(ev.updated) : 0;
	return updatedMs > stamp + EDIT_SKEW_MS;
}

/** True when `/events` would change anything — avoids no-op update calls. */
function eventsDiffer(
	existing: CalendarEventSnapshot,
	next: CalendarEventBody,
): boolean {
	const wall = (dt: string | undefined | null) => (dt ? dt.slice(0, 16) : null);
	const startChanged =
		wall(existing.start?.dateTime) !== next.start.dateTime.slice(0, 16);
	const endChanged =
		wall(existing.end?.dateTime) !== next.end.dateTime.slice(0, 16);
	const titleChanged = existing.summary !== next.summary;
	const descChanged =
		normalizeDesc(existing.description) !== normalizeDesc(next.description);
	const colorChanged = (existing.colorId ?? null) !== next.colorId;
	return (
		startChanged || endChanged || titleChanged || descChanged || colorChanged
	);
}

function normalizeDesc(desc: string | null | undefined): string | null {
	const trimmed = desc?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}
