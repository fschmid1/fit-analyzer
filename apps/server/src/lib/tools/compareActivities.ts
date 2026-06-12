import { debug } from "../debug.js";
import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getActivityById } from "./activityUtils.js";
import { db } from "../../db.js";

const getByDateStmt = db.prepare(
	`SELECT id FROM activities
     WHERE user_id = ? AND date = ?
     ORDER BY created_at DESC
     LIMIT 1`,
);

function resolveActivityId(
	args: Record<string, unknown>,
	userId: string,
	key: string,
	dateKey: string,
): string | null {
	const id = typeof args[key] === "string" ? (args[key] as string).trim() : "";
	if (id) return id;
	const date =
		typeof args[dateKey] === "string" ? (args[dateKey] as string).trim() : "";
	if (!date) return null;
	const row = getByDateStmt.get(userId, date) as { id: string } | undefined;
	return row?.id ?? null;
}

interface MetricDiff {
	metric: string;
	value1: string;
	value2: string;
	delta: string;
	deltaPercent: string;
}

function fmtNum(
	v: number | null | undefined,
	suffix = "",
	decimals = 0,
): string {
	if (v == null) return "n/a";
	const n =
		typeof decimals === "number" ? v.toFixed(decimals) : String(Math.round(v));
	return `${n}${suffix}`;
}

function computeDiff(
	name: string,
	v1: number | null | undefined,
	v2: number | null | undefined,
	suffix: string,
	unit: string,
): MetricDiff | null {
	const a = v1 ?? null;
	const b = v2 ?? null;
	if (a == null && b == null) return null;
	const delta = a != null && b != null ? b - a : null;
	const deltaPercent =
		a != null && b != null && a !== 0
			? Math.round(((b - a) / Math.abs(a)) * 100)
			: null;
	return {
		metric: `${name} (${unit})`,
		value1: fmtNum(a, suffix),
		value2: fmtNum(b, suffix),
		delta:
			delta != null ? (delta >= 0 ? "+" : "") + fmtNum(delta, suffix) : "n/a",
		deltaPercent:
			deltaPercent != null
				? `${deltaPercent >= 0 ? "+" : ""}${deltaPercent}%`
				: "n/a",
	};
}

export const compareActivitiesDefinition: ToolDefinition = {
	name: "compare_activities",
	description:
		"Compare two activities side-by-side. Returns a diff table of key metrics.",
	parameters: {
		type: "object",
		properties: {
			activityId1: {
				type: "string",
				description: "First activity ID",
			},
			activityId2: {
				type: "string",
				description: "Second activity ID",
			},
			date1: {
				type: "string",
				description: "First activity date (YYYY-MM-DD)",
			},
			date2: {
				type: "string",
				description: "Second activity date (YYYY-MM-DD)",
			},
		},
		required: [],
	},
};

export const compareActivitiesHandler: ToolHandler = async (args, context) => {
	const end = debug.time("tool", "compare_activities");
	try {
		const id1 = resolveActivityId(args, context.userId, "activityId1", "date1");
		const id2 = resolveActivityId(args, context.userId, "activityId2", "date2");

		if (!id1 || !id2) {
			return {
				id: "",
				name: "compare_activities",
				content: "",
				display: null,
				error:
					"Provide two activity IDs or dates to compare. Use activityId1/activityId2 or date1/date2.",
			};
		}

		if (id1 === id2) {
			return {
				id: "",
				name: "compare_activities",
				content: "",
				display: null,
				error:
					"Both activities are the same. Provide two different activities.",
			};
		}

		const a1 = getActivityById(id1, context.userId);
		const a2 = getActivityById(id2, context.userId);

		if (!a1) {
			return {
				id: "",
				name: "compare_activities",
				content: "",
				display: null,
				error: `Activity ${id1} not found.`,
			};
		}
		if (!a2) {
			return {
				id: "",
				name: "compare_activities",
				content: "",
				display: null,
				error: `Activity ${id2} not found.`,
			};
		}

		const s1 = a1.summary;
		const s2 = a2.summary;
		const p1 = a1.peakPowers;
		const p2 = a2.peakPowers;

		const diffs: MetricDiff[] = [];

		const add = (d: MetricDiff | null) => {
			if (d) diffs.push(d);
		};

		add(
			computeDiff("Duration", s1.totalTimerTime, s2.totalTimerTime, "s", "sec"),
		);
		add(
			computeDiff("Distance", s1.totalDistanceKm, s2.totalDistanceKm, "", "km"),
		);
		add(computeDiff("Avg Power", s1.avgPower, s2.avgPower, "", "W"));
		add(computeDiff("NP", s1.normalizedPower, s2.normalizedPower, "", "W"));
		add(computeDiff("Max Power", s1.maxPower, s2.maxPower, "", "W"));
		add(computeDiff("Avg HR", s1.avgHeartRate, s2.avgHeartRate, "", "bpm"));
		add(computeDiff("Max HR", s1.maxHeartRate, s2.maxHeartRate, "", "bpm"));
		add(computeDiff("Avg Cadence", s1.avgCadence, s2.avgCadence, "", "rpm"));
		add(computeDiff("Total Work", s1.totalWork, s2.totalWork, "", "kJ"));
		add(computeDiff("Peak 1min", p1.peak1min, p2.peak1min, "", "W"));
		add(computeDiff("Peak 5min", p1.peak5min, p2.peak5min, "", "W"));
		add(computeDiff("Peak 20min", p1.peak20min, p2.peak20min, "", "W"));

		const lines: string[] = [];
		lines.push(`Comparing ${a1.date} vs ${a2.date}:`);
		lines.push("");
		lines.push("Metric | Activity 1 | Activity 2 | Delta | %");
		lines.push("--- | --- | --- | --- | ---");
		for (const d of diffs) {
			lines.push(
				`${d.metric} | ${d.value1} | ${d.value2} | ${d.delta} | ${d.deltaPercent}`,
			);
		}

		return {
			id: "",
			name: "compare_activities",
			content: lines.join("\n"),
			display: {
				activity1: {
					id: a1.id,
					date: a1.date,
					summary: a1.summary,
					peakPowers: a1.peakPowers,
				},
				activity2: {
					id: a2.id,
					date: a2.date,
					summary: a2.summary,
					peakPowers: a2.peakPowers,
				},
				diffs,
			},
		};
	} finally {
		end();
	}
};
