import { debug } from "../debug.js";
import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

interface SteadyBlock {
	startSeconds: number;
	endSeconds: number;
	duration: number;
	avgPower: number;
	powerVariance: number;
	firstHalfRatio: number;
	secondHalfRatio: number;
	driftPercent: number;
	interpretation: string;
}

function interpretDrift(driftPercent: number): string {
	const abs = Math.abs(driftPercent);
	if (abs < 5) return "excellent";
	if (abs < 10) return "good";
	if (abs < 15) return "moderate fatigue";
	return "significant decoupling";
}

export const cardiacDriftDefinition: ToolDefinition = {
	name: "cardiac_drift",
	description:
		"Analyze cardiac drift (aerobic decoupling) during steady-state efforts. Measures how heart rate rises relative to power over sustained efforts.",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description: "Activity ID (defaults to current thread's activity)",
			},
			minDuration: {
				type: "number",
				description:
					"Minimum steady effort duration in seconds (default 600 = 10min)",
			},
			powerVariance: {
				type: "number",
				description:
					"Max power variance percent to consider 'steady' (default 10)",
			},
		},
		required: [],
	},
};

export const cardiacDriftHandler: ToolHandler = async (args, context) => {
	const end = debug.time("tool", "cardiac_drift");
	try {
		const activityId = resolveActivityId(args, context);
		if (!activityId) {
			return {
				id: "",
				name: "cardiac_drift",
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
				name: "cardiac_drift",
				content: "",
				display: null,
				error: `Activity ${activityId} not found.`,
			};
		}

		const minDuration =
			typeof args.minDuration === "number" && args.minDuration > 0
				? Math.max(120, Math.floor(args.minDuration))
				: 600;
		const maxVariance =
			typeof args.powerVariance === "number" && args.powerVariance > 0
				? args.powerVariance
				: 10;

		const records = data.records;
		if (records.length < minDuration) {
			return {
				id: "",
				name: "cardiac_drift",
				content: "",
				display: null,
				error: `Activity too short (${records.length}s) for drift analysis (minimum ${minDuration}s).`,
			};
		}

		const blocks: SteadyBlock[] = [];
		const windowSize = Math.min(minDuration, records.length);

		let i = 0;
		while (i <= records.length - windowSize) {
			const window = records.slice(i, i + windowSize);

			const powers = window
				.map((r) => r.power)
				.filter((p): p is number => p != null && p > 0);
			const hrs = window
				.map((r) => r.heartRate)
				.filter((h): h is number => h != null && h > 0);

			if (powers.length < windowSize * 0.5 || hrs.length < windowSize * 0.5) {
				i += Math.max(1, Math.floor(windowSize / 2));
				continue;
			}

			const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;
			const powerStdDev = Math.sqrt(
				powers.reduce((acc, p) => acc + (p - avgPower) ** 2, 0) / powers.length,
			);
			const powerVarPct = avgPower > 0 ? (powerStdDev / avgPower) * 100 : 100;

			if (powerVarPct > maxVariance) {
				i += Math.max(1, Math.floor(windowSize / 4));
				continue;
			}

			const half = Math.floor(hrs.length / 2);
			const firstHalfHR = hrs.slice(0, half);
			const secondHalfHR = hrs.slice(half);
			const firstHalfPower = powers.slice(0, half);
			const secondHalfPower = powers.slice(half);

			const avgHR1 =
				firstHalfHR.length > 0
					? firstHalfHR.reduce((a, b) => a + b, 0) / firstHalfHR.length
					: 0;
			const avgHR2 =
				secondHalfHR.length > 0
					? secondHalfHR.reduce((a, b) => a + b, 0) / secondHalfHR.length
					: 0;
			const avgPow1 =
				firstHalfPower.length > 0
					? firstHalfPower.reduce((a, b) => a + b, 0) / firstHalfPower.length
					: 0;
			const avgPow2 =
				secondHalfPower.length > 0
					? secondHalfPower.reduce((a, b) => a + b, 0) / secondHalfPower.length
					: 0;

			const firstRatio = avgPow1 > 0 ? avgHR1 / avgPow1 : 0;
			const secondRatio = avgPow2 > 0 ? avgHR2 / avgPow2 : 0;
			const driftPct =
				firstRatio > 0 ? ((secondRatio - firstRatio) / firstRatio) * 100 : 0;

			blocks.push({
				startSeconds: window[0].elapsedSeconds,
				endSeconds: window[window.length - 1].elapsedSeconds,
				duration: windowSize,
				avgPower: Math.round(avgPower),
				powerVariance: Math.round(powerVarPct * 10) / 10,
				firstHalfRatio: Math.round(firstRatio * 100) / 100,
				secondHalfRatio: Math.round(secondRatio * 100) / 100,
				driftPercent: Math.round(driftPct * 10) / 10,
				interpretation: interpretDrift(driftPct),
			});

			i += windowSize;
		}

		if (blocks.length === 0) {
			return {
				id: "",
				name: "cardiac_drift",
				content:
					"No steady-state blocks found with the given thresholds. Try reducing minDuration or increasing powerVariance.",
				display: {
					activityId: data.id,
					blocks: [],
				},
			};
		}

		const lines = [
			`Cardiac drift analysis for activity ${data.id} (${data.date}):`,
		];
		for (const block of blocks) {
			const startMin = Math.floor(block.startSeconds / 60);
			const endMin = Math.floor(block.endSeconds / 60);
			lines.push(
				`- ${startMin}:${String(block.startSeconds % 60).padStart(2, "0")}–${endMin}:${String(block.endSeconds % 60).padStart(2, "0")} (${Math.round(block.duration / 60)}min @ ${block.avgPower}W): drift ${block.driftPercent > 0 ? "+" : ""}${block.driftPercent}% — ${block.interpretation}`,
			);
		}

		return {
			id: "",
			name: "cardiac_drift",
			content: lines.join("\n"),
			display: {
				activityId: data.id,
				blocks,
			},
		};
	} finally {
		end();
	}
};
