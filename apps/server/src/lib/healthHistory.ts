import { db } from "../db.js";

/**
 * Shared per-user daily health-snapshot history, persisted by source.
 * Each row holds one JSON daily snapshot for a given integration source
 * ("health_auto_export" | "openwearables"). Contexts are built from a
 * rolling window of these rows, so a source that polls or pushes on its
 * own schedule accumulates history the same way.
 */
export type HealthHistorySource = "health_auto_export" | "openwearables";

const upsertStmt = db.prepare(
	`INSERT INTO health_daily_history (user_id, source, date, data, updated_at)
   VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
   ON CONFLICT(user_id, source, date) DO UPDATE SET
     data = excluded.data,
     updated_at = excluded.updated_at`,
);

const getRangeStmt = db.prepare<
	{ date: string; data: string; updated_at: string },
	[string, string, string, string]
>(
	`SELECT date, data, updated_at FROM health_daily_history
   WHERE user_id = ? AND source = ? AND date >= ? AND date <= ?
   ORDER BY date ASC`,
);

const getLastUpdatedStmt = db.prepare<{ updated_at: string }, [string, string]>(
	`SELECT updated_at FROM health_daily_history
   WHERE user_id = ? AND source = ?
   ORDER BY updated_at DESC LIMIT 1`,
);

const clearSourceStmt = db.prepare(
	"DELETE FROM health_daily_history WHERE user_id = ? AND source = ?",
);

/**
 * Persist one daily snapshot. When a row already exists for the date, the
 * caller-supplied merge function combines existing and incoming data so
 * partial deliveries accumulate instead of overwriting each other.
 */
export function upsertDailySnapshot<T>(
	userId: string,
	source: HealthHistorySource,
	date: string,
	incoming: T,
	merge: (existing: T, incoming: T) => T,
): void {
	const existingRow = db
		.prepare(
			"SELECT data FROM health_daily_history WHERE user_id = ? AND source = ? AND date = ?",
		)
		.get(userId, source, date) as { data: string } | undefined;
	let final = incoming;
	if (existingRow) {
		try {
			final = merge(JSON.parse(existingRow.data) as T, incoming);
		} catch {
			/* ignore parse errors, fall back to incoming snapshot */
		}
	}
	upsertStmt.run(userId, source, date, JSON.stringify(final));
}

export interface StoredHistoryRow<T> {
	date: string;
	snap: T;
	updatedAt: string;
}

/** Parsed snapshots for a user/source in the given date range, oldest first. */
export function getDailySnapshots<T>(
	userId: string,
	source: HealthHistorySource,
	startDate: string,
	endDate: string,
): StoredHistoryRow<T>[] {
	return getRangeStmt.all(userId, source, startDate, endDate).map((row) => ({
		date: row.date,
		snap: JSON.parse(row.data) as T,
		updatedAt: row.updated_at,
	}));
}

/** Newest `updated_at` across a source's stored snapshots, or null. */
export function getLastHistoryUpdate(
	userId: string,
	source: HealthHistorySource,
): string | null {
	return getLastUpdatedStmt.get(userId, source)?.updated_at ?? null;
}

export function clearSourceHistory(
	userId: string,
	source: HealthHistorySource,
): void {
	clearSourceStmt.run(userId, source);
}
