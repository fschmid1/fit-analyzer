import type {
	CalendarSyncRow,
	PlannedWorkout,
	PlanWorkout,
	WorkoutStep,
	WorkoutStepItem,
	WorkoutTarget,
} from "@fit-analyzer/shared";
import {
	DEFAULT_PLANNED_SPORT,
	renderWorkoutSteps,
	totalWorkoutMinutes,
} from "@fit-analyzer/shared";
import type {
	IntervalsIcuEvent,
	IntervalsIcuEventInput,
} from "./intervalsIcuClient.js";
import {
	PLAN_DATE_RE,
	normalizePlanStartTime,
	planSyncKey,
	planSyncRow,
	validatePlanWorkouts,
} from "./planSyncCore.js";
import { wallClockMinute } from "./wallClock.js";

/**
 * Pure IntervalsIcu Plan-sync mechanics: sync keys, event payloads, the merge,
 * and the projection back to plan workouts. No I/O — the client and the tools
 * call these, and the tests pin the semantics.
 *
 * Identity: our events carry `uid = fit-analyzer|<sync key>`, so
 * `upsertOnUid` updates in place and any event without our prefix is someone
 * else's (a race, a note, the athlete's own workout) and is never touched.
 *
 * Edit detection: intervals.icu has no per-event metadata slot we can stamp,
 * so the server records `plan_sync_marks` (sync key → write time). An event
 * whose `updated` is newer than that mark counts as an athlete edit.
 */

export const ICU_UID_PREFIX = "fit-analyzer|";

/**
 * Our write mark is taken before the bulk write, so an event stored moments
 * later must not count as an athlete edit. A minute covers a large bulk write.
 */
const EDIT_SKEW_MS = 60_000;

/** A plan-sync write mark: when the server last wrote a sync key. */
export interface IcuSyncMark {
	syncKey: string;
	writtenAt: number;
}

export type IcuSyncAction =
	| {
			kind: "upsert";
			key: string;
			row: CalendarSyncRow;
			event: IntervalsIcuEventInput;
			existingId: number | null;
	  }
	| {
			kind: "delete";
			key: string;
			row: CalendarSyncRow;
			event: IntervalsIcuEvent;
	  };

export interface IcuMergeResult {
	created: CalendarSyncRow[];
	updated: CalendarSyncRow[];
	deleted: number;
	deletedRows: CalendarSyncRow[];
	skipped: CalendarSyncRow[];
	skippedEdits: number;
	/** Projection only: edits that were overwritten, for the coach's report. */
	overwritten: CalendarSyncRow[];
	notScheduled: CalendarSyncRow[];
	errors: string[];
}

export function icuUid(syncKey: string): string {
	return `${ICU_UID_PREFIX}${syncKey}`;
}

/** Sync key of one of our events, or null for anyone else's. */
export function icuEventSyncKey(ev: IntervalsIcuEvent): string | null {
	if (ev.category && ev.category !== "WORKOUT") return null;
	const uid = ev.uid ?? "";
	return uid.startsWith(ICU_UID_PREFIX)
		? uid.slice(ICU_UID_PREFIX.length)
		: null;
}

/** The wall-clock start "YYYY-MM-DDTHH:MM" intervals.icu holds, or null. */
function eventWallStart(ev: IntervalsIcuEvent): string | null {
	const local = ev.start_date_local;
	if (!local || local.length < 16) return null;
	return `${local.slice(0, 10)}T${local.slice(11, 16)}`;
}

function eventDurationMinutes(ev: IntervalsIcuEvent): number {
	if (typeof ev.moving_time === "number" && ev.moving_time > 0) {
		return Math.round(ev.moving_time / 60);
	}
	const start = ev.start_date_local;
	const end = ev.end_date_local;
	if (!start || !end) return 60;
	const delta =
		(Date.parse(`${end.slice(0, 19)}Z`) -
			Date.parse(`${start.slice(0, 19)}Z`)) /
		60_000;
	return Number.isFinite(delta) && delta > 0 ? Math.round(delta) : 60;
}

function rowOfEvent(ev: IntervalsIcuEvent): CalendarSyncRow {
	const start = eventWallStart(ev) ?? "";
	return {
		date: start.slice(0, 10),
		startTime: start.slice(11, 16),
		focus: ev.name ?? "",
	};
}

/**
 * Separates the coach's prose from the rendered structure in an event
 * description. IntervalsIcu has no structured read-back field besides the
 * description, so the text keeps both; the plan read-back cuts here so the
 * screen and the coach see the prose once and the structure from `workout_doc`.
 */
const STRUCTURE_MARKER = "\n\n———\n\n";

