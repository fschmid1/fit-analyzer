import { db } from "../../db.js";
import { debug } from "../debug.js";
import {
	buildPowerBySecond,
	peakPowerFromSeconds,
	type ActivitySummary,
	type StoredRecord,
	type ToolDefinition,
	type ToolResult,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

const DURATIONS_SECONDS = [5, 30, 60, 300, 600, 1200, 3600] as const;

const mostRecentStmt = db.prepare(
	`SELECT id, date, records, summary FROM activities
     WHERE user_id = ?
     ORDER BY date DESC, created_at DESC
     LIMIT 1`,
);

const getByIdStmt = db.prepare(
	`SELECT id, date, records, summary FROM activities
     WHERE id = ? AND user_id = ?`,
);

const allSummariesAndRecordsStmt = db.prepare(
	"SELECT records, summary FROM activities WHERE user_id = ?",
);

interface ActivityRow {
	id: string;
	date: string;
	records: string;
	summary: string;
}

function computePowerCurve(
	records: StoredRecord[],
): Record<number, number | null> {
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
	const out: Record<number, number | null> = {};
	for (const seconds of DURATIONS_SECONDS) {
		out[seconds] = peakPowerFromSeconds(powerBySecond, seconds);
	}
	return out;
}

export const powerCurveDefinition: ToolDefinition = {
	name: "power_curve",
	description:
		"Compare the power-duration curve of a specific activity against the athlete's all-time bests. Identifies strengths and weaknesses across different durations.",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description: "Activity ID (defaults to most recent)",
			},
		},
		required: [],
	},
};

export const powerCurveHandler: ToolHandler = async (args, userId) => {
	const end = debug.time("tool", "power_curve");
	try {
		const activityId =
			typeof args.activityId === "string" ? args.activityId.trim() : "";

		debug.log("tool", "power_curve params", { userId, activityId });

		let row: ActivityRow | undefined;
		if (activityId) {
			row = getByIdStmt.get(activityId, userId) as ActivityRow | undefined;
			if (!row) {
				return {
					id: "",
					name: "power_curve",
					content: "",
					display: null,
					error: `No activity found for id ${activityId}.`,
				};
			}
		} else {
			row = mostRecentStmt.get(userId) as ActivityRow | undefined;
			if (!row) {
				return {
					id: "",
					name: "power_curve",
					content: "",
					display: null,
					error: "No activities found for this user.",
				};
			}
		}

		let activityRecords: StoredRecord[];
		try {
			activityRecords = JSON.parse(row.records) as StoredRecord[];
		} catch {
			return {
				id: "",
				name: "power_curve",
				content: "",
				display: null,
				error: "Failed to parse activity records.",
			};
		}
		const current = computePowerCurve(activityRecords);

		const allRows = allSummariesAndRecordsStmt.all(userId) as {
			records: string;
			summary: string;
		}[];
		debug.log("tool", "power_curve computing all-time bests", {
			userId,
			activityCount: allRows.length,
		});

		const allTimeBest: Record<number, number> = {};
		for (const seconds of DURATIONS_SECONDS) allTimeBest[seconds] = 0;
		for (const r of allRows) {
			let recs: StoredRecord[];
			let summary: ActivitySummary;
			try {
				recs = JSON.parse(r.records) as StoredRecord[];
				summary = JSON.parse(r.summary) as ActivitySummary;
			} catch {
				continue;
			}
			// Use summary peak values as a fast path where available
			if (summary.peak1minPower != null) {
				allTimeBest[60] = Math.max(allTimeBest[60], summary.peak1minPower);
			}
			if (summary.peak5minPower != null) {
				allTimeBest[300] = Math.max(allTimeBest[300], summary.peak5minPower);
			}
			if (summary.peak20minPower != null) {
				allTimeBest[1200] = Math.max(allTimeBest[1200], summary.peak20minPower);
			}
			const curve = computePowerCurve(recs);
			for (const seconds of DURATIONS_SECONDS) {
				const value = curve[seconds];
				if (value != null) {
					allTimeBest[seconds] = Math.max(allTimeBest[seconds], value);
				}
			}
		}

		const durations = DURATIONS_SECONDS.map((seconds) => {
			const currentVal = current[seconds] ?? null;
			const bestVal = allTimeBest[seconds] > 0 ? allTimeBest[seconds] : null;
			const percent =
				currentVal != null && bestVal != null && bestVal > 0
					? Math.round((currentVal / bestVal) * 100)
					: null;
			return {
				seconds,
				current: currentVal,
				allTimeBest: bestVal,
				percentOfBest: percent,
			};
		});

		const lines = [
			`Power curve for activity ${row.id} (${row.date}) vs all-time bests:`,
			...durations.map(
				(d) =>
					`- ${d.seconds}s: ${d.current ?? "n/a"} W${
						d.allTimeBest != null
							? ` (best ${d.allTimeBest} W, ${d.percentOfBest ?? "?"}%)`
							: ""
					}`,
			),
		];

		return {
			id: "",
			name: "power_curve",
			content: lines.join("\n"),
			display: {
				activityId: row.id,
				activityDate: row.date,
				durations,
			},
		};
	} finally {
		end();
	}
};
