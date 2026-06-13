import { debug } from "../debug.js";
import type { Interval, ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

function computeAverages(
	records: {
		power: number | null;
		heartRate: number | null;
		cadence: number | null;
		elapsedSeconds: number;
	}[],
) {
	const includedRecords = records.filter((r) => r.cadence !== 0);
	const validPower = includedRecords.filter((r) => r.power != null);
	const validHR = includedRecords.filter((r) => r.heartRate != null);
	const validCadence = includedRecords.filter((r) => r.cadence != null);
	let duration = 0;
	for (let i = 0; i < records.length - 1; i++) {
		if (records[i].cadence === 0) continue;
		const diff = records[i + 1].elapsedSeconds - records[i].elapsedSeconds;
		if (diff > 0) duration += diff;
	}
	return {
		avgPower:
			validPower.length > 0
				? Math.round(
						validPower.reduce((s, r) => s + (r.power ?? 0), 0) /
							validPower.length,
					)
				: null,
		avgHeartRate:
			validHR.length > 0
				? Math.round(
						validHR.reduce((s, r) => s + (r.heartRate ?? 0), 0) /
							validHR.length,
					)
				: null,
		avgCadence:
			validCadence.length > 0
				? Math.round(
						validCadence.reduce((s, r) => s + (r.cadence ?? 0), 0) /
							validCadence.length,
					)
				: null,
		duration,
	};
}

function detectPowerIntervals(
	records: {
		power: number | null;
		heartRate: number | null;
		cadence: number | null;
		elapsedSeconds: number;
	}[],
	minAvgPower: number,
	minSeconds: number,
	coastingTolerance = 2,
): Interval[] {
	if (records.length === 0 || minAvgPower <= 0 || minSeconds <= 0) return [];

	const segments: { startIdx: number; endIdx: number }[] = [];
	let segmentStart = -1;

	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		if (r.power != null && r.power > 0) {
			if (segmentStart === -1) segmentStart = i;
		} else if (segmentStart !== -1) {
			segments.push({ startIdx: segmentStart, endIdx: i - 1 });
			segmentStart = -1;
		}
	}
	if (segmentStart !== -1) {
		segments.push({ startIdx: segmentStart, endIdx: records.length - 1 });
	}

	const merged: { startIdx: number; endIdx: number }[] = [];
	let current: (typeof segments)[0] | null = null;

	for (const seg of segments) {
		if (!current) {
			current = seg;
			continue;
		}
		const gapEnd = records[current.endIdx].elapsedSeconds;
		const gapStart = records[seg.startIdx].elapsedSeconds;
		if (gapStart - gapEnd <= coastingTolerance) {
			current.endIdx = seg.endIdx;
		} else {
			merged.push(current);
			current = seg;
		}
	}
	if (current) merged.push(current);

	const results: Interval[] = [];
	if (merged.length === 0) return [];

	const maxSeconds = records[records.length - 1].elapsedSeconds;

	for (const seg of merged) {
		const startSeconds = records[seg.startIdx].elapsedSeconds;
		const endSeconds = Math.min(records[seg.endIdx].elapsedSeconds, maxSeconds);
		const duration = endSeconds - startSeconds;

		if (duration < minSeconds) continue;

		const slice = records.slice(seg.startIdx, seg.endIdx + 1);
		const stats = computeAverages(slice);

		if (stats.avgPower === null || stats.avgPower < minAvgPower) continue;

		results.push({
			index: results.length,
			startSeconds,
			endSeconds,
			avgPower: stats.avgPower,
			normalizedPower: null,
			avgHeartRate: stats.avgHeartRate,
			avgCadence: stats.avgCadence,
			normalizedCadence: null,
			duration,
		});
	}

	return results;
}

function detectHrIntervals(
	records: {
		power: number | null;
		heartRate: number | null;
		cadence: number | null;
		elapsedSeconds: number;
	}[],
	minHr: number,
	minSeconds: number,
): Interval[] {
	if (records.length === 0 || minHr <= 0 || minSeconds <= 0) return [];

	const segments: { startIdx: number; endIdx: number }[] = [];
	let segmentStart = -1;

	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		if (r.heartRate != null && r.heartRate >= minHr) {
			if (segmentStart === -1) segmentStart = i;
		} else if (segmentStart !== -1) {
			segments.push({ startIdx: segmentStart, endIdx: i - 1 });
			segmentStart = -1;
		}
	}
	if (segmentStart !== -1) {
		segments.push({ startIdx: segmentStart, endIdx: records.length - 1 });
	}

	const results: Interval[] = [];
	const maxSeconds = records[records.length - 1].elapsedSeconds;

	for (const seg of segments) {
		const startSeconds = records[seg.startIdx].elapsedSeconds;
		const endSeconds = Math.min(records[seg.endIdx].elapsedSeconds, maxSeconds);
		const duration = endSeconds - startSeconds;

		if (duration < minSeconds) continue;

		const slice = records.slice(seg.startIdx, seg.endIdx + 1);
		const stats = computeAverages(slice);

		results.push({
			index: results.length,
			startSeconds,
			endSeconds,
			avgPower: stats.avgPower,
			normalizedPower: null,
			avgHeartRate: stats.avgHeartRate,
			avgCadence: stats.avgCadence,
			normalizedCadence: null,
			duration,
		});
	}

	return results;
}

