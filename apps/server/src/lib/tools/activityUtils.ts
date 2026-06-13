import { db } from "../../db.js";
import {
	buildPowerBySecond,
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

export function computePeakPowers(
	records: StoredRecord[],
	summary: ActivitySummary,
): PeakPowers {
	const mapped = records.map((r) => ({
		timestamp: new Date(r.timestamp),
		elapsedSeconds: r.elapsedSeconds,
		power: r.power,
		heartRate: r.heartRate,
		cadence: r.cadence,
		speed: r.speed,
		gradient: r.gradient,
		lat: r.lat,
		lng: r.lng,
	}));
	const powerBySecond = buildPowerBySecond(mapped);
	return {
		peak5s: peakPowerFromSeconds(powerBySecond, 5),
		peak30s: peakPowerFromSeconds(powerBySecond, 30),
		peak1min: summary.peak1minPower ?? peakPowerFromSeconds(powerBySecond, 60),
		peak5min: summary.peak5minPower ?? peakPowerFromSeconds(powerBySecond, 300),
		peak10min: peakPowerFromSeconds(powerBySecond, 600),
		peak20min:
			summary.peak20minPower ?? peakPowerFromSeconds(powerBySecond, 1200),
		peak60min: peakPowerFromSeconds(powerBySecond, 3600),
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
		const peakPowers = computePeakPowers(records, summary);
		return {
			id: row.id,
			date: row.date,
			summary,
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
