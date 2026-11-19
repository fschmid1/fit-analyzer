import type { CalendarSyncRow, PlannedWorkout } from "@fit-analyzer/shared";
import { DEFAULT_START_TIME } from "@fit-analyzer/shared";

/**
 * The plan-side mechanics every target shares: validation, the sync key and the
 * display row. Identity is date + start time + focus (never a provider id), so a
 * re-sync recognises its own workouts on any target and moving a workout reads
 * as a delete + create.
 *
 * Targets differ only in how they store the key and detect athlete edits:
 * Google stamps extended properties, IntervalsIcu derives a uid from the same
 * key and keeps write marks.
 */

export const PLAN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PLAN_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The stored start time, defaulting the missing/blank case. */
export function normalizePlanStartTime(
	startTime: string | null | undefined,
): string {
	return startTime && PLAN_TIME_RE.test(startTime)
		? startTime
		: DEFAULT_START_TIME;
}

export function planSyncKey(
	workout: Pick<PlannedWorkout, "date" | "startTime" | "focus">,
): string {
	return `${workout.date}T${normalizePlanStartTime(workout.startTime)}|${workout.focus
		.trim()
		.toLowerCase()}`;
}

/** One row in a Plan sync result, shown in the tool display. */
export function planSyncRow(
	workout: Pick<PlannedWorkout, "date" | "startTime" | "focus">,
): CalendarSyncRow {
	return {
		date: workout.date,
		startTime: normalizePlanStartTime(workout.startTime),
		focus: workout.focus.trim(),
	};
}

export interface ValidPlanWorkout {
	workout: PlannedWorkout;
	key: string;
	/** Wall-clock start "YYYY-MM-DDTHH:MM". */
	startWall: string;
}

/**
 * Validate and key the plan once, so both targets accept and reject exactly the
 * same entries. Valid rows keep plan order; duplicates of one key are rejected
 * after the first.
 */
export function validatePlanWorkouts(plan: PlannedWorkout[]): {
	valid: ValidPlanWorkout[];
	errors: string[];
} {
	const valid: ValidPlanWorkout[] = [];
	const errors: string[] = [];
	const seen = new Set<string>();

	for (const workout of plan) {
		const focus = (workout.focus ?? "").trim();
		if (!PLAN_DATE_RE.test(workout.date)) {
			errors.push(`Invalid date "${workout.date}" for "${focus || "workout"}"`);
			continue;
		}
		if (!focus) {
			errors.push(`Missing focus for workout on ${workout.date}`);
			continue;
		}
		if (
			typeof workout.durationMinutes !== "number" ||
			!(workout.durationMinutes > 0)
		) {
			errors.push(`Invalid duration for "${focus}" on ${workout.date}`);
			continue;
		}
		if (workout.startTime != null && !PLAN_TIME_RE.test(workout.startTime)) {
			errors.push(
				`Invalid startTime "${workout.startTime}" for "${focus}" on ${workout.date}`,
			);
			continue;
		}

		const key = planSyncKey(workout);
		if (seen.has(key)) {
			errors.push(
				`Duplicate workout "${focus}" on ${workout.date} at ${normalizePlanStartTime(workout.startTime)}`,
			);
			continue;
		}
		seen.add(key);
		valid.push({
			workout,
			key,
			startWall: `${workout.date}T${normalizePlanStartTime(workout.startTime)}`,
		});
	}

	return { valid, errors };
}

/** The date window every plan read and write covers: yesterday through +120 days. */
export function planEventWindow(now: Date = new Date()): {
	oldest: string;
	newest: string;
} {
	const oldest = new Date(now);
	oldest.setDate(oldest.getDate() - 1);
	const newest = new Date(now);
	newest.setDate(newest.getDate() + 120);
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	return { oldest: iso(oldest), newest: iso(newest) };
}
