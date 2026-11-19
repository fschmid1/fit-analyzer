import { getConnectedPlanTargets, primaryPlanTarget } from "./planTargets.js";
import { planTargetLabel } from "@fit-analyzer/shared";
import {
	formatPlanForPrompt,
	readPlanContext,
	readTrainingPlan,
} from "./trainingPlan.js";
import { getTrainingTimezone } from "./trainingTimezone.js";

/**
 * The single plan guidance block shared by interactive trainer chat and the
 * unattended weekly Plan refresh, so the two entry points cannot drift
 * (ADR-0002, extended by ADR-0005).
 *
 * One plan, many targets: the coach writes one plan and the tools fan it out.
 * IntervalsIcu is primary when connected, so it is what the coach reads back;
 * Google Calendar is a projection that gets overwritten and reports back the
 * athlete's edits.
 */

/** Whether the athlete has any plan target connected at all. */
export function hasPlanTarget(userId: string): boolean {
	return primaryPlanTarget(getConnectedPlanTargets(userId)) !== null;
}

/** The plan guidance for a user, or "" when no plan target is connected. */
export async function buildPlanGuidance(userId: string): Promise<string> {
	const targets = getConnectedPlanTargets(userId);
	const primary = primaryPlanTarget(targets);
	if (!primary) return "";
	const timezone = getTrainingTimezone(userId);
	if (!timezone) return "";

	const connected = targets.filter((t) => t.connected);
	const targetText = connected
		.map((t) => `${planTargetLabel(t.target)}${t.primary ? " (primary)" : ""}`)
		.join(" and ");

	let planText = "(no planned workouts yet)";
	try {
		planText = formatPlanForPrompt(await readTrainingPlan(userId));
	} catch {
		// A plan read failure must not break prompt building; the coach still
		// gets the tool guidance and can read the plan via the tools.
	}
	const context = await readPlanContext(userId).catch(() => "");

	return [
		"",
		"## Training Plan",
		`Plan targets: ${targetText}. The plan lives on ${planTargetLabel(primary)}, which is primary; the athlete's day is in the ${timezone} timezone.`,
		primary === "intervalsIcu"
			? "intervals.icu is the plan of record: it is what the athlete actually executes, so what you read back below is authoritative. Google Calendar receives a projection that is overwritten on every sync; if the athlete edited it there, the sync says so."
			: "Google Calendar is the plan of record: what you read back below is authoritative.",
		context,
		"",
		"Use sync_training_plan to push the plan. Always send the COMPLETE forward plan, never just the changes: workouts already in the plan are updated in place, entries missing from your list are removed, and a workout that has started is never created, changed or removed. Workouts default to 17:00 when you omit a start time; infer better times from the athlete's activity history when it suggests one.",
		"Every workout carries a sport. v1 accepts only Ride; leave it out for rides.",
		"",
		"### Structured workouts",
		"Each workout may carry `steps`: the session structure, as a list of items in order. A step is `{ kind, durationMinutes, target, note }`; a repeat block is `{ repeat, steps }` with one nesting level. kind is warmup | interval | recovery | cooldown | free (default interval).",
		"target is `{ metric, pct, range }` where metric is power | hr | pace, pct is a percentage of the athlete's threshold (%FTP, %LTHR, %threshold pace), and range is an optional `{ low, high }` band with pct as the midpoint. Never use absolute watts: thresholds live with the athlete and the targets.",
		"Example: a 5 × (4 min at 105–115% FTP, 4 min at 50% FTP) session with warmup and cooldown:",
		'[{ "kind": "warmup", "durationMinutes": 12, "target": { "metric": "power", "pct": 55 } },',
		' { "repeat": 5, "steps": [{ "kind": "interval", "durationMinutes": 4, "target": { "metric": "power", "pct": 110, "range": { "low": 105, "high": 115 } } },',
		'                     { "kind": "recovery", "durationMinutes": 4, "target": { "metric": "power", "pct": 50 } }] },',
		' { "kind": "cooldown", "durationMinutes": 10, "target": { "metric": "power", "pct": 50 } }]',
		"That structure reaches intervals.icu as a native workout and Google Calendar as readable lines; the plan screen shows a summary. Omitting steps is fine for an easy spin or when the athlete wants prose only.",
		"",
		"Use remove_planned_workouts to clear entries entirely (e.g. a plan you are abandoning). Prefer sync_training_plan with a revised plan while the athlete still trains.",
		"The Plan week is Monday–Sunday in the athlete's timezone. Keep the upcoming Plan week fully populated — that is what the weekly refresh guarantees. Revise workouts only where recent activity, health, or the athlete's feedback warrants it; otherwise keep the existing plan.",
		"",
		"Current forward plan (authoritative — read back from the primary target):",
		planText,
		"",
	].join("\n");
}
