import { addDays, mondayOf, planWeekFor } from "@fit-analyzer/shared";
import { wallClockMinute } from "./googleCalendarSync.js";

/**
 * Pure Plan-week scheduling math — no I/O, no db. Kept separate from
 * planRefreshSettings so tests can exercise it without the shared db singleton.
 *
 * Plan weeks are due on Sunday from 18:00 in the user's training timezone: the
 * refresh runs Sunday evening and populates the *upcoming* Mon–Sun week. At any
 * other moment the due week is the week containing today, so enabling the
 * refresh mid-week catches up against the current week immediately.
 */

/** Wall-clock "today" (YYYY-MM-DD) in the user's training timezone. */
export function planRefreshToday(now: Date, timezone: string): string {
	return wallClockMinute(now, timezone).slice(0, 10);
}

function isSundayEvening(now: Date, timezone: string): boolean {
	const wall = wallClockMinute(now, timezone);
	const date = wall.slice(0, 10);
	const isSunday = addDays(mondayOf(date), 6) === date;
	return isSunday && wall.slice(11, 16) >= "18:00";
}

/** The Monday (YYYY-MM-DD) of the Plan week a refresh targets right now. */
export function duePlanWeek(now: Date, timezone: string): string {
	const currentMonday = mondayOf(planRefreshToday(now, timezone));
	return isSundayEvening(now, timezone)
		? addDays(currentMonday, 7)
		: currentMonday;
}

/** ISO week key of the Plan week a refresh targets right now. */
export function duePlanWeekKey(now: Date, timezone: string): string {
	return planWeekFor(duePlanWeek(now, timezone)).key;
}

/**
 * Whether a refresh is due given the stored Refresh watermark and the week key
 * the schedule currently targets. ISO week keys of the same shape compare
 * chronologically as strings, so this is idempotent across ticks and
 * self-heals a watermark left behind by downtime.
 */
export function isRefreshDue(
	watermark: string | null,
	targetWeekKey: string,
): boolean {
	return !watermark || watermark < targetWeekKey;
}
