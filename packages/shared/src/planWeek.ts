/**
 * Pure Plan-week calendar math shared by the server (Plan refresh scheduling)
 * and the web (grouping the forward plan by week).
 *
 * All helpers work on wall-clock `YYYY-MM-DD` strings via a UTC anchor, so no
 * timezone is involved — the training timezone only matters for deciding *which
 * date* "today" is, which callers resolve before calling in.
 */

const MS_PER_DAY = 86_400_000;

export interface PlanWeek {
	/** ISO week key, e.g. "2026-W40". */
	key: string;
	/** Monday of the week, YYYY-MM-DD. */
	start: string;
	/** Sunday of the week, YYYY-MM-DD. */
	end: string;
}

function anchor(date: string): number {
	return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
	return new Date(anchor(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Monday-based weekday index: Monday = 0 … Sunday = 6. */
export function mondayIndex(date: string): number {
	return (new Date(anchor(date)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: string): string {
	return addDays(date, -mondayIndex(date));
}

/**
 * ISO-8601 week key for a calendar date, computed off the week's Thursday so
 * the key belongs to the correct ISO week-year (a date in early January can
 * belong to the previous year's final week, and vice versa).
 */
export function isoWeekKey(date: string): string {
	const thursday = addDays(date, 3 - mondayIndex(date));
	const year = Number(thursday.slice(0, 4));
	const week1Monday = mondayOf(`${year}-01-04`);
	const week =
		1 + Math.floor((anchor(thursday) - anchor(week1Monday)) / (7 * MS_PER_DAY));
	return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The Mon–Sun Plan week containing `date`. */
export function planWeekFor(date: string): PlanWeek {
	const start = mondayOf(date);
	return { key: isoWeekKey(start), start, end: addDays(start, 6) };
}