export const analyzeIntervalsDefinition: ToolDefinition = {
	name: "analyze_intervals",
	description:
		"Detect intervals (sustained efforts) in an activity by power or heart rate thresholds. Returns each interval's duration, average power, HR, and cadence.",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description: "Activity ID (defaults to current thread's activity)",
			},
			minPower: {
				type: "number",
				description: "Minimum average power in watts (default 200)",
			},
			minSeconds: {
				type: "number",
				description: "Minimum duration in seconds (default 10)",
			},
			coastingTolerance: {
				type: "number",
				description:
					"Max coasting gap to merge adjacent efforts in seconds (default 2)",
			},
			minHeartRate: {
				type: "number",
				description: "Minimum heart rate in bpm for HR-based detection",
			},
			detectionMode: {
				type: "string",
				description:
					"Detection mode: 'power', 'heart_rate', or 'both' (default 'power')",
			},
		},
		required: [],
	},
};

export const analyzeIntervalsHandler: ToolHandler = async (args, context) => {
	const end = debug.time("tool", "analyze_intervals");
	try {
		const activityId = resolveActivityId(args, context);
		if (!activityId) {
			return {
				id: "",
				name: "analyze_intervals",
				content: "",
				display: null,
				error:
					"No activity specified. Provide an activityId or use within a thread linked to an activity.",
			};
		}

		const data = getActivityById(activityId, context.userId);
		if (!data) {
			return {
				id: "",
				name: "analyze_intervals",
				content: "",
				display: null,
				error: `Activity ${activityId} not found.`,
			};
		}

		const rawMode =
			typeof args.detectionMode === "string"
				? args.detectionMode.trim().toLowerCase()
				: "power";
		const ALLOWED_MODES = ["power", "heart_rate", "both"];
		const mode = ALLOWED_MODES.includes(rawMode) ? rawMode : null;
		if (mode == null) {
			return {
				id: "",
				name: "analyze_intervals",
				content: "",
				display: null,
				error: "detectionMode must be one of: power, heart_rate, both",
			};
		}
		const minPower =
			typeof args.minPower === "number" && args.minPower > 0
				? args.minPower
				: 200;
		const minSeconds =
			typeof args.minSeconds === "number" && args.minSeconds > 0
				? args.minSeconds
				: 10;
		const coastingTolerance =
			typeof args.coastingTolerance === "number" && args.coastingTolerance >= 0
				? args.coastingTolerance
				: 2;
		const minHr =
			typeof args.minHeartRate === "number" && args.minHeartRate > 0
				? args.minHeartRate
				: null;

		const records = data.records;
		if (records.length === 0) {
			return {
				id: "",
				name: "analyze_intervals",
				content: "",
				display: null,
				error: "Activity has no records.",
			};
		}

		let powerIntervals: Interval[] = [];
		let hrIntervals: Interval[] = [];

		if (mode === "power" || mode === "both") {
			powerIntervals = detectPowerIntervals(
				records,
				minPower,
				minSeconds,
				coastingTolerance,
			);
		}
		if (mode === "heart_rate" || mode === "both") {
			const hrThreshold =
				minHr ??
				(data.summary.avgHeartRate
					? Math.round(data.summary.avgHeartRate * 0.85)
					: 0);
			if (hrThreshold > 0) {
				hrIntervals = detectHrIntervals(records, hrThreshold, minSeconds);
			}
		}

		const fmt = (s: number) => {
			const m = Math.floor(s / 60);
			const sec = s % 60;
			return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
		};

		const lines: string[] = [];
		lines.push(`Interval analysis for activity ${data.id} (${data.date})`);
		lines.push(`Mode: ${mode}`);

		if (powerIntervals.length > 0) {
			lines.push("");
			lines.push(`Power intervals (≥${minPower}W, ≥${minSeconds}s):`);
			for (const iv of powerIntervals) {
				lines.push(
					`  #${iv.index + 1}: ${fmt(iv.duration)} @ ${iv.avgPower ?? "?"}W${iv.avgHeartRate != null ? `, HR ${iv.avgHeartRate}bpm` : ""}${iv.avgCadence != null ? `, ${iv.avgCadence}rpm` : ""}`,
				);
			}
		} else if (mode === "power" || mode === "both") {
			lines.push("");
			lines.push(`No power intervals found (≥${minPower}W, ≥${minSeconds}s).`);
		}

		if (hrIntervals.length > 0) {
			const hrThreshold =
				minHr ??
				(data.summary.avgHeartRate
					? Math.round(data.summary.avgHeartRate * 0.85)
					: 0);
			lines.push("");
			lines.push(`HR intervals (≥${hrThreshold}bpm, ≥${minSeconds}s):`);
			for (const iv of hrIntervals) {
				lines.push(
					`  #${iv.index + 1}: ${fmt(iv.duration)} @ ${iv.avgHeartRate ?? "?"}bpm${iv.avgPower != null ? `, ${iv.avgPower}W` : ""}`,
				);
			}
		} else if (mode === "heart_rate" || mode === "both") {
			lines.push("");
			lines.push("No HR intervals found matching criteria.");
		}

		return {
			id: "",
			name: "analyze_intervals",
			content: lines.join("\n"),
			display: {
				activityId: data.id,
				date: data.date,
				powerIntervals,
				hrIntervals,
				mode,
				params: { minPower, minSeconds, coastingTolerance, minHr },
			},
		};
	} finally {
		end();
	}
};
