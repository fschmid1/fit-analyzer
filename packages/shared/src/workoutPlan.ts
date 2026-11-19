/**
 * The structured workout model shared by the coach tools, both plan targets
 * and the plan week UI.
 *
 * A planned workout's steps are deliberately neutral: duration plus a
 * percentage target, with repeat blocks holding nested steps. Each Plan target
 * renders the model its own way — IntervalsIcu `workout_doc`, a readable text
 * block for the Google calendar — so no adapter owns the domain shape.
 *
 * Percentages only: the athlete's thresholds live with the athlete (and with
 * IntervalsIcu), so this app never resolves watts.
 */

/** The part of an athlete's fitness a target is a percentage of. */
export type WorkoutTargetMetric = "power" | "hr" | "pace";

/**
 * A target as a percentage of the athlete's threshold for the metric:
 * %FTP for power, %LTHR for heart rate, %threshold pace for pace.
 */
export interface WorkoutTarget {
	metric: WorkoutTargetMetric;
	/** The target percentage. With a range this is the midpoint. */
	pct: number;
	/** Optional tolerance band, both percentages. */
	range: { low: number; high: number } | null;
}

export type WorkoutStepKind =
	| "warmup"
	| "interval"
	| "recovery"
	| "cooldown"
	| "free";

/** One effort inside a planned workout. */
export interface WorkoutStep {
	kind: WorkoutStepKind;
	/** Step length in minutes. */
	durationMinutes: number;
	/** Absent for free riding / no target. */
	target: WorkoutTarget | null;
	/** Optional short instruction shown with the step. */
	note: string | null;
}

/** A repeated set, e.g. 4 × (8 min on, 4 min off). One nesting level. */
export interface WorkoutRepeat {
	repeat: number;
	steps: WorkoutStep[];
}

export type WorkoutStepItem = WorkoutStep | WorkoutRepeat;

/** The sport a planned workout prescribes. v1 syncs cycling only. */
export type PlannedSport = "Ride";

export const DEFAULT_PLANNED_SPORT: PlannedSport = "Ride";
export const SUPPORTED_PLANNED_SPORTS: readonly PlannedSport[] = ["Ride"];

/** Fallback start time when the coach gives none (afternoon). */
export const DEFAULT_START_TIME = "17:00";

const STEP_KINDS: readonly WorkoutStepKind[] = [
	"warmup",
	"interval",
	"recovery",
	"cooldown",
	"free",
];

const METRICS: readonly WorkoutTargetMetric[] = ["power", "hr", "pace"];

const MAX_STEPS = 40;
const MAX_REPEAT = 20;
const MAX_PCT = 300;

export function isWorkoutRepeat(item: WorkoutStepItem): item is WorkoutRepeat {
	return typeof (item as WorkoutRepeat).repeat === "number";
}

/** Total minutes across steps and repeats. */
export function totalWorkoutMinutes(items: WorkoutStepItem[]): number {
	let total = 0;
	for (const item of items) {
		if (isWorkoutRepeat(item)) {
			total +=
				item.repeat *
				item.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
		} else {
			total += item.durationMinutes;
		}
	}
	return Math.round(total);
}

/** Human label for a step target, e.g. "95–105% FTP". */
export function formatWorkoutTarget(
	target: WorkoutTarget | null,
): string | null {
	if (!target) return null;
	const metric =
		target.metric === "power"
			? "FTP"
			: target.metric === "hr"
				? "LTHR"
				: "pace";
	if (!target.range) return `${target.pct}% ${metric}`;
	return `${target.range.low}–${target.range.high}% ${metric}`;
}

function formatStep(step: WorkoutStep): string {
	const target = formatWorkoutTarget(step.target);
	const parts = [`${step.durationMinutes} min`];
	if (target) parts.push(`@ ${target}`);
	if (step.kind !== "interval") parts.push(`(${step.kind})`);
	if (step.note) parts.push(`— ${step.note}`);
	return parts.join(" ");
}

/**
 * Render steps as human-readable lines, one per step (repeats on one line).
 * The Google calendar event body and the plan week UI both use this, so the
 * two never disagree about how a workout reads.
 */
export function renderWorkoutSteps(items: WorkoutStepItem[]): string {
	return items
		.map((item) => {
			if (!isWorkoutRepeat(item)) return `- ${formatStep(item)}`;
			const inner = item.steps.map(formatStep).join(", ");
			return `- ${item.repeat} × (${inner})`;
		})
		.join("\n");
}

