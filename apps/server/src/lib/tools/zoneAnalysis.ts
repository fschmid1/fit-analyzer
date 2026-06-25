import {
	POWER_ZONE_BANDS,
	HR_ZONE_BANDS,
	type ToolDefinition,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { computeAllTimeEstimates } from "../athleteStats.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

export const zoneAnalysisDefinition: ToolDefinition = {
	name: "zone_analysis",
	description:
		"Compute time-in-zone distribution for power and heart rate for a given activity. Requires FTP and max HR (uses estimates if not provided).",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description: "Activity ID (defaults to current thread's activity)",
			},
			ftp: {
				type: "number",
				description:
					"Functional Threshold Power in watts (uses estimate if omitted)",
			},
			maxHr: {
				type: "number",
				description: "Maximum heart rate in bpm (uses recorded max if omitted)",
			},
		},
		required: [],
	},
};

export const zoneAnalysisHandler: ToolHandler = async (args, context) => {
	const activityId = resolveActivityId(args, context);
	if (!activityId) {
		return {
			id: "",
			name: "zone_analysis",
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
			name: "zone_analysis",
			content: "",
			display: null,
			error: `Activity ${activityId} not found.`,
		};
	}

	const ftp =
		typeof args.ftp === "number" && args.ftp > 0
			? args.ftp
			: computeAllTimeEstimates(context.userId, null).estimatedFtp;
	if (!ftp) {
		return {
			id: "",
			name: "zone_analysis",
			content: "",
			display: null,
			error: "Could not estimate FTP. Please provide the ftp parameter.",
		};
	}

	const maxHr =
		typeof args.maxHr === "number" && args.maxHr > 0
			? args.maxHr
			: data.summary.maxHeartRate;
	if (!maxHr) {
		return {
			id: "",
			name: "zone_analysis",
			content: "",
			display: null,
			error: "Could not determine max HR. Please provide the maxHr parameter.",
		};
	}

	const records = data.records;
	const totalSeconds =
		records.length > 0 ? records[records.length - 1].elapsedSeconds : 0;

	const powerZoneSeconds = new Array(POWER_ZONE_BANDS.length).fill(0);
	let powerZeroCount = 0;
	const hrZoneSeconds = new Array(HR_ZONE_BANDS.length).fill(0);
	let hrNullCount = 0;

	let prevElapsedSeconds = records.length > 0 ? records[0].elapsedSeconds : 0;

	for (const r of records) {
		const delta = r.elapsedSeconds - prevElapsedSeconds;
		if (delta <= 0) continue;
		prevElapsedSeconds = r.elapsedSeconds;

		if (r.power != null && r.power > 0) {
			const ratio = r.power / ftp;
			for (let i = 0; i < POWER_ZONE_BANDS.length; i++) {
				if (
					ratio >= POWER_ZONE_BANDS[i].min &&
					ratio < POWER_ZONE_BANDS[i].max
				) {
					powerZoneSeconds[i] += delta;
					break;
				}
			}
		} else if (r.power === 0) {
			powerZeroCount += delta;
		}

		if (r.heartRate != null && r.heartRate > 0) {
			const ratio = r.heartRate / maxHr;
			for (let i = 0; i < HR_ZONE_BANDS.length; i++) {
				if (ratio >= HR_ZONE_BANDS[i].min && ratio < HR_ZONE_BANDS[i].max) {
					hrZoneSeconds[i] += delta;
					break;
				}
			}
		} else {
			hrNullCount += delta;
		}
	}

	const fmt = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = Math.round(s % 60);
		return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
	};

	const powerZoneData = POWER_ZONE_BANDS.map((z, i) => ({
		zone: z.name,
		seconds: powerZoneSeconds[i],
		percent:
			totalSeconds > 0
				? Math.round((powerZoneSeconds[i] / totalSeconds) * 100)
				: 0,
	}));

	const hrZoneData = HR_ZONE_BANDS.map((z, i) => ({
		zone: z.name,
		seconds: hrZoneSeconds[i],
		percent:
			totalSeconds > 0
				? Math.round((hrZoneSeconds[i] / totalSeconds) * 100)
				: 0,
	}));

	const lines: string[] = [];
	lines.push(`Zone analysis for activity ${data.id} (${data.date})`);
	lines.push(`FTP: ${ftp} W, Max HR: ${maxHr} bpm`);
	lines.push("");
	lines.push("Power Zones:");
	for (const z of powerZoneData) {
		lines.push(`  ${z.zone}: ${fmt(z.seconds)} (${z.percent}%)`);
	}
	if (powerZeroCount > 0) {
		lines.push(
			`  Coasting: ${fmt(powerZeroCount)} (${Math.round((powerZeroCount / totalSeconds) * 100)}%)`,
		);
	}
	lines.push("");
	lines.push("Heart Rate Zones:");
	for (const z of hrZoneData) {
		lines.push(`  ${z.zone}: ${fmt(z.seconds)} (${z.percent}%)`);
	}

	return {
		id: "",
		name: "zone_analysis",
		content: lines.join("\n"),
		display: {
			activityId: data.id,
			date: data.date,
			ftp,
			maxHr,
			powerZones: powerZoneData,
			hrZones: hrZoneData,
		},
	};
};
