import { debug } from "../debug.js";
import { computeAllTimeEstimates } from "../athleteStats.js";
import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

type Focus =
	| "endurance"
	| "tempo"
	| "sweet_spot"
	| "threshold"
	| "vo2max"
	| "anaerobic"
	| "sprint"
	| "recovery";

const FOCUS_LIST: Focus[] = [
	"endurance",
	"tempo",
	"sweet_spot",
	"threshold",
	"vo2max",
	"anaerobic",
	"sprint",
	"recovery",
];

interface IntervalSpec {
	description: string;
	duration: number;
	targetPower: number;
	targetPowerPercent: number;
	restDuration: number;
}

interface PhaseSpec {
	duration: number;
	description: string;
}

const WARMUP_DURATION = 600;
const COOLDOWN_DURATION = 300;

function resolvePhase(eventDate: string | null): string {
	if (!eventDate) return "Build";
	const target = new Date(`${eventDate}T00:00:00`);
	if (Number.isNaN(target.getTime())) return "Build";
	const now = new Date();
	const diffDays = Math.round((target.getTime() - now.getTime()) / 86400000);
	if (diffDays > 84) return "Base";
	if (diffDays > 56) return "Build";
	if (diffDays > 28) return "Peak";
	if (diffDays > 7) return "Taper";
	return "Race week";
}

function buildWorkout(
	focus: Focus,
	ftp: number,
	totalDurationSec: number,
): {
	intervals: IntervalSpec[];
	warmup: PhaseSpec | null;
	cooldown: PhaseSpec | null;
} {
	const mainDuration = totalDurationSec - WARMUP_DURATION - COOLDOWN_DURATION;
	const warmup: PhaseSpec = {
		duration: WARMUP_DURATION,
		description: "Easy spinning, gradual ramp to work intensity",
	};
	const cooldown: PhaseSpec = {
		duration: COOLDOWN_DURATION,
		description: "Easy spinning, gradually decrease effort",
	};

	if (focus === "recovery") {
		return {
			intervals: [
				{
					description: "Zone 1 recovery",
					duration: totalDurationSec - WARMUP_DURATION - COOLDOWN_DURATION,
					targetPower: Math.round(ftp * 0.5),
					targetPowerPercent: 50,
					restDuration: 0,
				},
			],
			warmup,
			cooldown,
		};
	}

	const p = (pct: number) => Math.round((ftp * pct) / 100);
	let reps: number;
	let onDuration: number;
	let offDuration: number;
	let onPercent: number;
	let offPercent: number;
	let desc: string;

	switch (focus) {
		case "endurance":
			reps = 3;
			onDuration = 900;
			offDuration = 300;
			onPercent = 65;
			offPercent = 50;
			desc = "Zone 2 endurance";
			break;
		case "tempo":
			reps = 2;
			onDuration = 1800;
			offDuration = 300;
			onPercent = 81;
			offPercent = 55;
			desc = "Zone 3 tempo";
			break;
		case "sweet_spot":
			reps = 3;
			onDuration = 720;
			offDuration = 300;
			onPercent = 91;
			offPercent = 55;
			desc = "Sweet spot";
			break;
		case "threshold":
			reps = 2;
			onDuration = 1200;
			offDuration = 600;
			onPercent = 100;
			offPercent = 55;
			desc = "Threshold";
			break;
		case "vo2max":
			reps = 5;
			onDuration = 240;
			offDuration = 240;
			onPercent = 115;
			offPercent = 50;
			desc = "VO2max";
			break;
		case "anaerobic":
			reps = 8;
			onDuration = 60;
			offDuration = 180;
			onPercent = 140;
			offPercent = 50;
			desc = "Anaerobic capacity";
			break;
		case "sprint":
			reps = 12;
			onDuration = 15;
			offDuration = 120;
			onPercent = 180;
			offPercent = 50;
			desc = "Sprint";
			break;
		default:
			reps = 3;
			onDuration = 900;
			offDuration = 300;
			onPercent = 65;
			offPercent = 50;
			desc = "Zone 2 endurance";
			break;
	}

	const availableMain =
		mainDuration > 0 ? mainDuration : reps * (onDuration + offDuration);
	const repDuration = onDuration + offDuration;
	const maxReps = Math.floor(availableMain / repDuration);
	const actualReps = Math.max(1, Math.min(reps, maxReps));

	const intervals: IntervalSpec[] = [];
	for (let i = 0; i < actualReps; i++) {
		intervals.push({
			description: `${desc} interval ${i + 1}/${actualReps}`,
			duration: onDuration,
			targetPower: p(onPercent),
			targetPowerPercent: onPercent,
			restDuration: i < actualReps - 1 ? offDuration : 0,
		});
	}

	return { intervals, warmup, cooldown };
}

