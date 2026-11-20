import type { CrossTrainingSession } from "@fit-analyzer/shared";
import { crossTrainingSessionRepo } from "./crossTrainingSessionRepo.js";
import { getTrainingTimezone } from "./trainingTimezone.js";
import { wallClockMinute } from "./wallClock.js";

/**
 * The coach-facing view of cross-training sessions (ADR-0006): the most recent
 * summaries plus 7- and 28-day duration/load aggregates. Shared by the
 * health_data tool and the (legacy) prompt builder so both describe sessions
 * the same way.
 *
 * Sessions are load and scheduling context, never ride analysis — the section
 * text says so explicitly.
 */

const SESSION_LIST_LIMIT = 12;

/** "1h 05m" / "45m" — compact enough for a prompt line. */
function formatSessionDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.round((seconds % 3600) / 60);
	return hours > 0
		? `${hours}h ${String(minutes).padStart(2, "0")}m`
		: `${minutes}m`;
}

/** ISO date `days - 1` before today — an inclusive window start. */
function sessionWindowStart(today: string, days: number): string {
	const start = new Date(`${today}T00:00:00Z`);
	start.setUTCDate(start.getUTCDate() - (days - 1));
	return start.toISOString().slice(0, 10);
}

function aggregateSessions(
	sessions: CrossTrainingSession[],
	today: string,
	days: number,
): string | null {
	const window = sessions.filter(
		(s) => s.date >= sessionWindowStart(today, days),
	);
	if (window.length === 0) return null;
	const seconds = window.reduce((sum, s) => sum + s.durationSeconds, 0);
	const load = window.reduce((sum, s) => sum + (s.trainingLoad ?? 0), 0);
	const loadText = load > 0 ? `, load ${Math.round(load)}` : "";
	return `${window.length} session(s), ${formatSessionDuration(seconds)}${loadText}`;
}

/** Collapse whitespace and cap free text so one session stays one prompt line. */
function oneLine(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Prompt section for the sessions, or "" when there are none. */
export function formatCrossTrainingSessions(
	sessions: CrossTrainingSession[],
	today: string,
): string {
	if (sessions.length === 0) return "";

	const lines = sessions.slice(0, SESSION_LIST_LIMIT).map((s) => {
		const details: string[] = [formatSessionDuration(s.durationSeconds)];
		if (s.distanceKm != null) details.push(`${s.distanceKm} km`);
		if (s.avgHeartRate != null) details.push(`avg HR ${s.avgHeartRate}`);
		if (s.maxHeartRate != null) details.push(`max HR ${s.maxHeartRate}`);
		if (s.trainingLoad != null) details.push(`load ${s.trainingLoad}`);
		if (s.kgLifted != null)
			details.push(
				`${Math.round(s.kgLifted).toLocaleString("en-US")} kg lifted`,
			);
		const start = s.startTime ? ` ${s.startTime}` : "";
		const quotedName = s.name && s.name !== s.sport ? ` "${s.name}"` : "";
		const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
		const notes = s.description ? ` — ${oneLine(s.description, 160)}` : "";
		return `- ${s.date}${start} ${s.sport}${quotedName}${tags}: ${details.join(", ")}${notes}`;
	});

	const aggregates = [
		aggregateSessions(sessions, today, 7),
		aggregateSessions(sessions, today, 28),
	].filter((text): text is string => text != null);

	const aggregateLines =
		aggregates.length > 0
			? [
					`Last 7 days: ${aggregates[0]}`,
					...(aggregates[1] ? [`Last 28 days: ${aggregates[1]}`] : []),
				]
			: [];

	return [
		"",
		"## Cross-Training Sessions",
		"Completed non-ride sessions imported from intervals.icu as summaries (no per-second data). Notes and tags are the athlete's own intervals.icu text. Use them to judge total load, recovery and scheduling; never analyse one like a ride.",
		...lines,
		...aggregateLines,
		"",
	].join("\n");
}

/** Load recent sessions and render the prompt section; "" when there are none. */
export function readCrossTrainingPrompt(
	userId: string,
	sinceDate: string,
): string {
	const sessions = crossTrainingSessionRepo.recent(userId, sinceDate, 200);
	if (sessions.length === 0) return "";
	const timezone = getTrainingTimezone(userId) ?? "UTC";
	const today = wallClockMinute(new Date(), timezone).slice(0, 10);
	return formatCrossTrainingSessions(sessions, today);
}
