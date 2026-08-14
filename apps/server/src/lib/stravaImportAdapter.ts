import {
	normalizedPowerFromSeconds,
	normalizedCadenceFromSeconds,
	peakPowerFromTimeSeries,
	buildMetricBySecondFromTimeSeries,
	type ActivitySummary,
	type LapMarker,
	type StoredRecord,
} from "@fit-analyzer/shared";
import type { ImportPayload } from "./activityImporter.js";

// ─── Strava API response shapes ───────────────────────────────────────────────

export interface StravaActivity {
	id: number;
	name: string;
	type: string;
	sport_type: string;
	start_date: string;
	moving_time: number;
	elapsed_time: number;
	distance?: number;
	average_watts?: number;
	max_watts?: number;
	average_heartrate?: number;
	max_heartrate?: number;
	average_cadence?: number;
	kilojoules?: number;
	location_city?: string | null;
	location_state?: string | null;
	location_country?: string | null;
}

interface StravaNumericStream {
	type: string;
	data: number[];
}

interface StravaLatLngStream {
	type: string;
	data: [number, number][];
}

export interface StravaStreams {
	time?: StravaNumericStream;
	watts?: StravaNumericStream;
	heartrate?: StravaNumericStream;
	cadence?: StravaNumericStream;
	velocity_smooth?: StravaNumericStream;
	grade_smooth?: StravaNumericStream;
	latlng?: StravaLatLngStream;
}

export interface StravaLap {
	start_index: number;
	end_index: number;
	average_watts?: number;
	average_heartrate?: number;
	average_cadence?: number;
}

// ─── Ride-type filter ─────────────────────────────────────────────────────────

export const RIDE_TYPES = new Set(["Ride", "VirtualRide", "EBikeRide"]);

/** Returns true if the Strava activity is a ride we should import. */
export function isRideActivity(activity: StravaActivity): boolean {
	return RIDE_TYPES.has(activity.type) || RIDE_TYPES.has(activity.sport_type);
}

// ─── Stream → record converters ───────────────────────────────────────────────

/** Build StoredRecord[] from Strava streams (key_by_type format). */
export function buildRecords(
	startDate: Date,
	streams: StravaStreams,
): StoredRecord[] {
	const timeData = streams.time?.data ?? [];
	const wattsData = streams.watts?.data ?? [];
	const hrData = streams.heartrate?.data ?? [];
	const cadData = streams.cadence?.data ?? [];
	const velData = streams.velocity_smooth?.data ?? [];
	const gradeData = streams.grade_smooth?.data ?? [];
	const latLngData = streams.latlng?.data ?? [];

	return timeData.map((elapsed, i) => ({
		timestamp: new Date(startDate.getTime() + elapsed * 1000).toISOString(),
		elapsedSeconds: elapsed,
		power: wattsData[i] ?? null,
		heartRate: hrData[i] ?? null,
		cadence: cadData[i] ?? null,
		speed: velData[i] != null ? Math.round(velData[i] * 3.6 * 10) / 10 : null,
		gradient: gradeData[i] ?? null,
		lat: latLngData[i]?.[0] ?? null,
		lng: latLngData[i]?.[1] ?? null,
	}));
}

/**
 * Build ActivitySummary entirely from raw stream data.
 * Nothing is taken from Strava's pre-computed API fields.
 *
 * Uses a simple mean of non-zero samples, matching Garmin's session record:
 * the device records at 1 Hz so its simple mean == its time-weighted mean.
 * Time-weighting Strava's variable-rate stream is NOT equivalent because large
 * Δt values at pause/auto-pause boundaries are gaps, not sample durations —
 * weighting by them over-penalises the first sample after each stop.
 */
export function buildSummary(
	activity: StravaActivity,
	records: StoredRecord[],
	timeArr: number[],
	wattsArr: number[],
	cadenceArr: number[],
): ActivitySummary {
	// Simple mean of non-zero values, mirroring Garmin session record behaviour:
	// zeros (coasting / sensor dropout) are excluded from averages.
	const powerVals = records
		.map((r) => r.power)
		.filter((v): v is number => v !== null && v > 0);
	const hrVals = records
		.map((r) => r.heartRate)
		.filter((v): v is number => v !== null && v > 0);
	const cadVals = records
		.map((r) => r.cadence)
		.filter((v): v is number => v !== null && v > 0);

	const avg = (vals: number[]) =>
		vals.length
			? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
			: null;
	const max = (vals: number[]) =>
		vals.length ? vals.reduce((m, v) => (v > m ? v : m), vals[0]) : null;

	// Total work: ∫ power dt (W·s = J), nulls treated as 0W
	let totalWork: number | null = null;
	if (wattsArr.length > 0 && timeArr.length === wattsArr.length) {
		let joules = 0;
		for (let i = 0; i < wattsArr.length; i++) {
			const dt = i === 0 ? timeArr[0] : timeArr[i] - timeArr[i - 1];
			joules += (wattsArr[i] ?? 0) * dt;
		}
		totalWork = Math.round(joules);
	}

	return {
		date: activity.start_date.slice(0, 10),
		// moving_time matches Garmin's totalTimerTime (excludes pauses; time stream
		// runs 0→elapsed_time which overshoots by the total paused duration)
		totalTimerTime: activity.moving_time,
		totalDistanceKm:
			activity.distance != null
				? Math.round((activity.distance / 1000) * 10) / 10
				: null,
		avgPower: avg(powerVals),
		normalizedPower: normalizedPowerFromSeconds(
			buildMetricBySecondFromTimeSeries(timeArr, wattsArr),
		),
		maxPower: max(powerVals),
		avgHeartRate: avg(hrVals),
		maxHeartRate: max(hrVals),
		avgCadence: avg(cadVals),
		normalizedCadence: normalizedCadenceFromSeconds(
			buildMetricBySecondFromTimeSeries(timeArr, cadenceArr),
		),
		totalWork,
		peak1minPower: peakPowerFromTimeSeries(timeArr, wattsArr, 60),
		peak5minPower: peakPowerFromTimeSeries(timeArr, wattsArr, 300),
		peak20minPower: peakPowerFromTimeSeries(timeArr, wattsArr, 1200),
		locationCity: activity.location_city ?? null,
		locationState: activity.location_state ?? null,
		locationCountry: activity.location_country ?? null,
	};
}

