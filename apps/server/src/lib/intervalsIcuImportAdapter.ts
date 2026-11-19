import type {
	ActivitySummary,
	LapMarker,
	StoredRecord,
} from "@fit-analyzer/shared";
import type { ImportPayload } from "./activityImporter.js";
import {
	fetchIntervalsIcuStreams,
	type IntervalsIcuActivity,
	type IntervalsIcuStream,
} from "./intervalsIcuClient.js";
import { summarizeRideRecords } from "./rideSummary.js";
import { wallClockToInstant } from "./wallClock.js";

/**
 * Turn one intervals.icu activity into a normalized ImportPayload.
 *
 * Rides are imported from per-second streams, never from intervals.icu's own
 * summary or its interval detection: the app already analyses rides from
 * records and detects intervals itself, so importing raw seconds is what makes
 * an intervals.icu ride behave exactly like a Strava or FIT-imported one.
 *
 * Strava-sourced activities are skipped — intervals.icu serves only a stub for
 * them, and Strava's API terms forbid re-downloading their data through a
 * third party.
 */

const RIDE_TYPES = new Set([
	"Ride",
	"VirtualRide",
	"EBikeRide",
	"MountainBikeRide",
	"GravelRide",
	"TrackRide",
	"Cyclocross",
	"Handcycle",
	"Velomobile",
	"RideCrossCountry",
	"RideIndoor",
]);

export function isIntervalsIcuRide(activity: IntervalsIcuActivity): boolean {
	return activity.type != null && RIDE_TYPES.has(activity.type);
}

/** True when intervals.icu is only relaying a Strava ride. */
export function isStravaSourced(activity: IntervalsIcuActivity): boolean {
	return (
		activity.source?.toUpperCase() === "STRAVA" || activity.strava_id != null
	);
}

function streamData(
	streams: IntervalsIcuStream[],
	type: string,
): number[] | [number, number][] {
	return streams.find((s) => s.type === type)?.data ?? [];
}

function numericStream(streams: IntervalsIcuStream[], type: string): number[] {
	const data = streamData(streams, type);
	return Array.isArray(data) ? (data as number[]) : [];
}

export function buildRecordsFromStreams(
	start: Date,
	streams: IntervalsIcuStream[],
): StoredRecord[] {
	const time = numericStream(streams, "time");
	const watts = numericStream(streams, "watts");
	const heartrate = numericStream(streams, "heartrate");
	const cadence = numericStream(streams, "cadence");
	const velocity = numericStream(streams, "velocity_smooth");
	const grade = numericStream(streams, "grade_smooth");
	const latlng = streamData(streams, "latlng") as [number, number][];

	return time.map((elapsed, i) => {
		const point = latlng[i];
		return {
			timestamp: new Date(start.getTime() + elapsed * 1000).toISOString(),
			elapsedSeconds: elapsed,
			power: watts[i] ?? null,
			heartRate: heartrate[i] ?? null,
			cadence: cadence[i] ?? null,
			// intervals.icu streams velocity in m/s.
			speed:
				velocity[i] != null ? Math.round(velocity[i] * 3.6 * 10) / 10 : null,
			gradient: grade[i] ?? null,
			lat: Array.isArray(point) ? point[0] : null,
			lng: Array.isArray(point) ? point[1] : null,
		};
	});
}

export type IntervalsIcuAdapterResult =
	| { payload: ImportPayload }
	| { skipped: "not-a-ride" | "strava-sourced" | "no-streams" };

/** Fetch one activity's streams and transform it. Never touches SQLite. */
export async function intervalsIcuActivityToPayload(
	userId: string,
	apiKey: string,
	activity: IntervalsIcuActivity,
	timezone: string | null,
): Promise<IntervalsIcuAdapterResult> {
	if (!isIntervalsIcuRide(activity)) return { skipped: "not-a-ride" };
	if (isStravaSourced(activity)) return { skipped: "strava-sourced" };

	const streams = await fetchIntervalsIcuStreams(apiKey, activity.id);
	const localStart = activity.start_date_local;
	if (!localStart) return { skipped: "no-streams" };
	// `start_date_local` has no offset: the training timezone turns the wall
	// clock into the real instant, so stored records match Strava/FIT records
	// and same-ride dedupe compares like with like.
	const start = timezone
		? wallClockToInstant(localStart, timezone)
		: new Date(`${localStart.slice(0, 19)}Z`);
	if (!start || !Number.isFinite(start.getTime())) {
		return { skipped: "no-streams" };
	}

	const records = buildRecordsFromStreams(start, streams);
	if (records.length === 0) return { skipped: "no-streams" };

	const durationSeconds =
		activity.moving_time ?? records[records.length - 1]?.elapsedSeconds ?? 0;
	const distanceMeters = activity.distance ?? lastDistance(streams);
	const summary: ActivitySummary = summarizeRideRecords({
		date: localStart.slice(0, 10),
		durationSeconds,
		distanceMeters,
		records,
	});
	const laps: LapMarker[] = [];

	return {
		payload: {
			source: "intervals-icu",
			sourceActivityId: activity.id,
			records,
			summary,
			laps,
			userId,
			timezone,
		},
	};
}

function lastDistance(streams: IntervalsIcuStream[]): number | null {
	const distance = numericStream(streams, "distance");
	return distance.length > 0 ? (distance[distance.length - 1] ?? null) : null;
}

/** Import window helpers: local ISO dates, inclusive ranges. */
export function isoLocalDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}
