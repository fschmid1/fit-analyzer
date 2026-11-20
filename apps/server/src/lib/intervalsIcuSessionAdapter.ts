import type { IntervalsIcuActivity } from "./intervalsIcuClient.js";
import {
	isIntervalsIcuRide,
	isStravaSourced,
} from "./intervalsIcuImportAdapter.js";
import type { CrossTrainingSessionInput } from "./crossTrainingSessionRepo.js";

/**
 * Turn one intervals.icu activity that is not a ride into a cross-training
 * session summary.
 *
 * Sessions are summary-only on purpose: the app analyses rides from per-second
 * records and detects their intervals itself, but strength work, runs and swims
 * reach the coach as context (duration, heart rate, training load), not as a
 * chart. Strava-sourced activities are skipped for the same reason rides are:
 * intervals.icu serves only a stub, and Strava's terms forbid re-downloading
 * their data through a third party.
 */

const SPORT_LABELS: Record<string, string> = {
	WeightTraining: "Strength training",
	Crossfit: "CrossFit",
	Run: "Run",
	Swim: "Swim",
	Rowing: "Row",
	Yoga: "Yoga",
	Walk: "Walk",
	Hike: "Hike",
	VirtualRide: "Virtual ride",
	Workout: "Workout",
};

function round1(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? Math.round(value * 10) / 10
		: null;
}

/** True when intervals.icu lists an activity the session importer should take. */
export function isIntervalsIcuCrossTraining(
	activity: IntervalsIcuActivity,
): boolean {
	return (
		activity.type != null &&
		!isIntervalsIcuRide(activity) &&
		!isStravaSourced(activity)
	);
}

export type SessionSkipReason =
	| "ride"
	| "strava-sourced"
	| "no-date"
	| "no-type";

export type IntervalsIcuSessionResult =
	| { session: Omit<CrossTrainingSessionInput, "userId"> }
	| { skipped: SessionSkipReason };

/** Map one non-ride intervals.icu activity to a session summary. Pure. */
export function intervalsIcuSessionFromActivity(
	activity: IntervalsIcuActivity,
): IntervalsIcuSessionResult {
	if (isIntervalsIcuRide(activity)) return { skipped: "ride" };
	if (isStravaSourced(activity)) return { skipped: "strava-sourced" };
	const sport = activity.type?.trim();
	if (!sport) return { skipped: "no-type" };

	const local = activity.start_date_local ?? "";
	const date = local.slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { skipped: "no-date" };

	const time = local.length >= 16 ? local.slice(11, 16) : null;
	const startTime = time && /^\d{2}:\d{2}$/.test(time) ? time : null;
	const durationSeconds = Math.round(
		activity.moving_time ?? activity.elapsed_time ?? 0,
	);
	const elapsedSeconds =
		activity.elapsed_time != null ? Math.round(activity.elapsed_time) : null;
	const distanceKm =
		typeof activity.distance === "number" && activity.distance > 0
			? Math.round((activity.distance / 1000) * 10) / 10
			: null;
	const tags = Array.isArray(activity.tags)
		? [
				...new Set(
					activity.tags
						.map((tag) =>
							typeof tag === "string" ? tag.trim().replace(/^#/, "") : "",
						)
						.filter((tag) => tag.length > 0),
				),
			].slice(0, 12)
		: [];

	return {
		session: {
			date,
			startTime,
			sport,
			name: activity.name?.trim() || SPORT_LABELS[sport] || sport,
			durationSeconds,
			elapsedSeconds,
			distanceKm,
			avgHeartRate:
				typeof activity.average_heartrate === "number"
					? Math.round(activity.average_heartrate)
					: null,
			maxHeartRate:
				typeof activity.max_heartrate === "number"
					? Math.round(activity.max_heartrate)
					: null,
			trainingLoad: round1(activity.icu_training_load),
			kgLifted: round1(activity.kg_lifted),
			description: activity.description?.trim() || null,
			tags,
			source: "intervals-icu",
			sourceActivityId: activity.id,
		},
	};
}
