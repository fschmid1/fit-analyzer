import {
	detectHeartRateIntervals,
	detectPowerIntervals,
	mapStoredRecords,
	type Interval,
	type ToolDefinition,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

export const analyzeIntervalsDefinition: ToolDefinition = {
	name: "analyze_intervals",
	description:
		"Detect intervals (sustained efforts) in an activity by power or heart rate thresholds. Scans the ride for contiguous blocks at or above the threshold; short dips up to coastingTolerance are bridged. Returns each interval's duration, average power, HR, and cadence.",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description: "Activity ID (defaults to current thread's activity)",
			},
			minPower: {
				type: "number",
				description:
					"Power threshold in watts; intervals must stay at or above this (default 200)",
			},
			minSeconds: {
				type: "number",
				description: "Minimum duration in seconds (default 10)",
			},
			coastingTolerance: {
				type: "number",
				description:
					"Max seconds below the threshold to bridge within one effort (default 5)",
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
			: 5;
	const minHr =
		typeof args.minHeartRate === "number" && args.minHeartRate > 0
			? args.minHeartRate
			: null;

	const storedRecords = data.records;
	if (storedRecords.length === 0) {
		return {
			id: "",
			name: "analyze_intervals",
			content: "",
			display: null,
			error: "Activity has no records.",
		};
	}
	const records = mapStoredRecords(storedRecords);

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
			hrIntervals = detectHeartRateIntervals(
				records,
				hrThreshold,
				minSeconds,
				coastingTolerance,
			);
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
};
