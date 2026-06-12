import { db } from "../../db.js";
import { debug } from "../debug.js";
import {
	buildPowerBySecond,
	peakPowerFromSeconds,
	type ActivitySummary,
	type Interval,
	type LapMarker,
	type StoredRecord,
	type ToolDefinition,
	type ToolResult,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

const getByIdStmt = db.prepare(
	`SELECT id, date, summary, records, laps, intervals, interval_minutes, custom_ranges, strava_activity_id as stravaActivityId
     FROM activities
     WHERE id = ? AND user_id = ?`,
);

const getByDateStmt = db.prepare(
	`SELECT id, date, summary, records, laps, intervals, interval_minutes, custom_ranges, strava_activity_id as stravaActivityId
     FROM activities
     WHERE user_id = ? AND date = ?
     ORDER BY created_at DESC
     LIMIT 1`,
);

const listByDateStmt = db.prepare(
	`SELECT id, date FROM activities
     WHERE user_id = ? AND date = ?
     ORDER BY created_at DESC`,
);

interface ActivityRow {
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

interface PeakPowers {
	peak5s: number | null;
	peak30s: number | null;
	peak1min: number | null;
	peak5min: number | null;
	peak10min: number | null;
	peak20min: number | null;
	peak60min: number | null;
}

function computePeakPowers(
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

function rowToDisplay(row: ActivityRow) {
	const summary = JSON.parse(row.summary) as ActivitySummary;
	const records = JSON.parse(row.records) as StoredRecord[];
	const laps = JSON.parse(row.laps) as LapMarker[];
	const intervals = JSON.parse(row.intervals || "[]") as Interval[];
	const peakPowers = computePeakPowers(records, summary);
	return {
		summary,
		records,
		laps,
		intervals,
		peakPowers,
		date: row.date,
		id: row.id,
	};
}

export const activityLookupDefinition: ToolDefinition = {
	name: "activity_lookup",
	description:
		"Fetch detailed data for a past activity by date (e.g. '2024-06-12') or activity ID. Returns power, heart rate, cadence, intervals, and peak powers.",
	parameters: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description: "Activity date in YYYY-MM-DD format",
			},
			activityId: {
				type: "string",
				description: "Activity ID",
			},
		},
		required: [],
	},
};

export const activityLookupHandler: ToolHandler = async (args, userId) => {
	const end = debug.time("tool", "activity_lookup");
	try {
		const date = typeof args.date === "string" ? args.date.trim() : "";
		const activityId =
			typeof args.activityId === "string" ? args.activityId.trim() : "";

		debug.log("tool", "activity_lookup lookup", { userId, date, activityId });

		if (!date && !activityId) {
			return {
				id: "",
				name: "activity_lookup",
				content: "",
				display: null,
				error: "Provide at least one of `date` or `activityId`.",
			};
		}

		let row: ActivityRow | undefined;
		if (activityId) {
			row = getByIdStmt.get(activityId, userId) as ActivityRow | undefined;
			if (!row) {
				return {
					id: "",
					name: "activity_lookup",
					content: "",
					display: null,
					error: `No activity found for id ${activityId}.`,
				};
			}
		} else {
			row = getByDateStmt.get(userId, date) as ActivityRow | undefined;
			if (!row) {
				const sameDate = listByDateStmt.all(userId, date) as {
					id: string;
					date: string;
				}[];
				if (sameDate.length === 0) {
					return {
						id: "",
						name: "activity_lookup",
						content: "",
						display: null,
						error: `No activity found for date ${date}.`,
					};
				}
				row = getByIdStmt.get(sameDate[0].id, userId) as ActivityRow;
			}
		}

		const data = rowToDisplay(row);
		const s = data.summary;
		const lines: string[] = [];
		lines.push(`Activity ${data.id} (${data.date}):`);
		lines.push(
			`Duration: ${Math.round((s.totalTimerTime ?? 0) / 60)} min, Distance: ${
				s.totalDistanceKm != null ? `${s.totalDistanceKm} km` : "n/a"
			}`,
		);
		if (s.avgPower != null) lines.push(`Avg power: ${s.avgPower} W`);
		if (s.normalizedPower != null) lines.push(`NP: ${s.normalizedPower} W`);
		if (s.maxPower != null) lines.push(`Max power: ${s.maxPower} W`);
		if (s.avgHeartRate != null) lines.push(`Avg HR: ${s.avgHeartRate} bpm`);
		if (s.maxHeartRate != null) lines.push(`Max HR: ${s.maxHeartRate} bpm`);
		if (s.avgCadence != null) lines.push(`Avg cadence: ${s.avgCadence} rpm`);
		if (s.totalWork != null) lines.push(`Total work: ${s.totalWork} kJ`);

		const peaks = data.peakPowers;
		const peakLines: string[] = [];
		if (peaks.peak5s != null) peakLines.push(`5s: ${peaks.peak5s}W`);
		if (peaks.peak30s != null) peakLines.push(`30s: ${peaks.peak30s}W`);
		if (peaks.peak1min != null) peakLines.push(`1m: ${peaks.peak1min}W`);
		if (peaks.peak5min != null) peakLines.push(`5m: ${peaks.peak5min}W`);
		if (peaks.peak10min != null) peakLines.push(`10m: ${peaks.peak10min}W`);
		if (peaks.peak20min != null) peakLines.push(`20m: ${peaks.peak20min}W`);
		if (peaks.peak60min != null) peakLines.push(`60m: ${peaks.peak60min}W`);
		if (peakLines.length > 0) {
			lines.push(`Peak powers — ${peakLines.join(", ")}`);
		}

		if (data.intervals.length > 0) {
			lines.push(
				`Intervals: ${data.intervals
					.map(
						(i) =>
							`#${i.index} ${Math.round(i.duration)}s @ ${i.avgPower ?? "?"}W`,
					)
					.join("; ")}`,
			);
		}

		return {
			id: "",
			name: "activity_lookup",
			content: lines.join("\n"),
			display: {
				id: data.id,
				date: data.date,
				summary: data.summary,
				records: data.records,
				intervals: data.intervals,
				laps: data.laps,
				peakPowers: data.peakPowers,
			},
		};
	} finally {
		end();
	}
};
