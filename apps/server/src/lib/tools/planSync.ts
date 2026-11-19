import type {
	CalendarSyncResult,
	PlanRemovalResult,
	PlannedWorkout,
	PlanSyncResult,
	PlanTargetId,
} from "@fit-analyzer/shared";
import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import {
	DEFAULT_PLANNED_SPORT,
	STRUCTURED_PLANNED_SPORTS,
	SUPPORTED_PLANNED_SPORTS,
	isPlannedSport,
	normalizeWorkoutSteps,
	planTargetLabel,
	supportsWorkoutSteps,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import {
	removePlanAcrossTargets,
	syncPlanAcrossTargets,
} from "../planTargets.js";

/**
 * Coach tools for the training plan. The coach pushes whole plans via
 * sync_training_plan (create/update/delete by Sync key) and clears ranges via
 * remove_planned_workouts. One plan is fanned out to every connected Plan
 * target (ADR-0005): IntervalsIcu is primary when connected, Google Calendar is
 * a projection. The targets are the plan store — nothing is persisted besides
 * the events and the write marks.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STEPS_PARAMETER: ToolDefinition["parameters"]["properties"][string] = {
	type: "array",
	description:
		"Optional structured session: steps in order. A step is {kind, durationMinutes, target, note}; a repeat block is {repeat, steps} with one nesting level. kind: warmup | interval | recovery | cooldown | free. target: {metric: power|hr|pace, pct: 1-300, range?: {low, high}}, percentages of the athlete's threshold — never absolute watts.",
	items: {
		type: "object",
		description:
			"One step, or one repeat block with a `repeat` count and nested `steps`.",
		properties: {
			kind: {
				type: "string",
				description: "Step kind (default interval)",
				enum: ["warmup", "interval", "recovery", "cooldown", "free"],
			},
			durationMinutes: {
				type: "number",
				description:
					"Step length in minutes (a repeat block does not need one)",
			},
			target: {
				type: "object",
				description: "Percentage target for this step",
				properties: {
					metric: {
						type: "string",
						description: "The athlete's fitness the percentage refers to",
						enum: ["power", "hr", "pace"],
					},
					pct: {
						type: "number",
						description:
							"Target percentage of threshold (%FTP, %LTHR, %pace); the midpoint when range is given",
					},
					range: {
						type: "object",
						description: "Optional tolerance band, e.g. 95–105%",
						properties: {
							low: { type: "number", description: "Low end of the band" },
							high: { type: "number", description: "High end of the band" },
						},
					},
				},
			},
			note: {
				type: "string",
				description: "Optional short instruction shown with the step",
			},
			repeat: {
				type: "number",
				description: "Repeat count (repeat blocks only)",
			},
			steps: {
				type: "array",
				description: "Nested steps of a repeat block (repeat blocks only)",
				items: { type: "object", description: "One step inside the repeat" },
			},
		},
	},
};

function toolError(name: string, message: string): ToolResult {
	return { id: "", name, content: "", display: null, error: message };
}

/**
 * Parse the loosely-typed `workouts` argument the model sends. Returns rows
 * or an error string; never throws.
 */
function parseWorkouts(
	raw: unknown,
): { workouts: PlannedWorkout[] } | { error: string } {
	if (!Array.isArray(raw)) return { error: "workouts must be an array" };
	const workouts: PlannedWorkout[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i] as Record<string, unknown>;
		const date = typeof item.date === "string" ? item.date.trim() : "";
		const focus = typeof item.focus === "string" ? item.focus.trim() : "";
		if (!date || !focus) {
			return { error: `workouts[${i}]: date and focus are required` };
		}
		const durationMinutes =
			typeof item.durationMinutes === "number" && item.durationMinutes > 0
				? Math.round(item.durationMinutes)
				: null;
		if (durationMinutes == null) {
			return {
				error: `workouts[${i}] "${focus}": durationMinutes must be a positive number`,
			};
		}
		const startTime =
			typeof item.startTime === "string" && item.startTime.trim() !== ""
				? item.startTime.trim()
				: null;
		const description =
			typeof item.description === "string" && item.description.trim() !== ""
				? item.description.trim()
				: null;
		const sportRaw = typeof item.sport === "string" ? item.sport.trim() : "";
		const sport = sportRaw === "" ? DEFAULT_PLANNED_SPORT : sportRaw;
		if (!isPlannedSport(sport)) {
			return {
				error: `workouts[${i}] "${focus}": sport must be one of ${SUPPORTED_PLANNED_SPORTS.join(", ")}`,
			};
		}
		const steps = normalizeWorkoutSteps(item.steps ?? null);
		if ("error" in steps) {
			return { error: `workouts[${i}] "${focus}": ${steps.error}` };
		}
		if (steps.steps.length > 0 && !supportsWorkoutSteps(sport)) {
			return {
				error: `workouts[${i}] "${focus}": ${sport} workouts take no structured steps; put the exercises, sets and reps in description (structured steps are for ${STRUCTURED_PLANNED_SPORTS.join(", ")})`,
			};
		}
		workouts.push({
			date,
			startTime,
			durationMinutes,
			focus,
			description,
			sport,
			steps: steps.steps,
		});
	}
	return { workouts };
}