/**
 * Normalize the loosely typed `steps` argument a model sends. Returns a
 * cleaned tree or a single readable error — never throws, and never keeps a
 * malformed step.
 */
export function normalizeWorkoutSteps(
	raw: unknown,
): { steps: WorkoutStepItem[] } | { error: string } {
	if (raw == null) return { steps: [] };
	if (!Array.isArray(raw)) return { error: "steps must be an array" };
	if (raw.length > MAX_STEPS)
		return { error: "steps must have at most 40 items" };

	const steps: WorkoutStepItem[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i] as Record<string, unknown>;
		if (item == null || typeof item !== "object") {
			return { error: `steps[${i}] must be an object` };
		}
		if ("repeat" in item) {
			const repeat = Number(item.repeat);
			if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
				return { error: `steps[${i}].repeat must be an integer 1–20` };
			}
			const inner = normalizeWorkoutSteps(item.steps);
			if ("error" in inner) return { error: `steps[${i}].${inner.error}` };
			if (inner.steps.length === 0) {
				return { error: `steps[${i}] repeat block needs at least one step` };
			}
			if (inner.steps.some(isWorkoutRepeat)) {
				return { error: `steps[${i}] repeat blocks cannot nest` };
			}
			steps.push({
				repeat,
				steps: inner.steps as WorkoutStep[],
			});
			continue;
		}
		const step = normalizeStep(item, `steps[${i}]`);
		if ("error" in step) return step;
		steps.push(step.step);
	}
	return { steps };
}

function normalizeStep(
	item: Record<string, unknown>,
	path: string,
): { step: WorkoutStep } | { error: string } {
	const kind =
		typeof item.kind === "string" &&
		STEP_KINDS.includes(item.kind as WorkoutStepKind)
			? (item.kind as WorkoutStepKind)
			: "interval";
	const durationMinutes = Number(item.durationMinutes);
	if (
		!Number.isFinite(durationMinutes) ||
		durationMinutes <= 0 ||
		durationMinutes > 600
	) {
		return { error: `${path}.durationMinutes must be 1–600` };
	}
	let target: WorkoutTarget | null = null;
	if (item.target != null) {
		const parsed = normalizeTarget(item.target, `${path}.target`);
		if ("error" in parsed) return parsed;
		target = parsed.target;
	}
	const note =
		typeof item.note === "string" && item.note.trim() !== ""
			? item.note.trim()
			: null;
	return {
		step: { kind, durationMinutes: Math.round(durationMinutes), target, note },
	};
}

function normalizeTarget(
	raw: unknown,
	path: string,
): { target: WorkoutTarget } | { error: string } {
	if (raw == null || typeof raw !== "object") {
		return { error: `${path} must be an object` };
	}
	const item = raw as Record<string, unknown>;
	const metric =
		typeof item.metric === "string" &&
		METRICS.includes(item.metric as WorkoutTargetMetric)
			? (item.metric as WorkoutTargetMetric)
			: null;
	if (!metric) return { error: `${path}.metric must be power, hr or pace` };
	const pct = Number(item.pct);
	if (!Number.isFinite(pct) || pct <= 0 || pct > MAX_PCT) {
		return { error: `${path}.pct must be 1–300` };
	}
	let range: { low: number; high: number } | null = null;
	const rawRange = item.range as Record<string, unknown> | undefined;
	if (rawRange != null) {
		const low = Number(rawRange.low);
		const high = Number(rawRange.high);
		if (
			!Number.isFinite(low) ||
			!Number.isFinite(high) ||
			low <= 0 ||
			high <= 0 ||
			low > high
		) {
			return { error: `${path}.range must be {low, high} with 0 < low ≤ high` };
		}
		range = { low: Math.round(low), high: Math.round(high) };
	}
	return { target: { metric, pct: Math.round(pct), range } };
}

/**
 * User-facing name of a plan target. "intervals.icu" is always lowercase, like
 * the product; "Training calendar" is the app's name for the Google calendar.
 * One definition so the plan page, the tool card and the coach text agree.
 */
export function planTargetLabel(target: "google" | "intervalsIcu"): string {
	return target === "intervalsIcu" ? "intervals.icu" : "Training calendar";
}
