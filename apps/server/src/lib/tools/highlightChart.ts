import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { resolveActivityId } from "./activityUtils.js";
import { debug } from "../debug.js";

export const highlightChartDefinition: ToolDefinition = {
	name: "highlight_chart",
	description:
		"Highlight a time range on the activity chart for the user to see. Use this when you want to draw attention to a specific section of the ride.",
	parameters: {
		type: "object",
		properties: {
			activityId: {
				type: "string",
				description:
					"Activity ID to highlight (defaults to the current thread's activity; required in general chat)",
			},
			startSeconds: {
				type: "number",
				description: "Start time in seconds from the beginning of the activity",
			},
			endSeconds: {
				type: "number",
				description: "End time in seconds from the beginning of the activity",
			},
			label: {
				type: "string",
				description:
					"Short label for the highlight (e.g. 'Threshold effort', 'VO2max interval')",
			},
		},
		required: ["startSeconds", "endSeconds"],
	},
};

export const highlightChartHandler: ToolHandler = async (args, context) => {
	const end = debug.time("tool", "highlight_chart");
	try {
		const activityId = resolveActivityId(args, context);
		if (!activityId) {
			return {
				id: "",
				name: "highlight_chart",
				content: "",
				display: null,
				error:
					"No activity specified. Use highlight_chart within a thread linked to an activity.",
			};
		}

		const startSeconds = Number(args.startSeconds);
		const endSeconds = Number(args.endSeconds);
		const label =
			typeof args.label === "string" ? args.label.trim() : undefined;

		if (
			!Number.isFinite(startSeconds) ||
			!Number.isFinite(endSeconds) ||
			startSeconds < 0 ||
			endSeconds < 0
		) {
			return {
				id: "",
				name: "highlight_chart",
				content: "",
				display: null,
				error:
					"startSeconds and endSeconds must be non-negative finite numbers.",
			};
		}

		if (startSeconds >= endSeconds) {
			return {
				id: "",
				name: "highlight_chart",
				content: "",
				display: null,
				error: "startSeconds must be less than endSeconds.",
			};
		}

		const content = label
			? `Highlighting ${startSeconds}s–${endSeconds}s (${label}) on the chart.`
			: `Highlighting ${startSeconds}s–${endSeconds}s on the chart.`;

		return {
			id: "",
			name: "highlight_chart",
			content,
			display: {
				activityId,
				startSeconds,
				endSeconds,
				label,
				color: "rgba(139, 92, 246, 0.35)",
			},
		};
	} finally {
		end();
	}
};
