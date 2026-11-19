/**
 * IntervalsIcu REST access. Every function takes the athlete's API key — no
 * token lifecycle lives here. `athlete/0` is intervals.icu's own shorthand for
 * "the athlete this credential belongs to", so we never store an id to build
 * paths (we do store it for display).
 *
 * One-segment API: each call returns typed data or throws with context; the
 * plan tools and the importer turn those throws into tool errors / backfill
 * failures.
 */

const BASE = "https://intervals.icu";

/** The subset of an intervals.icu event the app reads and writes. */
export interface IntervalsIcuEvent {
	id: number;
	uid?: string | null;
	category?: string | null;
	type?: string | null;
	start_date_local?: string | null;
	end_date_local?: string | null;
	name?: string | null;
	description?: string | null;
	moving_time?: number | null;
	workout_doc?: unknown;
	updated?: string | null;
	athlete_cannot_edit?: boolean | null;
	created_by_id?: string | null;
	external_id?: string | null;
}

export interface IntervalsIcuEventInput {
	uid: string;
	external_id: string;
	category: "WORKOUT" | "NOTE" | "RACE_A" | "RACE_B" | "RACE_C";
	type: string;
	start_date_local: string;
	name: string;
	description: string;
	moving_time: number;
	workout_doc?: unknown;
}

export interface IntervalsIcuAthlete {
	id: string;
	name: string | null;
}

/** A ride as intervals.icu lists it — the fields the importer acts on. */
export interface IntervalsIcuActivity {
	id: string;
	start_date_local?: string | null;
	type?: string | null;
	/** Where the ride came from, e.g. "STRAVA" or "GARMIN_CONNECT". */
	source?: string | null;
	strava_id?: string | null;
	name?: string | null;
	moving_time?: number | null;
	elapsed_time?: number | null;
	distance?: number | null;
	average_watts?: number | null;
	icu_average_watts?: number | null;
	icu_weighted_avg_watts?: number | null;
	max_watts?: number | null;
	average_heartrate?: number | null;
	max_heartrate?: number | null;
	average_cadence?: number | null;
	icu_training_load?: number | null;
	/** Total kilograms lifted, reported for strength sessions. */
	kg_lifted?: number | null;
	icu_rpe?: number | null;
	total_elevation_gain?: number | null;
	device_name?: string | null;
	device_watts?: boolean | null;
}

/** One per-second stream as GET /activity/{id}/streams returns it. */
export interface IntervalsIcuStream {
	type: string;
	name?: string;
	data: number[] | [number, number][];
}

/** Stream types the importer asks for. */
export const INTERVALS_ICU_STREAM_TYPES = [
	"time",
	"watts",
	"heartrate",
	"cadence",
	"velocity_smooth",
	"grade_smooth",
	"latlng",
	"distance",
] as const;

async function icuFetch(
	apiKey: string,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Basic ${btoa(`API_KEY:${apiKey}`)}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			...(init?.headers ?? {}),
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(
			`intervals.icu ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 300)}`,
		);
	}
	return res;
}

/** Verify a key and read the athlete it belongs to. */
export async function fetchIntervalsIcuAthlete(
	apiKey: string,
): Promise<IntervalsIcuAthlete> {
	const res = await icuFetch(apiKey, "/api/v1/athlete/0");
	const data = (await res.json()) as {
		id?: string | number;
		name?: string | null;
		athlete_id?: string | number;
	};
	const id = String(data.id ?? data.athlete_id ?? "");
	if (!id) throw new Error("intervals.icu returned no athlete id");
	return { id, name: data.name ?? null };
}

/**
 * List the athlete's calendar events in a local-date range. The whole calendar
 * is returned (races, notes, planned workouts share one calendar); callers
 * separate app-owned workouts from context.
 */
export async function listIntervalsIcuEvents(
	apiKey: string,
	oldestDate: string,
	newestDate: string,
): Promise<IntervalsIcuEvent[]> {
	const params = new URLSearchParams({
		oldest: oldestDate,
		newest: newestDate,
	});
	const res = await icuFetch(apiKey, `/api/v1/athlete/0/events?${params}`);
	return (await res.json()) as IntervalsIcuEvent[];
}

/**
 * Create/update events by uid. `upsertOnUid` is available to every credential,
 * unlike `upsert` on external_id which is scoped to OAuth-app-created events.
 */
export async function upsertIntervalsIcuEvents(
	apiKey: string,
	events: IntervalsIcuEventInput[],
): Promise<IntervalsIcuEvent[]> {
	if (events.length === 0) return [];
	const params = new URLSearchParams({
		upsertOnUid: "true",
		upsert: "false",
		updatePlanApplied: "false",
	});
	const res = await icuFetch(
		apiKey,
		`/api/v1/athlete/0/events/bulk?${params}`,
		{ method: "POST", body: JSON.stringify(events) },
	);
	return (await res.json()) as IntervalsIcuEvent[];
}

export async function deleteIntervalsIcuEvents(
	apiKey: string,
	eventIds: number[],
): Promise<void> {
	if (eventIds.length === 0) return;
	await icuFetch(apiKey, "/api/v1/athlete/0/events/bulk-delete", {
		method: "PUT",
		body: JSON.stringify(eventIds.map((id) => ({ id }))),
	});
}

/** List completed activities by local date range, newest first. */
export async function listIntervalsIcuActivities(
	apiKey: string,
	oldestDate: string,
	newestDate: string,
	// A 90-day window can hold more than 200 activities once walks and
	// cross-training sessions are counted, so the manual sync asks for more.
	limit = 500,
): Promise<IntervalsIcuActivity[]> {
	const params = new URLSearchParams({
		oldest: oldestDate,
		newest: newestDate,
		limit: String(limit),
	});
	const res = await icuFetch(apiKey, `/api/v1/athlete/0/activities?${params}`);
	return (await res.json()) as IntervalsIcuActivity[];
}

/** Per-second streams for one activity, as intervals.icu's JSON stream list. */
export async function fetchIntervalsIcuStreams(
	apiKey: string,
	activityId: string,
): Promise<IntervalsIcuStream[]> {
	const params = new URLSearchParams({
		types: INTERVALS_ICU_STREAM_TYPES.join(","),
	});
	const res = await icuFetch(
		apiKey,
		`/api/v1/activity/${encodeURIComponent(activityId)}/streams?${params}`,
	);
	return (await res.json()) as IntervalsIcuStream[];
}
