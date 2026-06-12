import { debug } from "../debug.js";
import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

export const currentActivityDefinition: ToolDefinition = {
	name: "current_activity",
	description:
		"Fetch the full data for the activity currently being discussed. Returns summary, intervals, peak powers, and all per-second records.",
	parameters: {
		type: "object",
		properties: {},
		required: [],
	},
};

export const currentActivityHandler: ToolHandler = async (args, context) => {
	const end = debug.time("tool", "current_activity");
	try {
		const activityId = resolveActivityId(args, context);
		if (!activityId) {
			return {
				id: "",
				name: "current_activity",
				content: "",
				display: null,
				error:
					"No activity is associated with this conversation. Use activity_lookup instead.",
			};
		}

		const data = getActivityById(activityId, context.userId);
		if (!data) {
			return {
				id: "",
				name: "current_activity",
				content: "",
				display: null,
				error: `Activity ${activityId} not found.`,
			};
		}

		const s = data.summary;
		const lines: string[] = [];
		lines.push(`Current activity ${data.id} (${data.date}):`);
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
			name: "current_activity",
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
