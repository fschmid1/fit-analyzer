const DAY_MS = 24 * 60 * 60 * 1000;

/** The window both health sources use for "current" and "7-day" figures. */
export const HEALTH_CONTEXT_DAYS = 7;

/**
 * Date-only bounds for a rolling health-history window. The lower bound is
 * `days - 1` days before today, so `days: 7` covers today and the six days
 * before it. The upper bound is tomorrow: sources can push data dated a day
 * ahead when their timezone is ahead of the server, and dropping that would
 * lose the most recent night.
 */
export function healthHistoryDateRange(
	days: number,
	now = new Date(),
): { startDate: string; endDate: string } {
	const todayUtc = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	const start = new Date(todayUtc - (days - 1) * DAY_MS);
	const end = new Date(todayUtc + DAY_MS);
	const format = (date: Date) => date.toISOString().slice(0, 10);
	return { startDate: format(start), endDate: format(end) };
}

/**
 * Keep only the `days` calendar dates ending at the newest row. Queries fetch
 * an extra day so a timezone ahead of the server cannot push the newest night
 * outside the window; derivation still averages exactly `days` dates.
 */
export function recentDateWindow<T extends { date: string }>(
	rows: T[],
	days: number,
): T[] {
	if (rows.length === 0) return rows;
	const newest = rows.reduce(
		(latest, row) => (row.date > latest ? row.date : latest),
		rows[0].date,
	);
	const newestMs = Date.parse(`${newest}T00:00:00Z`);
	if (!Number.isFinite(newestMs)) return rows;
	const cutoff = new Date(newestMs - (days - 1) * DAY_MS)
		.toISOString()
		.slice(0, 10);
	return rows.filter((row) => row.date >= cutoff && row.date <= newest);
}