/** Event description: the coach's prose, then the rendered structure. */
export function buildIcuDescription(workout: PlannedWorkout): string {
	const steps = workout.steps ?? [];
	const parts: string[] = [];
	if (workout.description?.trim()) parts.push(workout.description.trim());
	if (steps.length > 0) parts.push(renderWorkoutSteps(steps));
	return parts.join(STRUCTURE_MARKER);
}

/** The coach's prose from a stored event description. */
function eventProse(description: string | null | undefined): string | null {
	if (!description) return null;
	const index = description.indexOf(STRUCTURE_MARKER);
	const prose = (
		index === -1 ? description : description.slice(0, index)
	).trim();
	return prose === "" ? null : prose;
}

function icuTarget(target: WorkoutTarget): Record<string, unknown> {
	const units =
		target.metric === "power"
			? "%ftp"
			: target.metric === "hr"
				? "%lthr"
				: "%pace";
	const body: Record<string, unknown> = { units };
	if (target.range) {
		body.start = target.range.low;
		body.end = target.range.high;
	} else {
		body.value = target.pct;
	}
	return { [target.metric]: body };
}

/** IntervalsIcu native `workout_doc`: steps with duration and a % target. */
export function buildIcuWorkoutDoc(
	steps: WorkoutStepItem[],
): Record<string, unknown> | undefined {
	if (steps.length === 0) return undefined;

	const firstTarget = steps
		.map((item) =>
			"repeat" in item ? item.steps.find((s) => s.target)?.target : item.target,
		)
		.find((t): t is WorkoutTarget => Boolean(t));

	const convert = (step: {
		kind: string;
		durationMinutes: number;
		target: WorkoutTarget | null;
		note: string | null;
	}): Record<string, unknown> => ({
		duration: Math.round(step.durationMinutes * 60),
		...(step.target ? icuTarget(step.target) : {}),
		...(step.kind !== "interval" || step.note
			? {
					text: [step.kind !== "interval" ? step.kind : null, step.note]
						.filter(Boolean)
						.join(" — "),
				}
			: {}),
	});

	const docSteps = steps.map((item) =>
		"repeat" in item
			? { reps: item.repeat, steps: item.steps.map(convert) }
			: convert(item),
	);

	return {
		target:
			firstTarget?.metric === "hr"
				? "HR"
				: firstTarget?.metric === "pace"
					? "PACE"
					: "POWER",
		steps: docSteps,
	};
}

/** The event payload for one planned workout. */
export function buildIcuEvent(workout: PlannedWorkout): IntervalsIcuEventInput {
	const key = planSyncKey(workout);
	const start = normalizePlanStartTime(workout.startTime);
	const uid = icuUid(key);
	const steps = workout.steps ?? [];
	const durationMinutes =
		workout.durationMinutes > 0
			? workout.durationMinutes
			: Math.max(1, totalWorkoutMinutes(steps));
	const doc = buildIcuWorkoutDoc(steps);
	return {
		uid,
		external_id: uid,
		category: "WORKOUT",
		type: workout.sport ?? DEFAULT_PLANNED_SPORT,
		start_date_local: `${workout.date}T${start}:00`,
		name: workout.focus.trim(),
		description: buildIcuDescription(workout),
		moving_time: Math.round(durationMinutes * 60),
		...(doc ? { workout_doc: doc } : {}),
	};
}

/**
 * Merge a plan into the athlete's IntervalsIcu calendar.
 *
 * - ours = events whose uid carries our prefix (never races/notes/others)
 * - plan workouts upsert by uid; started/past workouts are not scheduled
 * - our future events absent from the plan are deleted
 * - with `respectEdits` (the primary target), an event updated after our last
 *   write is skipped instead of overwritten/removed. A projection is always
 *   re-asserted.
 */
