import { db } from "../../db.js";
import {
	buildPowerBySecond,
	mapStoredRecords,
	peakPowerFromSeconds,
	type ActivitySummary,
	type Interval,
	type LapMarker,
	type StoredRecord,
} from "@fit-analyzer/shared";

const getByIdStmt = db.prepare(
	`SELECT id, date, summary, records, laps, intervals, interval_minutes, custom_ranges, strava_activity_id as stravaActivityId
     FROM activities
     WHERE id = ? AND user_id = ?`,
);

const threadActivityStmt = db.prepare(
	"SELECT activity_id FROM trainer_chats WHERE id = ? AND user_id = ?",
);

export interface ActivityRow {
	id: string;
	date: string;
	summary: string;
	records: string;
	laps: string;
	intervals: string;
	interval_minutes: string;
	custom_ranges: string;
	stravaActivityId: string | null;
}

export interface PeakPowers {
	peak5s: number | null;
	peak30s: number | null;
	peak1min: number | null;
	peak5min: number | null;
	peak10min: number | null;
	peak20min: number | null;
	peak60min: number | null;
}

export function computePeakPowers(records: StoredRecord[]): PeakPowers {
	const powerBySecond = buildPowerBySecond(mapStoredRecords(records));
	return {
		peak5s: peakPowerFromSeconds(powerBySecond, 5),
		peak30s: peakPowerFromSeconds(powerBySecond, 30),
		peak1min: peakPowerFromSeconds(powerBySecond, 60),
		peak5min: peakPowerFromSeconds(powerBySecond, 300),
		peak10min: peakPowerFromSeconds(powerBySecond, 600),
		peak20min: peakPowerFromSeconds(powerBySecond, 1200),
		peak60min: peakPowerFromSeconds(powerBySecond, 3600),
	};
}

/**
 * Recompute peak power fields (1min, 5min, 20min) from records and
 * overwrite the corresponding fields on the summary. Stored summary
 * values may be stale (computed with a previous algorithm), so any
 * code serving activities to the UI or trainer should call this.
 */
export function recomputeSummaryPeakPowers(
	summary: ActivitySummary,
	records: StoredRecord[],
): ActivitySummary {
	if (records.length === 0) return summary;
	const peaks = computePeakPowers(records);
	return {
		...summary,
		peak1minPower: peaks.peak1min,
		peak5minPower: peaks.peak5min,
		peak20minPower: peaks.peak20min,
	};
}

export interface ParsedActivity {
	id: string;
	date: string;
	summary: ActivitySummary;
	records: StoredRecord[];
	laps: LapMarker[];
	intervals: Interval[];
	peakPowers: PeakPowers;
}

export function rowToActivity(row: ActivityRow): ParsedActivity | null {
	try {
		const summary = JSON.parse(row.summary) as ActivitySummary;
		const records = JSON.parse(row.records) as StoredRecord[];
		const laps = JSON.parse(row.laps) as LapMarker[];
		const intervals = JSON.parse(row.intervals || "[]") as Interval[];
		const peakPowers = computePeakPowers(records);
		const updatedSummary = recomputeSummaryPeakPowers(summary, records);
		return {
			id: row.id,
			date: row.date,
			summary: updatedSummary,
			records,
			laps,
			intervals,
			peakPowers,
		};
	} catch {
		return null;
	}
}

export function getActivityById(
	activityId: string,
	userId: string,
): ParsedActivity | null {
	const row = getByIdStmt.get(activityId, userId) as ActivityRow | undefined;
	if (!row) return null;
	return rowToActivity(row);
}

export function resolveActivityId(
	args: Record<string, unknown>,
	context: { userId: string; threadId?: string },
): string | null {
	const explicitId =
		typeof args.activityId === "string" ? args.activityId.trim() : "";
	if (explicitId && explicitId !== "general") return explicitId;

	if (!context.threadId) return null;
	const row = threadActivityStmt.get(context.threadId, context.userId) as
		| { activity_id: string }
		| undefined;
	const threadActivityId = row?.activity_id;
	if (!threadActivityId || threadActivityId === "general") return null;
	return threadActivityId;
}