function summarize(rows: { date: string; startTime: string; focus: string }[]) {
	return rows.map((r) => `${r.date} ${r.startTime} ${r.focus}`).join("; ");
}

// ─── sync_training_plan ───────────────────────────────────────────────────────

export const syncTrainingPlanDefinition: ToolDefinition = {
	name: "sync_training_plan",
	description:
		"Write the athlete's whole forward training plan to every connected plan target (intervals.icu and/or the Training calendar). Sends a whole plan: workouts already in the plan are updated in place, planned entries missing from your list are removed, and a workout that has started is never touched. Edits the athlete made on the primary target are preserved; on a projection they are overwritten and reported. Always send the complete plan, not just the changes.",
	parameters: {
		type: "object",
		properties: {
			workouts: {
				type: "array",
				description:
					"The complete planned workload going forward. Use date-based entries; the plan target carries the authoritative schedule.",
				items: {
					type: "object",
					description:
						"One planned workout. durationMinutes is required; startTime defaults to 17:00 in the athlete's timezone when omitted.",
					properties: {
						date: {
							type: "string",
							description: "Workout date as YYYY-MM-DD",
						},
						startTime: {
							type: "string",
							description:
								"Start time as HH:MM in the athlete's timezone (24h). Infer from conversation/activity patterns; omit for the afternoon default.",
						},
						durationMinutes: {
							type: "number",
							description: "Session length in minutes",
						},
						focus: {
							type: "string",
							description: "Session title, e.g. 'Threshold intervals 3x10min'",
						},
						description: {
							type: "string",
							description:
								"Optional session notes (purpose, nutrition, execution cues)",
						},
						sport: {
							type: "string",
							description: "Sport the workout prescribes",
							enum: [...SUPPORTED_PLANNED_SPORTS],
						},
						steps: STEPS_PARAMETER,
					},
				},
			},
		},
		required: ["workouts"],
	},
};

export const syncTrainingPlanHandler: ToolHandler = async (args, context) => {
	const parsed = parseWorkouts(args.workouts);
	if ("error" in parsed) {
		return toolError("sync_training_plan", parsed.error);
	}
	if (parsed.workouts.length === 0) {
		return toolError("sync_training_plan", "workouts must not be empty");
	}

	try {
		const display = await syncPlanAcrossTargets(
			context.userId,
			parsed.workouts,
		);
		return {
			id: "",
			name: "sync_training_plan",
			content: buildSyncContent(display),
			display,
		};
	} catch (err) {
		return toolError("sync_training_plan", (err as Error).message);
	}
};

function buildSyncContent(result: PlanSyncResult): string {
	const lines: string[] = [];
	for (const target of result.targets) {
		lines.push(`**${planTargetLabel(target.target)}**`);
		lines.push(...syncTargetLines(target));
	}
	if (!lines.length) lines.push("No plan target is connected");
	return lines.join("\n");
}