export function mergeIcuPlan(
	plan: PlannedWorkout[],
	existing: IntervalsIcuEvent[],
	marks: IcuSyncMark[],
	timezone: string,
	nowMs: number,
	options: { respectEdits: boolean },
): {
	actions: IcuSyncAction[];
	writtenAt: number;
	result: IcuMergeResult;
} {
	const nowWall = wallClockMinute(new Date(nowMs), timezone);
	const writtenAt = nowMs;
	const markByKey = new Map(marks.map((m) => [m.syncKey, m]));

	const actions: IcuSyncAction[] = [];
	const result: IcuMergeResult = {
		created: [],
		updated: [],
		deleted: 0,
		deletedRows: [],
		skipped: [],
		skippedEdits: 0,
		overwritten: [],
		notScheduled: [],
		errors: [],
	};

	const existingByKey = new Map<string, IntervalsIcuEvent>();
	const duplicates: IntervalsIcuEvent[] = [];
	for (const ev of existing) {
		const key = icuEventSyncKey(ev);
		if (!key) continue;
		if (existingByKey.has(key)) duplicates.push(ev);
		else existingByKey.set(key, ev);
	}

	// Edit detection is independent of `respectEdits`: a projection reports the
	// edits it overwrites, the primary target honours them.
	const isEdited = (ev: IntervalsIcuEvent, key: string): boolean => {
		const mark = markByKey.get(key);
		if (!mark) return false;
		const updated = ev.updated ? Date.parse(ev.updated) : 0;
		return updated > mark.writtenAt + EDIT_SKEW_MS;
	};

	// Plan side: validation, keys and the started rule are shared with the
	// Google target, so both accept exactly the same plan.
	const { valid, errors } = validatePlanWorkouts(plan);
	result.errors.push(...errors);
	const seenKeys = new Set(valid.map((v) => v.key));

	for (const { workout, key, startWall } of valid) {
		if (startWall <= nowWall) {
			result.notScheduled.push(planSyncRow(workout));
			continue;
		}

		const existingEvent = existingByKey.get(key);
		if (existingEvent && isEdited(existingEvent, key)) {
			if (options.respectEdits) {
				result.skipped.push(planSyncRow(workout));
				continue;
			}
			result.overwritten.push(planSyncRow(workout));
		}

		const event = buildIcuEvent(workout);
		const changed = !existingEvent || icuEventsDiffer(existingEvent, event);
		if (existingEvent && !changed) continue;

		actions.push({
			kind: "upsert",
			key,
			row: planSyncRow(workout),
			event,
			existingId: existingEvent?.id ?? null,
		});
		if (existingEvent) result.updated.push(planSyncRow(workout));
		else result.created.push(planSyncRow(workout));
	}

	for (const ev of existing) {
		const key = icuEventSyncKey(ev);
		if (!key) continue;
		const isDuplicate = duplicates.includes(ev);
		if (!isDuplicate && seenKeys.has(key)) continue;

		const startWall = eventWallStart(ev);
		if (startWall == null || startWall <= nowWall) {
			// Started or past: never touched, duplicates included.
			continue;
		}
		if (isDuplicate) {
			actions.push({ kind: "delete", key, row: rowOfEvent(ev), event: ev });
			result.deleted += 1;
			result.deletedRows.push(rowOfEvent(ev));
			continue;
		}
		if (isEdited(ev, key)) {
			if (options.respectEdits) {
				result.skippedEdits += 1;
				continue;
			}
			result.overwritten.push(rowOfEvent(ev));
		}
		actions.push({ kind: "delete", key, row: rowOfEvent(ev), event: ev });
		result.deleted += 1;
		result.deletedRows.push(rowOfEvent(ev));
	}

	return { actions, writtenAt, result };
}

/** True when an upsert would change the event — avoids no-op writes. */
function icuEventsDiffer(
	existing: IntervalsIcuEvent,
	next: IntervalsIcuEventInput,
): boolean {
	const wall = (s: string | null | undefined) => (s ? s.slice(0, 16) : null);
	return (
		wall(existing.start_date_local) !== wall(next.start_date_local) ||
		(existing.name ?? "") !== next.name ||
		normalizeDesc(existing.description) !== normalizeDesc(next.description) ||
		(existing.moving_time ?? 0) !== next.moving_time ||
		(existing.type ?? "") !== next.type
	);
}

function normalizeDesc(desc: string | null | undefined): string {
	const trimmed = desc?.trim() ?? "";
	return trimmed === "" ? "" : trimmed;
}

/**
 * Pick our future events for a removal request. Filters are ANDed; null
 * filters are ignored. Started events are never removed, and an edit on the
 * primary target is skipped (on a projection it is overwritten and reported).
 */
export function icuRemovalCandidates(
	existing: IntervalsIcuEvent[],
	marks: IcuSyncMark[],
	filters: {
		fromDate: string | null;
		toDate: string | null;
		focus: string | null;
	},
	timezone: string,
	nowMs: number,
	options: { respectEdits: boolean },
): {
	remove: IntervalsIcuEvent[];
	skippedEdits: number;
	overwritten: CalendarSyncRow[];
} {
	const nowWall = wallClockMinute(new Date(nowMs), timezone);
	const markByKey = new Map(marks.map((m) => [m.syncKey, m]));
	const remove: IntervalsIcuEvent[] = [];
	const overwritten: CalendarSyncRow[] = [];
	let skippedEdits = 0;
	for (const ev of existing) {
		const key = icuEventSyncKey(ev);
		if (!key) continue;
		const startWall = eventWallStart(ev);
		if (startWall == null || startWall <= nowWall) continue;
		if (filters.fromDate && startWall.slice(0, 10) < filters.fromDate) continue;
		if (filters.toDate && startWall.slice(0, 10) > filters.toDate) continue;
		if (
			filters.focus &&
			!(ev.name ?? "").toLowerCase().includes(filters.focus.toLowerCase())
		)
			continue;
		const mark = markByKey.get(key);
		const edited =
			mark != null &&
			ev.updated != null &&
			Date.parse(ev.updated) > mark.writtenAt + EDIT_SKEW_MS;
		if (edited && options.respectEdits) {
			skippedEdits += 1;
			continue;
		}
		if (edited) overwritten.push(rowOfEvent(ev));
		remove.push(ev);
	}
	return { remove, skippedEdits, overwritten };
}

