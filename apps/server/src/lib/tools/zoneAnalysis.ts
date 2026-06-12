import { debug } from "../debug.js";
import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { computeAllTimeEstimates } from "../athleteStats.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

const POWER_ZONES = [
	{ name: "Z1 Recovery", minFtp: 0, maxFtp: 0.55 },
	{ name: "Z2 Endurance", minFtp: 0.56, maxFtp: 0.75 },
	{ name: "Z3 Tempo", minFtp: 0.76, maxFtp: 0.9 },
	{ name: "Z4 Threshold", minFtp: 0.91, maxFtp: 1.05 },
	{ name: "Z5 VO2max", minFtp: 1.06, maxFtp: 1.2 },
	{ name: "Z6 Anaerobic", minFtp: 1.21, maxFtp: 1.5 },
	{ name: "Z7 Sprint", minFtp: 1.51, maxFtp: Number.POSITIVE_INFINITY },
];

const HR_ZONES = [
	{ name: "Z1 Recovery", minMaxHr: 0, maxMaxHr: 0.6 },
	{ name: "Z2 Endurance", minMaxHr: 0.61, maxMaxHr: 0.7 },
	{ name: "Z3 Tempo", minMaxHr: 0.71, maxMaxHr: 0.8 },
	{ name: "Z4 Threshold", minMaxHr: 0.81, maxMaxHr: 0.9 },
	{ name: "Z5 VO2max", minMaxHr: 0.91, maxMaxHr: 1.0 },
	{ name: "Z6 Anaerobic", minMaxHr: 1.01, maxMaxHr: Number.POSITIVE_INFINITY },
];

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
	const end = debug.time("tool", "zone_analysis");
	try {
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
				error:
					"Could not determine max HR. Please provide the maxHr parameter.",
			};
		}

		const records = data.records;
		const totalSeconds =
			records.length > 0 ? records[records.length - 1].elapsedSeconds : 0;

		const powerZoneSeconds = new Array(POWER_ZONES.length).fill(0);
		let powerZeroCount = 0;
		const hrZoneSeconds = new Array(HR_ZONES.length).fill(0);
		let hrNullCount = 0;

		for (const r of records) {
			if (r.power != null && r.power > 0) {
				const ratio = r.power / ftp;
				for (let i = 0; i < POWER_ZONES.length; i++) {
					if (ratio >= POWER_ZONES[i].minFtp && ratio < POWER_ZONES[i].maxFtp) {
						powerZoneSeconds[i]++;
						break;
					}
				}
			} else if (r.power === 0) {
				powerZeroCount++;
			}

			if (r.heartRate != null && r.heartRate > 0) {
				const ratio = r.heartRate / maxHr;
				for (let i = 0; i < HR_ZONES.length; i++) {
					if (ratio >= HR_ZONES[i].minMaxHr && ratio < HR_ZONES[i].maxMaxHr) {
						hrZoneSeconds[i]++;
						break;
					}
				}
			} else {
				hrNullCount++;
			}
		}

		const fmt = (s: number) => {
			const m = Math.floor(s / 60);
			const sec = s % 60;
			return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
		};

		const powerZoneData = POWER_ZONES.map((z, i) => ({
			zone: z.name,
			seconds: powerZoneSeconds[i],
			percent:
				totalSeconds > 0
					? Math.round((powerZoneSeconds[i] / totalSeconds) * 100)
					: 0,
		}));

		const hrZoneData = HR_ZONES.map((z, i) => ({
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
	} finally {
		end();
	}
};
