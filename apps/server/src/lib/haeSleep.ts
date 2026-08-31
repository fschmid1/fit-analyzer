import type { SleepStages } from "@fit-analyzer/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

/** HAE `sleep_analysis` data entry. All numeric durations are in hours. */
export interface HaeSleepEntry {
	date: string;
	qty?: number;
	units?: string;
	totalSleep?: number;
	asleep?: number;
	core?: number;
	deep?: number;
	rem?: number;
	sleepStart?: string;
	sleepEnd?: string;
	inBed?: number;
	inBedStart?: string;
	inBedEnd?: string;
}

/** One HealthKit sleep session (Apple Watch may split a night into several). */
export interface HaeSleepSession {
	durationMinutes: number;
	inBedMinutes: number | null;
	stages: SleepStages | null;
	sleepStart: string | null;
	sleepEnd: string | null;
}

/** Combined night totals, as stored in the daily snapshot. */
export interface HaeSleepData {
	durationMinutes: number;
	efficiencyPercent: number | null;
	stages: SleepStages | null;
	sleepStart: string | null;
	sleepEnd: string | null;
	/** Individual sessions the night was built from (used for merging). */
	sessions?: HaeSleepSession[];
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/** Extract the calendar date part of an HAE date string ("2024-02-06 ..."). */
export function toDateString(dateStr: string): string {
	return dateStr.split(" ")[0].slice(0, 10);
}

/**
 * Parse a single `sleep_analysis` entry into a session record.
 * Returns null for entries without a positive sleep duration.
 */
export function parseSleepEntry(entry: HaeSleepEntry): HaeSleepSession | null {
	// HAE exports the total sleep value under the generic `qty` field
	// when no dedicated `totalSleep`/`asleep` keys are present.
	const totalHours = entry.totalSleep ?? entry.asleep ?? entry.qty ?? null;
	if (totalHours == null || totalHours <= 0) return null;

	let stages: SleepStages | null = null;
	if (entry.core != null || entry.deep != null || entry.rem != null) {
		const totalStageHours =
			(entry.core ?? 0) + (entry.deep ?? 0) + (entry.rem ?? 0);
		const awakeHours = Math.max(0, totalHours - totalStageHours);
		stages = {
			awakeMinutes: Math.round(awakeHours * 60),
			lightMinutes: Math.round((entry.core ?? 0) * 60),
			deepMinutes: Math.round((entry.deep ?? 0) * 60),
			remMinutes: Math.round((entry.rem ?? 0) * 60),
		};
	}

	return {
		durationMinutes: Math.round(totalHours * 60),
		inBedMinutes:
			entry.inBed != null && entry.inBed > 0 ? entry.inBed * 60 : null,
		stages,
		sleepStart: entry.sleepStart ?? null,
		sleepEnd: entry.sleepEnd ?? null,
	};
}

/**
 * A night is attributed to the calendar date on which sleep ended (wake
 * date). Apple Watch splits one night into multiple sessions; attributing by
 * sleep end keeps all sessions of a night on the same date even when the
 * session started the evening before.
 */
export function sleepNightDate(entry: HaeSleepEntry): string {
	return toDateString(entry.sleepEnd ?? entry.date);
}

// ─── Session Deduplication & Combining ───────────────────────────────────────

function sessionKey(s: HaeSleepSession): string {
	if (s.sleepStart != null || s.sleepEnd != null) {
		return `window:${s.sleepStart ?? ""}..${s.sleepEnd ?? ""}`;
	}
	const stages = s.stages
		? `${s.stages.awakeMinutes}/${s.stages.lightMinutes}/${s.stages.deepMinutes}/${s.stages.remMinutes}`
		: "none";
	return `value:${s.durationMinutes}/${stages}`;
}

/**
 * Remove duplicate sessions. Sessions sharing the same sleep window are the
 * same HealthKit sample re-delivered (later wins, e.g. corrected stage data);
 * sessions without timestamps are deduped by duration + stage signature.
 *
 * Nested windows are also dropped: HAE's background syncs re-deliver a
 * cumulative window with the start creeping later while the wake-time end
 * stays fixed (00:14→09:08 = 493m, 03:09→09:08 = 343m, 05:05→09:08 = 237m).
 * Each is a truncated re-delivery of the same night, so any window fully
 * contained in another is subsumed by it; only distinct segments sum.
 */
export function dedupeSleepSessions(
	sessions: HaeSleepSession[],
): HaeSleepSession[] {
	const byKey = new Map<string, HaeSleepSession>();
	for (const s of sessions) byKey.set(sessionKey(s), s);
	const deduped = Array.from(byKey.values());
	const windowed = deduped.filter(
		(s) => s.sleepStart != null && s.sleepEnd != null,
	);
	const timestampless = deduped.filter(
		(s) => s.sleepStart == null || s.sleepEnd == null,
	);

	const kept: HaeSleepSession[] = [];
	const bounds = windowed.map((s) => ({
		start: Date.parse(s.sleepStart as string),
		end: Date.parse(s.sleepEnd as string),
	}));
	for (let i = 0; i < windowed.length; i++) {
		const { start, end } = bounds[i];
		if (start > end) {
			// Unparseable window; keep — don't discard data on a parsing hunch.
			kept.push(windowed[i]);
			continue;
		}
		const nested = bounds.some(
			(o, j) =>
				i !== j &&
				o.start <= start &&
				end <= o.end &&
				// A same-second equal window is dedupe's job, not nesting's; both
				// survive here so "later wins" still applies to them.
				!(o.start === start && end === o.end),
		);
		if (!nested) kept.push(windowed[i]);
	}

	return [...kept, ...timestampless];
}

/**
 * Combine one night's sessions into a single sleep record: durations and
 * stages are summed, the sleep window spans the earliest start to the latest
 * end, and efficiency is derived from total in-bed time.
 */
export function combineSleepSessions(
	sessions: HaeSleepSession[],
): HaeSleepData | null {
	if (sessions.length === 0) return null;
	const deduped = dedupeSleepSessions(sessions);

	let durationMinutes = 0;
	let inBedMinutes: number | null = null;
	let stages: SleepStages | null = null;
	let earliestStart: { time: number; value: string } | null = null;
	let latestEnd: { time: number; value: string } | null = null;

	for (const s of deduped) {
		durationMinutes += s.durationMinutes;
		if (s.inBedMinutes != null) {
			inBedMinutes = (inBedMinutes ?? 0) + s.inBedMinutes;
		}
		if (s.stages) {
			stages ??= {
				awakeMinutes: 0,
				lightMinutes: 0,
				deepMinutes: 0,
				remMinutes: 0,
			};
			stages.awakeMinutes += s.stages.awakeMinutes;
			stages.lightMinutes += s.stages.lightMinutes;
			stages.deepMinutes += s.stages.deepMinutes;
			stages.remMinutes += s.stages.remMinutes;
		}
		if (s.sleepStart) {
			const t = Date.parse(s.sleepStart);
			if (
				!Number.isNaN(t) &&
				(earliestStart == null || t < earliestStart.time)
			) {
				earliestStart = { time: t, value: s.sleepStart };
			}
		}
		if (s.sleepEnd) {
			const t = Date.parse(s.sleepEnd);
			if (!Number.isNaN(t) && (latestEnd == null || t > latestEnd.time)) {
				latestEnd = { time: t, value: s.sleepEnd };
			}
		}
	}

	const efficiencyPercent =
		inBedMinutes != null && inBedMinutes > 0
			? Math.min(100, Math.round((durationMinutes / inBedMinutes) * 100))
			: null;

	return {
		durationMinutes,
		efficiencyPercent,
		stages,
		sleepStart: earliestStart?.value ?? null,
		sleepEnd: latestEnd?.value ?? null,
		sessions: deduped,
	};
}

/**
 * Merge the stored night with an incoming one. When both carry session
 * breakdowns, sessions are unioned (re-delivered sessions dedupe), so nights
 * arriving across multiple payloads accumulate instead of overwriting.
 * An incoming payload without a session breakdown (aggregated total or legacy
 * stored shape) replaces the stored value as the authoritative daily total.
 */
export function mergeSleepData(
	existing: HaeSleepData | null,
	incoming: HaeSleepData | null,
): HaeSleepData | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	if (incoming.sessions) {
		return combineSleepSessions([
			...(existing.sessions ?? []),
			...incoming.sessions,
		]);
	}
	return incoming;
}
