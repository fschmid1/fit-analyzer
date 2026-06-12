import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface TrainingPhase {
	name: string;
	description: string;
}

function phaseFor(weeksRemaining: number): TrainingPhase {
	if (weeksRemaining >= 12) {
		return {
			name: "Base",
			description:
				"Build aerobic capacity with mostly Zone 2 volume. Add 1-2 short threshold or VO2max sessions per week.",
		};
	}
	if (weeksRemaining >= 8) {
		return {
			name: "Build",
			description:
				"Increase intensity: introduce sweet-spot and threshold work. Keep long Z2 rides for endurance.",
		};
	}
	if (weeksRemaining >= 4) {
		return {
			name: "Peak",
			description:
				"Race-specific intensity at goal pace. Reduce overall volume; sharpen with race-pace intervals.",
		};
	}
	if (weeksRemaining >= 1) {
		return {
			name: "Taper",
			description:
				"Cut volume ~40-60%. Keep short intensity touches to stay sharp. Prioritise sleep and nutrition.",
		};
	}
	if (weeksRemaining >= 0) {
		return {
			name: "Race week",
			description:
				"Minimal volume, mostly easy spinning. Final dress-rehab session 2-3 days out. Stay calm and fuelled.",
		};
	}
	return {
		name: "Race complete",
		description:
			"The event date has passed. Plan recovery (1-2 weeks easy) and reassess the next goal.",
	};
}

export const eventCountdownDefinition: ToolDefinition = {
	name: "event_countdown",
	description:
		"Calculate weeks until a target event and suggest the appropriate training phase (Base, Build, Peak, Taper, Race Week).",
	parameters: {
		type: "object",
		properties: {
			eventDate: {
				type: "string",
				description: "Event date in YYYY-MM-DD format",
			},
			eventName: {
				type: "string",
				description: "Optional event name for context",
			},
		},
		required: ["eventDate"],
	},
};

export const eventCountdownHandler: ToolHandler = async (args) => {
	const eventDate =
		typeof args.eventDate === "string" ? args.eventDate.trim() : "";
	const eventName =
		typeof args.eventName === "string" ? args.eventName.trim() : "";

	if (!DATE_RE.test(eventDate)) {
		return {
			id: "",
			name: "event_countdown",
			content: "",
			display: null,
			error: "`eventDate` must be in YYYY-MM-DD format.",
		};
	}

	const target = new Date(`${eventDate}T00:00:00`);
	if (Number.isNaN(target.getTime())) {
		return {
			id: "",
			name: "event_countdown",
			content: "",
			display: null,
			error: "Invalid date.",
		};
	}

	const now = new Date();
	const startOfToday = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const targetUtc = new Date(
		Date.UTC(
			target.getUTCFullYear(),
			target.getUTCMonth(),
			target.getUTCDate(),
		),
	);
	const msPerWeek = 7 * 24 * 60 * 60 * 1000;
	const diffMs = targetUtc.getTime() - startOfToday.getTime();
	const weeksRemaining = Math.round((diffMs / msPerWeek) * 10) / 10;
	const daysRemaining = Math.round(diffMs / (24 * 60 * 60 * 1000));

	const phase = phaseFor(weeksRemaining);
	const name = eventName || "Target event";

	const content = [
		`${name} on ${eventDate}:`,
		`- ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining (${weeksRemaining} weeks)`,
		`- Suggested phase: ${phase.name}`,
		`- Guidance: ${phase.description}`,
	].join("\n");

	return {
		id: "",
		name: "event_countdown",
		content,
		display: {
			eventName: name,
			eventDate,
			daysRemaining,
			weeksRemaining,
			phase: phase.name,
			phaseDescription: phase.description,
		},
	};
};
