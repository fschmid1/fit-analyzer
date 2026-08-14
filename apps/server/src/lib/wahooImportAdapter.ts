import {
	parseFit as defaultParseFit,
	type ActivityRecord,
	type ActivitySummary,
	type LapMarker,
	type ParsedActivity,
	type StoredRecord,
} from "@fit-analyzer/shared";
import type { ImportPayload } from "./activityImporter.js";

// ─── Wahoo API response shapes ────────────────────────────────────────────────

export interface WahooWorkoutSummary {
	id: number;
	name?: string;
	ascent_accum: string;
	cadence_avg: string;
	calories_accum: string;
	distance_accum: string;
	duration_active_accum: string;
	duration_paused_accum: string;
	duration_total_accum: string;
	heart_rate_avg: string;
	power_bike_np_last: string;
	power_bike_tss_last: string;
	power_avg: string;
	speed_avg: string;
	work_accum: string;
	time_zone?: string;
	manual?: boolean;
	edited?: boolean;
	fitness_app_id?: number;
	file: { url: string | null };
	created_at: string;
	updated_at: string;
}

export interface WahooWorkout {
	id: number;
	starts: string;
	minutes: number;
	name: string;
	plan_id: number | null;
	plan_ids: number[];
	route_id: number | null;
	workout_token: string;
	workout_type_id: number;
	workout_type_family_id?: number;
	workout_summary: WahooWorkoutSummary | null;
	created_at: string;
	updated_at: string;
}

export interface WahooWorkoutsResponse {
	workouts: WahooWorkout[];
	total: number;
	page: number;
	per_page: number;
}

// ─── Biking filter ────────────────────────────────────────────────────────────

/** Biking workout type family id (covers road, indoor, trainer, virtual, ebike, etc.) */
export const BIKING_WORKOUT_TYPE_FAMILY_ID = 0;

/**
 * Wahoo workout_type_id values whose family is BIKING (id 0).
 * The /workouts endpoints return workout_type_id but not workout_type_family_id,
 * so we map the id → family ourselves. Source: Wahoo API "Workout Types" table.
 */
export const BIKING_WORKOUT_TYPE_IDS = new Set<number>([
	0, // BIKING
	11, // BIKING_CYCLECROSS
	12, // BIKING_INDOOR
	13, // BIKING_MOUNTAIN
	14, // BIKING_RECUMBENT
	15, // BIKING_ROAD
	16, // BIKING_TRACK
	17, // BIKING_MOTOCYCLING
	49, // BIKING_INDOOR_CYCLING_CLASS
	61, // BIKING_INDOOR_TRAINER
	64, // EBIKING
	68, // BIKING_INDOOR_VIRTUAL
	70, // HANDCYCLING
]);

/** Structural input for {@link isBikingWorkout} — just the fields it reads. */
export interface WorkoutTypeFields {
	workout_type_id: number;
	workout_type_family_id?: number;
}

/** Returns true if the workout belongs to the BIKING family. */
export function isBikingWorkout(workout: WorkoutTypeFields): boolean {
	// Prefer the family id when present (some responses include it)…
	if (workout.workout_type_family_id != null) {
		return workout.workout_type_family_id === BIKING_WORKOUT_TYPE_FAMILY_ID;
	}
	// …otherwise infer it from workout_type_id.
	return BIKING_WORKOUT_TYPE_IDS.has(workout.workout_type_id);
}

// ─── Fetch seam ───────────────────────────────────────────────────────────────

/**
 * Injectable FIT-file downloader. The default implementation uses the global
 * `fetch` against Wahoo's unauthenticated CDN. Tests pass in a fake that
 * returns a canned ArrayBuffer.
 */
export interface FitDownloader {
	/** Fetch the FIT file bytes. Must throw on non-2xx. */
	downloadFit(url: string): Promise<ArrayBuffer>;
}

export const defaultFitDownloader: FitDownloader = {
	async downloadFit(url) {
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(`Failed to download FIT file from ${url}: ${res.status}`);
		}
		return res.arrayBuffer();
	},
};

/**
 * Injectable FIT parser. The default delegates to the shared `parseFit`;
 * tests pass in a fake that returns a canned {@link ParsedActivity} without
 * needing a real FIT file.
 */
export interface FitParser {
	parse(arrayBuffer: ArrayBuffer): ParsedActivity;
}

const defaultFitParser: FitParser = {
	parse: (buf) => defaultParseFit(buf),
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Outcome of a single Wahoo workout fetch+transform.
 *
 * - `{ payload }` — the workout is a biking workout with a downloadable FIT
 *   file, and was transformed successfully; the caller hands the payload to
 *   `importActivity`.
 * - `{ skipped: "not-biking" }` — workout is not in the biking family; the
 *   caller should not retry.
 * - `{ skipped: "pending" }` — workout is biking but has no downloadable FIT
 *   file yet; the caller may want to retry later (Wahoo uploads the FIT file to
 *   its CDN asynchronously and does NOT re-fire the workout_summary webhook
 *   when it becomes available).
 */
export type WahooAdapterResult =
	| { payload: ImportPayload }
	| { skipped: "not-biking" }
	| { skipped: "pending" };

export interface WahooAdapterOptions {
	/** Override the FIT-file downloader (tests inject a fake). */
	downloader?: FitDownloader;
	/** Override the FIT parser (tests inject a fake returning canned data). */
	parser?: FitParser;
}

/**
 * Download a workout's FIT file, parse it, and transform it into a normalized
 * {@link ImportPayload}. Does NOT touch SQLite — the caller is responsible for
 * calling `importActivity` with the returned payload.
 *
 * - `{ skipped: "not-biking" }` — `isBikingWorkout` returned false; do not retry.
 * - `{ skipped: "pending" }` — biking workout, but `workout_summary.file.url`
 *   is null; the caller may retry later.
 */
export async function wahooWorkoutToPayload(
	userId: string,
	workout: WahooWorkout,
	options: WahooAdapterOptions = {},
): Promise<WahooAdapterResult> {
	const downloader = options.downloader ?? defaultFitDownloader;
	const parser = options.parser ?? defaultFitParser;

	if (!isBikingWorkout(workout)) {
		return { skipped: "not-biking" };
	}

	const fitUrl = workout.workout_summary?.file?.url;
	if (!fitUrl) {
		console.log(
			`[wahoo] Workout ${workout.id} has no FIT file yet — deferring (caller may retry)`,
		);
		return { skipped: "pending" };
	}

	const fitBuffer = await downloader.downloadFit(fitUrl);

	// Parse using the shared FIT parser (same as client-side uploads)
	const { records, summary, laps } = parser.parse(fitBuffer);

	// Convert ActivityRecord[] (Date timestamps) → StoredRecord[] (ISO strings)
	const storedRecords: StoredRecord[] = records.map((r) => ({
		...r,
		timestamp: r.timestamp.toISOString(),
	}));

	return {
		payload: {
			source: "wahoo",
			sourceActivityId: String(workout.id),
			records: storedRecords,
			summary,
			laps,
			userId,
		},
	};
}