/** Map an intervals.icu target object back to the neutral model. */
function icuTargetToTarget(raw: unknown): WorkoutTarget | null {
	if (raw == null || typeof raw !== "object") return null;
	const body = raw as {
		units?: string;
		value?: number;
		start?: number;
		end?: number;
	};
	const metric: WorkoutTarget["metric"] | null =
		body.units === "%ftp"
			? "power"
			: body.units === "%lthr"
				? "hr"
				: body.units === "%pace"
					? "pace"
					: null;
	if (!metric) return null;
	if (body.start != null && body.end != null) {
		return {
			metric,
			pct: Math.round((body.start + body.end) / 2),
			range: { low: Math.round(body.start), high: Math.round(body.end) },
		};
	}
	if (body.value == null) return null;
	return { metric, pct: Math.round(body.value), range: null };
}

/**
 * Reconstruct the neutral step model from a stored `workout_doc`. Used by the
 * plan screen and the coach read-back so a structured workout survives a round
 * trip; unknown shapes yield an empty list rather than an error.
 */
export function icuDocToSteps(doc: unknown): WorkoutStepItem[] {
	if (doc == null || typeof doc !== "object") return [];
	const steps = (doc as { steps?: unknown }).steps;
	if (!Array.isArray(steps)) return [];

	const toStep = (raw: unknown): WorkoutStep | null => {
		if (raw == null || typeof raw !== "object") return null;
		const item = raw as {
			duration?: number;
			power?: unknown;
			hr?: unknown;
			pace?: unknown;
			text?: string;
		};
		if (typeof item.duration !== "number" || item.duration <= 0) return null;
		const target =
			icuTargetToTarget(item.power) ??
			icuTargetToTarget(item.hr) ??
			icuTargetToTarget(item.pace);
		return {
			kind: "interval",
			durationMinutes: Math.max(1, Math.round(item.duration / 60)),
			target,
			note: item.text?.trim() || null,
		};
	};

	const out: WorkoutStepItem[] = [];
	for (const raw of steps) {
		if (raw == null || typeof raw !== "object") continue;
		const item = raw as { reps?: number; steps?: unknown };
		if (typeof item.reps === "number" && Array.isArray(item.steps)) {
			const nested = item.steps
				.map(toStep)
				.filter((s): s is WorkoutStep => s !== null);
			if (nested.length > 0) out.push({ repeat: item.reps, steps: nested });
			continue;
		}
		const step = toStep(raw);
		if (step) out.push(step);
	}
	return out;
}

/**
 * Project one stored event into a PlanWorkout for the /plan screen and the
 * coach read-back. Returns null for events without our uid, without a timed
 * start, or that already started. Steps are reconstructed from `workout_doc`
 * so a structured workout survives the round trip.
 */
export function icuEventToPlanWorkout(
	ev: IntervalsIcuEvent,
	timezone: string,
	now: Date,
	mark: IcuSyncMark | null = null,
): PlanWorkout | null {
	const startWall = eventWallStart(ev);
	if (!startWall) return null;
	if (startWall <= wallClockMinute(now, timezone)) return null;
	const date = startWall.slice(0, 10);
	if (!PLAN_DATE_RE.test(date)) return null;
	const focus = (ev.name ?? "").trim();
	if (!focus) return null;
	const updated = ev.updated ? Date.parse(ev.updated) : 0;
	return {
		id: String(ev.id),
		date,
		startTime: startWall.slice(11, 16),
		durationMinutes: eventDurationMinutes(ev),
		focus,
		description: eventProse(ev.description),
		edited: Boolean(mark && updated > mark.writtenAt + EDIT_SKEW_MS),
		sport: (ev.type as PlanWorkout["sport"]) ?? DEFAULT_PLANNED_SPORT,
		steps: icuDocToSteps(ev.workout_doc),
		target: "intervalsIcu",
	};
}