/** Build LapMarker[] from Strava laps, converting stream indices to elapsed seconds. */
export function buildLaps(laps: StravaLap[], timeArr: number[]): LapMarker[] {
	return laps.map((lap) => ({
		startSeconds: timeArr[lap.start_index] ?? lap.start_index,
		endSeconds:
			timeArr[Math.min(lap.end_index, timeArr.length - 1)] ?? lap.end_index,
		avgPower: lap.average_watts ?? null,
		avgHeartRate: lap.average_heartrate ?? null,
		avgCadence: lap.average_cadence ?? null,
	}));
}

// ─── Fetch seam ───────────────────────────────────────────────────────────────

/**
 * Injectable fetch interface. The default implementation uses the global
 * `fetch`; tests pass in a fake that returns canned Strava responses.
 */
export interface StravaFetch {
	/**
	 * Fetch the activity object. Must throw on non-2xx.
	 */
	fetchActivity(
		stravaActivityId: number,
		accessToken: string,
	): Promise<StravaActivity>;
	/**
	 * Fetch the streams (time/watts/heartrate/...). Returns an empty object
	 * when Strava reports streams unavailable (non-2xx).
	 */
	fetchStreams(
		stravaActivityId: number,
		accessToken: string,
	): Promise<StravaStreams>;
	/**
	 * Fetch laps. Returns an empty array on non-2xx.
	 */
	fetchLaps(
		stravaActivityId: number,
		accessToken: string,
	): Promise<StravaLap[]>;
}

const STRAVA_API = "https://www.strava.com/api/v3";

export const defaultStravaFetch: StravaFetch = {
	async fetchActivity(id, token) {
		const res = await fetch(`${STRAVA_API}/activities/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok)
			throw new Error(`Failed to fetch activity ${id}: ${res.status}`);
		return (await res.json()) as StravaActivity;
	},
	async fetchStreams(id, token) {
		const res = await fetch(
			`${STRAVA_API}/activities/${id}/streams?keys=time,watts,heartrate,cadence,velocity_smooth,grade_smooth,latlng&key_by_type=true`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		if (!res.ok) {
			console.warn(
				`[strava] Streams unavailable for activity ${id}: ${res.status}`,
			);
			return {};
		}
		return (await res.json()) as StravaStreams;
	},
	async fetchLaps(id, token) {
		const res = await fetch(`${STRAVA_API}/activities/${id}/laps`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return [];
		return (await res.json()) as StravaLap[];
	},
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Outcome of a single Strava activity fetch+transform.
 *
 * - `{ payload }` — the activity is a ride and was transformed successfully;
 *   the caller hands the payload to `importActivity`.
 * - `{ skipped: "not-a-ride" }` — activity type is not in the ride set; the
 *   caller should not retry.
 */
export type StravaAdapterResult =
	| { payload: ImportPayload }
	| { skipped: "not-a-ride" };

/**
 * Fetch a single Strava activity (activity, streams, laps) and transform it
 * into a normalized {@link ImportPayload}. Does NOT touch SQLite — the caller
 * is responsible for calling `importActivity` with the returned payload.
 *
 * Returns `{ skipped: "not-a-ride" }` when the activity's type is not in the
 * ride set, so the caller can skip without retrying.
 */
export async function stravaActivityToPayload(
	userId: string,
	stravaActivityId: number,
	accessToken: string,
	fetcher: StravaFetch = defaultStravaFetch,
): Promise<StravaAdapterResult> {
	const activity = await fetcher.fetchActivity(stravaActivityId, accessToken);
	if (!isRideActivity(activity)) {
		return { skipped: "not-a-ride" };
	}

	const streams = await fetcher.fetchStreams(stravaActivityId, accessToken);
	const laps = await fetcher.fetchLaps(stravaActivityId, accessToken);

	const timeArr = streams.time?.data ?? [];
	const wattsArr = streams.watts?.data ?? [];
	const cadenceArr = streams.cadence?.data ?? [];
	const startDate = new Date(activity.start_date);

	const records = buildRecords(startDate, streams);
	const summary = buildSummary(
		activity,
		records,
		timeArr,
		wattsArr,
		cadenceArr,
	);
	const lapMarkers = buildLaps(laps, timeArr);

	return {
		payload: {
			source: "strava",
			sourceActivityId: String(stravaActivityId),
			records,
			summary,
			laps: lapMarkers,
			userId,
		},
	};
}
