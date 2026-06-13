import { debug } from "../debug.js";
import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getActivityById, resolveActivityId } from "./activityUtils.js";

interface Segment {
	type: "climb" | "descent" | "flat";
	startSeconds: number;
	endSeconds: number;
	duration: number;
	distance: number | null;
	avgGradient: number | null;
	avgPower: number | null;
	avgHeartRate: number | null;
	elevationGain: number | null;
}

export const segmentFinderDefinition: ToolDefinition = {
	name: "segment_finder",
	description:
		"Find climbs, descents, or flat sections in an activity by gradient threshold and minimum duration.",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description: "Activity ID (defaults to current thread's activity)",
			},
			minGradient: {
				type: "number",
				description: "Minimum gradient percent for climbs (default 3)",
			},
			maxGradient: {
				type: "number",
				description: "Maximum gradient percent for descents (default -3)",
			},
			minDuration: {
				type: "number",
				description: "Minimum duration in seconds (default 60)",
			},
			segmentType: {
				type: "string",
				description:
					"Segment type to find: 'climb', 'descent', 'flat', or 'all' (default 'all')",
			},
		},
		required: [],
	},
};

export const segmentFinderHandler: ToolHandler = async (args, context) => {
	const end = debug.time("tool", "segment_finder");
	try {
		const activityId = resolveActivityId(args, context);
		if (!activityId) {
			return {
				id: "",
				name: "segment_finder",
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
				name: "segment_finder",
				content: "",
				display: null,
				error: `Activity ${activityId} not found.`,
			};
		}

		const minGradient =
			typeof args.minGradient === "number" ? args.minGradient : 3;
		const maxGradient =
			typeof args.maxGradient === "number" ? args.maxGradient : -3;
		const minDuration =
			typeof args.minDuration === "number" && args.minDuration > 0
				? args.minDuration
				: 60;
		const segmentTypeRaw =
			typeof args.segmentType === "string"
				? args.segmentType.trim().toLowerCase()
				: "all";

		const findClimbs = segmentTypeRaw === "all" || segmentTypeRaw === "climb";
		const findDescents =
			segmentTypeRaw === "all" || segmentTypeRaw === "descent";
		const findFlats = segmentTypeRaw === "all" || segmentTypeRaw === "flat";

		const records = data.records;
		if (records.length < 2) {
			return {
				id: "",
				name: "segment_finder",
				content: "",
				display: null,
				error: "Activity has insufficient records for segment analysis.",
			};
		}

		type GradSegment = {
			type: "climb" | "descent" | "flat";
			startIdx: number;
			endIdx: number;
		};

		const segments: GradSegment[] = [];
		let currentStart = 0;

		for (let i = 1; i <= records.length; i++) {
			const prev = records[i - 1];
			const curr = i < records.length ? records[i] : null;
			const gradient = prev.gradient;

			let segType: "climb" | "descent" | "flat" | null = null;
			if (gradient != null) {
				if (gradient >= minGradient) segType = "climb";
				else if (gradient <= maxGradient) segType = "descent";
				else if (
					Math.abs(gradient) <
					Math.min(Math.abs(minGradient), Math.abs(maxGradient))
				)
					segType = "flat";
			}

			const shouldBreak =
				curr === null ||
				(segType === "climb" && !findClimbs) ||
				(segType === "descent" && !findDescents) ||
				(segType === "flat" && !findFlats);

			if (
				shouldBreak ||
				(curr &&
					records[currentStart].gradient != null &&
					segType !==
						getType(
							records[currentStart].gradient as number,
							minGradient,
							maxGradient,
						))
			) {
				if (i - 2 >= currentStart) {
					const startGradient = records[currentStart].gradient;
					const segType2 =
						startGradient != null
							? getType(startGradient, minGradient, maxGradient)
							: null;
					if (segType2) {
						segments.push({
							type: segType2,
							startIdx: currentStart,
							endIdx: i - 2,
						});
					}
				}
				currentStart = i - 1;
			}
		}

		// Merge contiguous segments of same type and apply minDuration
		const merged: GradSegment[] = [];
		for (const seg of segments) {
			if (
				merged.length > 0 &&
				merged[merged.length - 1].type === seg.type &&
				seg.startIdx - merged[merged.length - 1].endIdx <= 2
			) {
				merged[merged.length - 1].endIdx = seg.endIdx;
			} else {
				merged.push({ ...seg });
			}
		}

		const results: Segment[] = [];

		for (const seg of merged) {
			const startRecord = records[seg.startIdx];
			const endRecord = records[seg.endIdx];
			const duration = endRecord.elapsedSeconds - startRecord.elapsedSeconds;
			if (duration < minDuration) continue;

			let gradientSum = 0;
			let gradientCount = 0;
			let powerSum = 0;
			let powerCount = 0;
			let hrSum = 0;
			let hrCount = 0;
			let distance = 0;

			for (let i = seg.startIdx; i <= seg.endIdx; i++) {
				const r = records[i];
				if (r.gradient != null) {
					gradientSum += r.gradient;
					gradientCount++;
				}
				if (r.power != null && r.power > 0) {
					powerSum += r.power;
					powerCount++;
				}
				if (r.heartRate != null && r.heartRate > 0) {
					hrSum += r.heartRate;
					hrCount++;
				}
				if (r.speed != null && r.speed > 0 && i > seg.startIdx) {
					const dt = r.elapsedSeconds - records[i - 1].elapsedSeconds;
					distance += r.speed * dt;
				}
			}

			const avgGradient =
				gradientCount > 0 ? gradientSum / gradientCount : null;
			const avgPower =
				powerCount > 0 ? Math.round(powerSum / powerCount) : null;
			const avgHeartRate = hrCount > 0 ? Math.round(hrSum / hrCount) : null;
			const distanceM = distance > 0 ? distance : null;

			const elevationGain =
				distanceM != null && avgGradient != null
					? Math.round(distanceM * (avgGradient / 100) * 10) / 10
					: null;

			results.push({
				type: seg.type,
				startSeconds: startRecord.elapsedSeconds,
				endSeconds: endRecord.elapsedSeconds,
				duration,
				distance: distanceM != null ? Math.round(distanceM) : null,
				elevationGain,
				avgGradient:
					avgGradient != null ? Math.round(avgGradient * 10) / 10 : null,
				avgPower,
				avgHeartRate,
			});
		}

		const fmt = (s: number) => {
			const m = Math.floor(s / 60);
			const sec = s % 60;
			return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
		};

		const lines: string[] = [];
		lines.push(
			`Segment analysis for activity ${data.id} (${data.date}) — found ${results.length} segment(s)`,
		);

		for (const seg of results) {
			const parts: string[] = [];
			parts.push(seg.type);
			parts.push(`${fmt(seg.duration)}`);
			if (seg.avgGradient != null)
				parts.push(`${seg.avgGradient}% avg gradient`);
			if (seg.elevationGain != null)
				parts.push(
					`${seg.elevationGain > 0 ? "+" : ""}${seg.elevationGain}m elevation`,
				);
			if (seg.avgPower != null) parts.push(`${seg.avgPower}W avg`);
			if (seg.avgHeartRate != null) parts.push(`${seg.avgHeartRate}bpm avg`);
			lines.push(`  - ${parts.join(", ")}`);
		}

		return {
			id: "",
			name: "segment_finder",
			content: lines.join("\n"),
			display: {
				activityId: data.id,
				date: data.date,
				segments: results,
			},
		};
	} finally {
		end();
	}
};

function getType(
	gradient: number,
	minGradient: number,
	maxGradient: number,
): "climb" | "descent" | "flat" | null {
	if (gradient >= minGradient) return "climb";
	if (gradient <= maxGradient) return "descent";
	if (
		Math.abs(gradient) < Math.min(Math.abs(minGradient), Math.abs(maxGradient))
	)
		return "flat";
	return null;
}