function syncTargetLines(
	result: CalendarSyncResult & { target: PlanTargetId },
) {
	const lines: string[] = [];
	if (result.created.length)
		lines.push(`Created ${result.created.length} planned workout(s)`);
	if (result.updated.length)
		lines.push(`Updated ${result.updated.length} existing workout(s)`);
	if (result.deleted)
		lines.push(`Removed ${result.deleted} workout(s) no longer in the plan`);
	if (result.skipped.length || result.skippedEdits)
		lines.push(
			`Left ${result.skipped.length + result.skippedEdits} workout(s) untouched because the athlete edited them`,
		);
	if (result.overwritten?.length)
		lines.push(
			`Overwrote ${result.overwritten.length} athlete edit(s) with the plan: ${summarize(result.overwritten)}`,
		);
	if (result.notScheduled?.length) {
		lines.push(
			`Not scheduled (already started): ${summarize(result.notScheduled)}`,
		);
	}
	if (result.errors.length)
		lines.push(`Problems: ${result.errors.join(" | ")}`);
	if (lines.length === 0) lines.push("Already matches this plan");
	return lines;
}

// ─── remove_planned_workouts ──────────────────────────────────────────────────

export const removePlannedWorkoutsDefinition: ToolDefinition = {
	name: "remove_planned_workouts",
	description:
		"Remove planned workouts you previously added from every connected plan target (e.g. after a plan change or injury break). Prefer sync_training_plan with a revised plan when the athlete still trains — removal is for clearing entries entirely. Started workouts and edits the athlete made on the primary target are never removed.",
	parameters: {
		type: "object",
		properties: {
			fromDate: {
				type: "string",
				description: "Only remove workouts on or after this date (YYYY-MM-DD)",
			},
			toDate: {
				type: "string",
				description: "Only remove workouts on or before this date (YYYY-MM-DD)",
			},
			focus: {
				type: "string",
				description:
					"Only remove workouts whose title contains this text, e.g. 'Threshold'",
			},
		},
		required: [],
	},
};

export const removePlannedWorkoutsHandler: ToolHandler = async (
	args,
	context,
) => {
	const str = (v: unknown): string | null =>
		typeof v === "string" && v.trim() !== "" ? v.trim() : null;

	const fromDate = str(args.fromDate);
	const toDate = str(args.toDate);
	const focus = str(args.focus);
	for (const [label, value] of [
		["fromDate", fromDate],
		["toDate", toDate],
	] as const) {
		if (value && !DATE_RE.test(value)) {
			return toolError(
				"remove_planned_workouts",
				`${label} must be YYYY-MM-DD`,
			);
		}
	}

	try {
		const { plan, errors } = await removePlanAcrossTargets(context.userId, {
			fromDate,
			toDate,
			focus,
		});
		return {
			id: "",
			name: "remove_planned_workouts",
			content: buildRemovalContent(plan, errors),
			display: plan,
		};
	} catch (err) {
		return toolError("remove_planned_workouts", (err as Error).message);
	}
};

function buildRemovalContent(result: PlanRemovalResult, errors: string[]) {
	const lines: string[] = [];
	for (const target of result.targets) {
		lines.push(`**${planTargetLabel(target.target)}**`);
		if (target.removed.length) {
			lines.push(
				`Removed ${target.removed.length} planned workout(s): ${summarize(target.removed)}`,
			);
		} else {
			lines.push("No matching planned workouts found");
		}
		if (target.skipped)
			lines.push(
				`${target.skipped} workout(s) skipped because the athlete edited them`,
			);
		if (target.overwritten.length)
			lines.push(
				`Overwrote ${target.overwritten.length} athlete edit(s) with the plan: ${summarize(target.overwritten)}`,
			);
	}
	if (errors.length) lines.push(`Problems: ${errors.join(" | ")}`);
	return lines.join("\n");
}