export const workoutGeneratorDefinition: ToolDefinition = {
	name: "workout_generator",
	description:
		"Generate a structured cycling workout based on the athlete's current fitness, goals, and available time.",
	parameters: {
		type: "object",
		properties: {
			focus: {
				type: "string",
				enum: FOCUS_LIST,
				description: "Training focus",
			},
			durationMinutes: {
				type: "number",
				description: "Total workout duration in minutes (default 60)",
			},
			ftp: {
				type: "number",
				description: "FTP in watts (uses estimate if omitted)",
			},
			eventDate: {
				type: "string",
				description: "Target event date for phase-appropriate workout",
			},
		},
		required: ["focus"],
	},
};

export const workoutGeneratorHandler: ToolHandler = async (args, context) => {
	const userId = context.userId;
	const end = debug.time("tool", "workout_generator");
	try {
		const focusRaw = typeof args.focus === "string" ? args.focus : "";
		if (!FOCUS_LIST.includes(focusRaw as Focus)) {
			return {
				id: "",
				name: "workout_generator",
				content: "",
				display: null,
				error: `Invalid focus. Must be one of: ${FOCUS_LIST.join(", ")}`,
			};
		}
		const focus = focusRaw as Focus;

		const durationMinRaw =
			typeof args.durationMinutes === "number" ? args.durationMinutes : 60;
		const durationMin =
			Number.isFinite(durationMinRaw) && durationMinRaw >= 30
				? Math.min(300, Math.floor(durationMinRaw))
				: 60;

		let ftp: number | null =
			typeof args.ftp === "number" && args.ftp > 0 ? args.ftp : null;

		if (ftp == null) {
			try {
				ftp = computeAllTimeEstimates(userId, null).estimatedFtp;
			} catch {
				ftp = null;
			}
		}

		if (ftp == null) {
			return {
				id: "",
				name: "workout_generator",
				content: "",
				display: null,
				error:
					"Could not estimate FTP. Provide the ftp parameter or upload activities with power data.",
			};
		}

		const eventDateRaw =
			typeof args.eventDate === "string" ? args.eventDate.trim() : null;
		const phase = resolvePhase(eventDateRaw);

		const totalDurationSec = durationMin * 60;
		const { intervals, warmup, cooldown } = buildWorkout(
			focus,
			ftp,
			totalDurationSec,
		);

		const focusLabel = focus.replace(/_/g, " ");
		const totalIntervalTime = intervals.reduce(
			(sum, i) => sum + i.duration + i.restDuration,
			0,
		);
		const totalTime =
			(warmup?.duration ?? 0) + totalIntervalTime + (cooldown?.duration ?? 0);

		const lines = [
			`${focusLabel} workout (${Math.round(totalTime / 60)} min) · FTP: ${ftp}W`,
			`Training phase: ${phase}`,
			"",
		];
		if (warmup) {
			lines.push(
				`Warmup: ${Math.round(warmup.duration / 60)} min — ${warmup.description}`,
			);
		}
		for (const interval of intervals) {
			const onMin = Math.round(interval.duration / 60);
			const offMin = Math.round(interval.restDuration / 60);
			lines.push(
				`  ${interval.description}: ${onMin} min @ ${interval.targetPower}W (${interval.targetPowerPercent}% FTP)${interval.restDuration > 0 ? ` / ${offMin} min rest` : ""}`,
			);
		}
		if (cooldown) {
			lines.push(
				`Cooldown: ${Math.round(cooldown.duration / 60)} min — ${cooldown.description}`,
			);
		}

		return {
			id: "",
			name: "workout_generator",
			content: lines.join("\n"),
			display: {
				focus: focusLabel,
				totalDuration: totalTime,
				ftp,
				intervals,
				warmup,
				cooldown,
				phase,
			},
		};
	} finally {
		end();
	}
};
