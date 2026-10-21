import { db } from "../db.js";
import { env } from "../env.js";
import type {
	HealthContext,
	HealthHistoryEntry,
	HealthMetricStatus,
	SleepStages,
} from "@fit-analyzer/shared";
import {
	HEALTH_CONTEXT_DAYS,
	healthHistoryDateRange,
	recentDateWindow,
} from "./healthDates.js";
import {
	getDailySnapshots,
	upsertDailySnapshot,
	type HealthHistorySource,
} from "./healthHistory.js";

const OW_SOURCE: HealthHistorySource = "openwearables";

interface CacheEntry {
	data: HealthContext;
	fetchedAt: number;
}

interface BodyCacheEntry {
	data: BodySummaryResponse;
	fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const bodyCache = new Map<string, BodyCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function pruneCache() {
	const now = Date.now();
	for (const [key, entry] of cache) {
		if (now - entry.fetchedAt >= CACHE_TTL_MS) {
			cache.delete(key);
		}
	}
	for (const [key, entry] of bodyCache) {
		if (now - entry.fetchedAt >= CACHE_TTL_MS) {
			bodyCache.delete(key);
		}
	}
}

const getOwUserStmt = db.prepare(
	"SELECT ow_user_id FROM user_settings WHERE user_id = ?",
);

function getOwUserId(fitUserId: string): string | null {
	const row = getOwUserStmt.get(fitUserId) as
		| { ow_user_id: string | null }
		| undefined;
	return row?.ow_user_id?.trim() || null;
}

function isConfigured(): boolean {
	return !!(env.OW_BASE_URL && env.OW_API_KEY);
}

/**
 * One day of OpenWearables data, as persisted in health_daily_history.
 * Sleep summaries and the daily resting-HR/HRV series fill their own dates;
 * body composition and the 7-day averages ride on the most recent snapshot
 * date, while point-in-time temperature keeps its measurement date.
 */
export interface OwDailySnapshot {
	sleep?: {
		durationMinutes: number;
		efficiencyPercent: number | null;
		stages: SleepStages | null;
		avgHeartRateBpm: number | null;
		avgHrvSdnnMs: number | null;
		avgRespiratoryRate: number | null;
		avgSpo2Percent: number | null;
	} | null;
	weightKg?: number | null;
	/** Latest body temperature from the body summary, persisted with its date. */
	bodyTemperatureC?: number | null;
	/**
	 * When the body temperature was measured. The body summary also returns
	 * `null` once a reading is older than its freshness window, but an old
	 * value can survive in history; keep the timestamp so it is not shown as
	 * current indefinitely.
	 */
	bodyTemperatureMeasuredAt?: string | null;
	/**
	 * Resting HR for this date, from the `resting_heart_rate` series. This is
	 * the daily number OpenWearables plots; the body summary's 7-day average
	 * lives in `restingHeartRateBpm` so the two are not confused.
	 */
	dailyRestingHeartRateBpm?: number | null;
	/** Daily HRV (SDNN) for this date, from the HRV series. */
	dailyHrvSdnnMs?: number | null;
	/**
	 * Averaged resting HR from the body summary (7-day window) — the number
	 * OpenWearables reports under "Averaged over 7 days". Used as the trend
	 * baseline; the daily series above supplies the current value.
	 */
	restingHeartRateBpm?: number | null;
	/** Averaged HRV (SDNN) from the same body-summary window. */
	avgHrvSdnnMs?: number | null;
}

interface SleepRecord {
	date: string;
	/** OpenWearables can omit duration for a session with vitals but no span. */
	duration_minutes: number | null;
	efficiency_percent?: number;
	stages?: {
		awake_minutes?: number;
		light_minutes?: number;
		deep_minutes?: number;
		rem_minutes?: number;
	};
	avg_heart_rate_bpm?: number;
	avg_hrv_sdnn_ms?: number;
	avg_respiratory_rate?: number;
	avg_spo2_percent?: number;
	[key: string]: unknown;
}

/**
 * OpenWearables' blood-pressure payload. The API returns averaged systolic /
 * diastolic fields, not a plain `{ systolic, diastolic }` pair.
 */
export interface OwBloodPressure {
	avg_systolic_mmhg: number | null;
	avg_diastolic_mmhg: number | null;
	max_systolic_mmhg: number | null;
	max_diastolic_mmhg: number | null;
	min_systolic_mmhg: number | null;
	min_diastolic_mmhg: number | null;
	reading_count: number | null;
}

export interface BodySummaryResponse {
	source: { provider: string; device: string | null };
	slow_changing: {
		weight_kg: number | null;
		height_cm: number | null;
		body_fat_percent: number | null;
		muscle_mass_kg: number | null;
		bmi: number | null;
		age: number | null;
	};
	averaged: {
		period_days: number;
		resting_heart_rate_bpm: number | null;
		avg_hrv_sdnn_ms: number | null;
		avg_hrv_rmssd_ms: number | null;
		period_start: string;
		period_end: string;
	};
	latest: {
		body_temperature_celsius: number | null;
		body_temperature_measured_at: string | null;
		skin_temperature_celsius: number | null;
		skin_temperature_measured_at: string | null;
		blood_pressure: OwBloodPressure | null;
		blood_pressure_measured_at: string | null;
	};
}

export interface OwBodySummary {
	weightKg: number | null;
	heightCm: number | null;
	bodyFatPercent: number | null;
	muscleMassKg: number | null;
	bmi: number | null;
	age: number | null;
	bloodPressure: { systolic: number; diastolic: number } | null;
	source: { provider: string; device: string | null };
}

/** Fetch one extra day so timezone spillover cannot shorten the 7-day window. */
const HEALTH_HISTORY_QUERY_DAYS = HEALTH_CONTEXT_DAYS + 1;

function getDateRange(): { startDate: string; endDate: string } {
	return healthHistoryDateRange(HEALTH_HISTORY_QUERY_DAYS);
}

async function fetchSleepSummaries(
	owUserId: string,
): Promise<SleepRecord[] | null> {
	const { startDate, endDate } = getDateRange();
	console.log(
		`[ow] fetching sleep summaries for user ${owUserId} from ${startDate} to ${endDate}`,
	);
	const params = new URLSearchParams({
		start_date: startDate,
		end_date: endDate,
		// The query spans eight days plus tomorrow for timezone spillover;
		// ask for all of them so the oldest page cannot hide the newest night.
		limit: "10",
	});
	const apiKey = env.OW_API_KEY;
	if (!apiKey) throw new Error("OW_API_KEY not configured");
	const res = await fetch(
		`${env.OW_BASE_URL}/api/v1/users/${encodeURIComponent(owUserId)}/summaries/sleep?${params}`,
		{
			headers: { "X-Open-Wearables-API-Key": apiKey },
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!res.ok) {
		console.warn(
			`[ow] sleep fetch failed: ${res.status} ${res.statusText} (response body redacted)`,
		);
		return null;
	}
	const json = (await res.json()) as { data: SleepRecord[] };
	return json.data;
}

/** The daily vitals OpenWearables plots as trends. */
const DAILY_VITAL_TYPES = [
	"resting_heart_rate",
	"heart_rate_variability_sdnn",
] as const;

type DailyVitalType = (typeof DAILY_VITAL_TYPES)[number];

export interface OwTimeseriesSample {
	timestamp: string;
	type: string;
	value: number;
	is_daily_total?: boolean | null;
}

/**
 * One point a day, the mean of that UTC day's readings. OpenWearables' body
 * trends group the same way, so the current value matches what the user sees
 * on the trend chart even when the provider reports several readings a day.
 */
export function dailyMeans(
	samples: OwTimeseriesSample[],
	type: DailyVitalType,
): Map<string, number> {
	const totals = new Map<string, { sum: number; count: number }>();
	for (const sample of samples) {
		if (sample.type !== type || sample.is_daily_total === true) continue;
		const value = Number(sample.value);
		if (!Number.isFinite(value) || value <= 0) continue;
		const parsed = Date.parse(sample.timestamp);
		if (!Number.isFinite(parsed)) continue;
		const date = new Date(parsed).toISOString().slice(0, 10);
		const entry = totals.get(date) ?? { sum: 0, count: 0 };
		entry.sum += value;
		entry.count += 1;
		totals.set(date, entry);
	}
	return new Map(
		[...totals].map(([date, { sum, count }]) => [date, sum / count]),
	);
}

interface OwTimeseriesPage {
	data?: OwTimeseriesSample[];
	pagination?: {
		next_cursor?: string | null;
		has_more?: boolean;
	} | null;
}

/** OpenWearables caps `limit` at 100; larger values are a 400. */
const TIMESERIES_PAGE_LIMIT = 100;
/** Bounds a pathological or looping cursor; 20 pages is 2000 samples. */
const TIMESERIES_MAX_PAGES = 20;

/**
 * Fetch the daily RHR/HRV series. The endpoint paginates with an opaque
 * cursor and rejects `limit` above 100, so walk the pages instead of asking
 * for the whole window in one request.
 *
 * Exported for tests; production callers use `getRawHealthContext`.
 */
export async function fetchDailyVitals(
	owUserId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{
	rhr: Map<string, number>;
	hrv: Map<string, number>;
} | null> {
	const apiKey = env.OW_API_KEY;
	if (!apiKey) throw new Error("OW_API_KEY not configured");
	const { startDate, endDate } = getDateRange();

	const samples: OwTimeseriesSample[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < TIMESERIES_MAX_PAGES; page++) {
		const params = new URLSearchParams({
			start_time: `${startDate}T00:00:00Z`,
			end_time: `${endDate}T23:59:59Z`,
			// Hourly buckets keep a noisy series (HRV) under the page limit
			// while still giving a faithful daily mean.
			resolution: "1hour",
			limit: String(TIMESERIES_PAGE_LIMIT),
		});
		for (const type of DAILY_VITAL_TYPES) params.append("types", type);
		if (cursor) params.set("cursor", cursor);

		const res = await fetchImpl(
			`${env.OW_BASE_URL}/api/v1/users/${encodeURIComponent(owUserId)}/timeseries?${params}`,
			{
				headers: { "X-Open-Wearables-API-Key": apiKey },
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!res.ok) {
			console.warn(
				`[ow] timeseries fetch failed: ${res.status} ${res.statusText} (response body redacted)`,
			);
			return null;
		}
		const json = (await res.json()) as OwTimeseriesPage;
		samples.push(...(json.data ?? []));
		const nextCursor = json.pagination?.next_cursor ?? null;
		if (!nextCursor || json.pagination?.has_more === false) {
			cursor = null;
			break;
		}
		cursor = nextCursor;
	}
	if (cursor) {
		console.warn(
			`[ow] timeseries pagination stopped after ${TIMESERIES_MAX_PAGES} pages; later samples were dropped`,
		);
	}

	return {
		rhr: dailyMeans(samples, "resting_heart_rate"),
		hrv: dailyMeans(samples, "heart_rate_variability_sdnn"),
	};
}

/** The window OpenWearables uses when it labels a point reading "recent". */
const BODY_LATEST_WINDOW_HOURS = 4;
const BODY_LATEST_WINDOW_MS = BODY_LATEST_WINDOW_HOURS * 60 * 60 * 1000;
const BODY_AVERAGE_PERIOD_DAYS = 7;

async function fetchBodySummary(
	owUserId: string,
): Promise<BodySummaryResponse | null> {
	const apiKey = env.OW_API_KEY;
	if (!apiKey) throw new Error("OW_API_KEY not configured");
	const params = new URLSearchParams({
		average_period: String(BODY_AVERAGE_PERIOD_DAYS),
		latest_window_hours: String(BODY_LATEST_WINDOW_HOURS),
	});
	const res = await fetch(
		`${env.OW_BASE_URL}/api/v1/users/${encodeURIComponent(owUserId)}/summaries/body?${params}`,
		{
			headers: { "X-Open-Wearables-API-Key": apiKey },
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!res.ok) {
		console.warn(
			`[ow] body fetch failed: ${res.status} ${res.statusText} (response body redacted)`,
		);
		return null;
	}
	return (await res.json()) as BodySummaryResponse;
}

function determineStatus(
	latest: number,
	avg: number | null,
	metric: "rhr" | "hrv" | "respiratoryRate" | "spo2" | "temperature",
): HealthMetricStatus {
	if (avg == null) return "normal";

	switch (metric) {
		case "rhr":
			return latest > avg + 5 ? "elevated" : "normal";
		case "hrv":
			return latest < avg * 0.9 ? "lower" : "normal";
		case "respiratoryRate": {
			const diff = latest - avg;
			if (diff > 2) return "higher";
			if (diff < -2) return "lower";
			return "normal";
		}
		case "spo2": {
			const diff = latest - avg;
			if (diff > 1) return "higher";
			if (diff < -1) return "lower";
			return "normal";
		}
		case "temperature": {
			const diff = latest - avg;
			if (diff > 0.3) return "higher";
			if (diff < -0.3) return "lower";
			return "normal";
		}
	}
}

// ─── Snapshot persistence ────────────────────────────────────────────────────

function sleepRecordToSnapshot(rec: SleepRecord): OwDailySnapshot {
	const stages: SleepStages | null = rec.stages
		? {
				awakeMinutes: rec.stages.awake_minutes ?? 0,
				lightMinutes: rec.stages.light_minutes ?? 0,
				deepMinutes: rec.stages.deep_minutes ?? 0,
				remMinutes: rec.stages.rem_minutes ?? 0,
			}
		: null;
	return {
		sleep: {
			durationMinutes: rec.duration_minutes ?? 0,
			efficiencyPercent: rec.efficiency_percent ?? null,
			stages,
			avgHeartRateBpm: rec.avg_heart_rate_bpm ?? null,
			avgHrvSdnnMs: rec.avg_hrv_sdnn_ms ?? null,
			avgRespiratoryRate: rec.avg_respiratory_rate ?? null,
			avgSpo2Percent: rec.avg_spo2_percent ?? null,
		},
	};
}

function mergeOwSnapshots(
	existing: OwDailySnapshot,
	incoming: OwDailySnapshot,
): OwDailySnapshot {
	// A missing key means this snapshot doesn't carry that value (e.g. a
	// sleep-only record). An explicit null means the body summary reported
	// no value, so clear the stale one instead of keeping it forever.
	const keep = <T>(
		next: T | null | undefined,
		previous: T | null | undefined,
	) => (next === undefined ? previous : next);
	return {
		sleep: incoming.sleep ?? existing.sleep,
		weightKg: keep(incoming.weightKg, existing.weightKg),
		bodyTemperatureC: keep(
			incoming.bodyTemperatureC,
			existing.bodyTemperatureC,
		),
		bodyTemperatureMeasuredAt: keep(
			incoming.bodyTemperatureMeasuredAt,
			existing.bodyTemperatureMeasuredAt,
		),
		dailyRestingHeartRateBpm: keep(
			incoming.dailyRestingHeartRateBpm,
			existing.dailyRestingHeartRateBpm,
		),
		dailyHrvSdnnMs: keep(incoming.dailyHrvSdnnMs, existing.dailyHrvSdnnMs),
		restingHeartRateBpm: keep(
			incoming.restingHeartRateBpm,
			existing.restingHeartRateBpm,
		),
		avgHrvSdnnMs: keep(incoming.avgHrvSdnnMs, existing.avgHrvSdnnMs),
	};
}

export interface OwDailyVitals {
	rhr: Map<string, number>;
	hrv: Map<string, number>;
}

/** Exported for tests; production callers go through `getRawHealthContext`. */
export function persistOwSnapshots(
	fitUserId: string,
	sleepSummaries: SleepRecord[],
	bodySummary: BodySummaryResponse | null,
	dailyVitals: OwDailyVitals | null = null,
): void {
	try {
		db.transaction(() => {
			for (const rec of sleepSummaries) {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) continue;
				upsertDailySnapshot<OwDailySnapshot>(
					fitUserId,
					OW_SOURCE,
					rec.date,
					sleepRecordToSnapshot(rec),
					mergeOwSnapshots,
				);
			}
			// Daily vitals belong to their own dates, unlike the body summary's
			// current-only averages.
			for (const [date, value] of dailyVitals?.rhr ?? []) {
				upsertDailySnapshot<OwDailySnapshot>(
					fitUserId,
					OW_SOURCE,
					date,
					{ dailyRestingHeartRateBpm: value },
					mergeOwSnapshots,
				);
			}
			for (const [date, value] of dailyVitals?.hrv ?? []) {
				upsertDailySnapshot<OwDailySnapshot>(
					fitUserId,
					OW_SOURCE,
					date,
					{ dailyHrvSdnnMs: value },
					mergeOwSnapshots,
				);
			}
			// Body summary is a current-only snapshot; ride its current values
			// on the most recent snapshot date so they carry an asOf.
			const averaged = bodySummary?.averaged;
			const bodyValues: OwDailySnapshot = {
				// An absent section leaves the persisted value alone; a present
				// section with null explicitly clears it.
				weightKg: bodySummary?.slow_changing
					? (bodySummary.slow_changing.weight_kg ?? null)
					: undefined,
				restingHeartRateBpm: averaged
					? (averaged.resting_heart_rate_bpm ?? null)
					: undefined,
				avgHrvSdnnMs: averaged ? (averaged.avg_hrv_sdnn_ms ?? null) : undefined,
			};
			if (bodySummary) {
				const snapshots = getDailySnapshots<OwDailySnapshot>(
					fitUserId,
					OW_SOURCE,
					"0000-01-01",
					"9999-12-31",
				);
				const latestDate =
					snapshots.length > 0
						? snapshots[snapshots.length - 1].date
						: new Date().toISOString().split("T")[0];
				const hasBodyValues = Object.values(bodyValues).some(
					(value) => value !== undefined,
				);
				if (hasBodyValues) {
					upsertDailySnapshot<OwDailySnapshot>(
						fitUserId,
						OW_SOURCE,
						latestDate,
						bodyValues,
						mergeOwSnapshots,
					);
				}

				// Temperature is a point-in-time reading, so keep it on the day
				// it was measured instead of borrowing a sleep date. That makes
				// the history chart honest and lets the fresh-window check use
				// the real timestamp.
				const temperature =
					bodySummary.latest?.body_temperature_celsius ?? null;
				const measuredAt =
					bodySummary.latest?.body_temperature_measured_at ?? null;
				if (temperature != null && temperature > 0) {
					const measuredDate = measuredAt?.slice(0, 10);
					const date =
						measuredDate && /^\d{4}-\d{2}-\d{2}$/.test(measuredDate)
							? measuredDate
							: latestDate;
					upsertDailySnapshot<OwDailySnapshot>(
						fitUserId,
						OW_SOURCE,
						date,
						{
							bodyTemperatureC: temperature,
							bodyTemperatureMeasuredAt: measuredAt,
						},
						mergeOwSnapshots,
					);
				}
			}
		})();
		db.prepare(
			"UPDATE user_settings SET ow_last_sync_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE user_id = ?",
		).run(fitUserId);
	} catch (err) {
		console.warn("[ow] failed to persist daily snapshots:", err);
	}
}

// ─── Context Building ────────────────────────────────────────────────────────

function determineMetric(
	rows: Array<{ value: number }>,
	round: (v: number) => number,
	metric: "rhr" | "hrv" | "respiratoryRate" | "spo2" | "temperature",
): HealthContext["rhr"] {
	if (rows.length === 0) return null;
	const latest = rows[0].value; // rows are date-desc → most recent first
	const avg = rows.reduce((a, b) => a + b.value, 0) / rows.length;
	return {
		current: round(latest),
		trend7d: round(avg),
		status: determineStatus(latest, avg, metric),
	};
}

/**
 * Effective RHR for a day. The daily `resting_heart_rate` series is the value
 * OpenWearables plots, so it wins; the body summary's 7-day average and the
 * per-night sleep average are fallbacks for days the series doesn't cover.
 */
function pickOwRhr(snap: OwDailySnapshot): number | null {
	const value =
		snap.dailyRestingHeartRateBpm ??
		snap.restingHeartRateBpm ??
		snap.sleep?.avgHeartRateBpm;
	return value != null && value > 0 ? value : null;
}

/** Effective HRV (SDNN) for a day, preferring the daily series. */
function pickOwHrv(snap: OwDailySnapshot): number | null {
	const value =
		snap.dailyHrvSdnnMs ?? snap.avgHrvSdnnMs ?? snap.sleep?.avgHrvSdnnMs;
	return value != null && value > 0 ? value : null;
}

type BodyMetricKey = "restingHeartRateBpm" | "avgHrvSdnnMs";
type DailyMetricKey = "dailyRestingHeartRateBpm" | "dailyHrvSdnnMs";

/**
 * The latest body-summary value for a metric. A sleep-only poll creates a new
 * snapshot without body fields; that must not discard the body-summary value
 * from an earlier snapshot in the window. A key that is present but null is
 * authoritative: it means OpenWearables explicitly reported no value, so we
 * stop and fall back to sleep data rather than resurrect an older reading.
 */
function latestBodyValue(
	rows: Array<{ snap: OwDailySnapshot }>,
	key: BodyMetricKey,
): number | null {
	for (const row of rows) {
		if (!Object.prototype.hasOwnProperty.call(row.snap, key)) continue;
		const value = row.snap[key] ?? null;
		return value != null && value > 0 ? value : null;
	}
	return null;
}

/**
 * The most recent daily value. Unlike the body summary, a null on a later day
 * does not invalidate an earlier reading — it only means that date has no
 * sample — so keep scanning for the newest one.
 */
function latestDailyValue(
	rows: Array<{ snap: OwDailySnapshot }>,
	key: DailyMetricKey,
): number | null {
	for (const row of rows) {
		const value = row.snap[key] ?? null;
		if (value != null && value > 0) return value;
	}
	return null;
}

/** Mean of the daily values available in the window. */
function meanDailyValue(
	rows: Array<{ snap: OwDailySnapshot }>,
	key: DailyMetricKey,
): number | null {
	const values = rows
		.map((row) => row.snap[key] ?? null)
		.filter((value): value is number => value != null && value > 0);
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Build an RHR-shaped metric from the daily series and the body summary.
 * `current` is the latest daily reading (the number OpenWearables plots);
 * `trend7d` is the body summary's 7-day average, falling back to the mean of
 * the daily readings. Sleep averages remain the fallback when neither exists.
 */
function resolveMetric(
	rows: Array<{ snap: OwDailySnapshot }>,
	dailyKey: DailyMetricKey,
	bodyKey: BodyMetricKey,
	sleepPick: (snap: OwDailySnapshot) => number | null,
	round: (v: number) => number,
	metric: "rhr" | "hrv",
): HealthContext["rhr"] {
	const sleepMetric = determineMetric(
		rows
			.map((r) => ({ value: sleepPick(r.snap) }))
			.filter((v): v is { value: number } => v.value != null && v.value > 0),
		round,
		metric,
	);

	const dailyValue = latestDailyValue(rows, dailyKey);
	const bodyValue = latestBodyValue(rows, bodyKey);
	const current = dailyValue ?? bodyValue;
	if (current == null) return sleepMetric;

	const trend = bodyValue ?? meanDailyValue(rows, dailyKey) ?? current;
	return {
		current: round(current),
		trend7d: round(trend),
		status: determineStatus(current, trend, metric),
	};
}

/** Exported for tests; production callers use `getRawHealthContext`. */
export function computeHealthContext(
	snapshots: Array<{ date: string; snap: OwDailySnapshot }>,
	nowMs = Date.now(),
): HealthContext {
	// getDailySnapshots returns date ASC; derivation wants newest first.
	const rows = recentDateWindow(
		snapshots.slice().sort((a, b) => b.date.localeCompare(a.date)),
		HEALTH_CONTEXT_DAYS,
	);

	let rhr: HealthContext["rhr"] = null;
	let hrv: HealthContext["hrv"] = null;
	let respiratoryRate: HealthContext["respiratoryRate"] = null;
	let spo2: HealthContext["spo2"] = null;
	let temperature: HealthContext["temperature"] = null;
	const morningHeartRate: HealthContext["morningHeartRate"] = null;
	let sleep: HealthContext["sleep"] = null;

	// Temperature is a point-in-time reading. OpenWearables withholds it once
	// it leaves the freshness window, so a persisted value must not outlive
	// that window and be shown as current.
	const latestTempRow = rows.find((r) => {
		const value = r.snap.bodyTemperatureC;
		if (value == null || value <= 0) return false;
		const measuredAt = r.snap.bodyTemperatureMeasuredAt;
		if (!measuredAt) return false;
		const measuredMs = Date.parse(measuredAt);
		return (
			Number.isFinite(measuredMs) &&
			Math.abs(nowMs - measuredMs) <= BODY_LATEST_WINDOW_MS
		);
	});
	if (latestTempRow) {
		const current = latestTempRow.snap.bodyTemperatureC as number;
		temperature = {
			current: Math.round(current * 10) / 10,
			trend7d: null,
			status: current > 37.5 ? "higher" : current < 36.0 ? "lower" : "normal",
		};
	}

	const nights = rows.filter(
		(
			r,
		): r is {
			date: string;
			snap: OwDailySnapshot & { sleep: NonNullable<OwDailySnapshot["sleep"]> };
		} => r.snap.sleep != null,
	);
	if (nights.length > 0) {
		const recentNights = nights.map((n) => {
			const s = n.snap.sleep;
			return {
				date: n.date,
				durationMinutes: s.durationMinutes,
				quality:
					s.efficiencyPercent != null
						? `${s.efficiencyPercent.toFixed(0)}% efficiency`
						: null,
				efficiencyPercent: s.efficiencyPercent,
				stages: s.stages,
			};
		});

		const durations = recentNights
			.map((n) => n.durationMinutes)
			.filter((d) => d > 0);
		const avgDurationMinutes7d =
			durations.length > 0
				? durations.reduce((a, b) => a + b, 0) / durations.length
				: null;

		const efficiencies = recentNights
			.map((n) => n.efficiencyPercent)
			.filter((e): e is number => e != null);
		const avgEfficiencyPercent7d =
			efficiencies.length > 0
				? Math.round(
						efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length,
					)
				: null;

		const nightsWithStages = recentNights.filter((n) => n.stages != null);
		let avgStages7d: SleepStages | null = null;
		if (nightsWithStages.length > 0) {
			const total = nightsWithStages.reduce(
				(acc, n) => {
					acc.awakeMinutes += n.stages?.awakeMinutes ?? 0;
					acc.lightMinutes += n.stages?.lightMinutes ?? 0;
					acc.deepMinutes += n.stages?.deepMinutes ?? 0;
					acc.remMinutes += n.stages?.remMinutes ?? 0;
					return acc;
				},
				{
					awakeMinutes: 0,
					lightMinutes: 0,
					deepMinutes: 0,
					remMinutes: 0,
				},
			);
			avgStages7d = {
				awakeMinutes: Math.round(total.awakeMinutes / nightsWithStages.length),
				lightMinutes: Math.round(total.lightMinutes / nightsWithStages.length),
				deepMinutes: Math.round(total.deepMinutes / nightsWithStages.length),
				remMinutes: Math.round(total.remMinutes / nightsWithStages.length),
			};
		}

		sleep = {
			recentNights,
			avgDurationMinutes7d,
			avgEfficiencyPercent7d,
			avgStages7d,
		};

		// Respiratory rate from sleep summaries
		respiratoryRate = determineMetric(
			nights
				.map((n) => ({ value: n.snap.sleep.avgRespiratoryRate }))
				.filter((v): v is { value: number } => v.value != null && v.value > 0),
			(v) => Math.round(v * 10) / 10,
			"respiratoryRate",
		);

		// SpO2 from sleep summaries
		spo2 = determineMetric(
			nights
				.map((n) => ({ value: n.snap.sleep.avgSpo2Percent }))
				.filter((v): v is { value: number } => v.value != null && v.value > 0),
			(v) => Math.round(v * 10) / 10,
			"spo2",
		);
	}

	// RHR and HRV read every row, not just sleep nights, because the daily
	// series and the body summary's averages can arrive without a sleep summary.
	rhr = resolveMetric(
		rows,
		"dailyRestingHeartRateBpm",
		"restingHeartRateBpm",
		(snap) => snap.sleep?.avgHeartRateBpm ?? null,
		Math.round,
		"rhr",
	);

	hrv = resolveMetric(
		rows,
		"dailyHrvSdnnMs",
		"avgHrvSdnnMs",
		(snap) => snap.sleep?.avgHrvSdnnMs ?? null,
		Math.round,
		"hrv",
	);

	// Body composition from persisted weight snapshots — most recent
	// non-null weight wins (same rule as HAE's pickLatestBodyComposition).
	let bodyComposition: HealthContext["bodyComposition"] = null;
	for (const row of rows) {
		const weightKg = row.snap.weightKg ?? null;
		if (weightKg != null && weightKg > 0) {
			bodyComposition = { weightKg, asOf: row.date };
			break;
		}
	}

	return {
		rhr,
		hrv,
		respiratoryRate,
		spo2,
		temperature,
		morningHeartRate,
		sleep,
		bodyComposition,
	};
}

async function resolveHealthContext(
	fitUserId: string,
): Promise<HealthContext | null> {
	if (!isConfigured()) return null;

	const owUserId = getOwUserId(fitUserId);
	if (!owUserId) return null;

	const cached = cache.get(owUserId);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.data;
	}
	console.log(`[ow] cache miss for user ${fitUserId} (OW ID: ${owUserId})`);

	try {
		const [sleepSummaries, bodySummary, dailyVitals] = await Promise.all([
			fetchSleepSummaries(owUserId),
			fetchBodySummary(owUserId),
			// The body summary and sleep nights are still useful when the
			// timeseries endpoint is unavailable, so degrade instead of failing.
			fetchDailyVitals(owUserId).catch((err) => {
				console.warn("[ow] daily vitals fetch failed:", err);
				return null;
			}),
		]);
		console.log(
			`[ow] fetched ${sleepSummaries?.length} sleep summaries, ${dailyVitals?.rhr.size ?? 0} daily RHR days, ${dailyVitals?.hrv.size ?? 0} daily HRV days for user ${fitUserId} (OW ID: ${owUserId})`,
		);
		if (
			(sleepSummaries?.length ?? 0) > 0 ||
			bodySummary ||
			(dailyVitals?.rhr.size ?? 0) > 0 ||
			(dailyVitals?.hrv.size ?? 0) > 0
		) {
			persistOwSnapshots(
				fitUserId,
				sleepSummaries ?? [],
				bodySummary,
				dailyVitals,
			);
			clearOwCaches(fitUserId);
		}
		if (bodySummary) {
			bodyCache.set(owUserId, { data: bodySummary, fetchedAt: Date.now() });
		}

		const ctx = buildContextFromHistory(fitUserId);
		if (ctx) {
			pruneCache();
			cache.set(owUserId, { data: ctx, fetchedAt: Date.now() });
		}
		return ctx;
	} catch (err) {
		console.warn("[ow] failed to fetch health context:", err);
		return null;
	}
}

function buildContextFromHistory(fitUserId: string): HealthContext | null {
	const { startDate, endDate } = getDateRange();
	const snapshots = getDailySnapshots<OwDailySnapshot>(
		fitUserId,
		OW_SOURCE,
		startDate,
		endDate,
	);
	if (snapshots.length === 0) return null;
	return computeHealthContext(snapshots);
}

export async function getRawHealthContext(
	fitUserId: string,
): Promise<HealthContext | null> {
	return resolveHealthContext(fitUserId);
}

async function resolveBodySummary(
	fitUserId: string,
): Promise<BodySummaryResponse | null> {
	if (!isConfigured()) return null;
	const owUserId = getOwUserId(fitUserId);
	if (!owUserId) return null;
	const cached = bodyCache.get(owUserId);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.data;
	}
	try {
		const body = await fetchBodySummary(owUserId);
		if (!body) return null;
		pruneCache();
		bodyCache.set(owUserId, { data: body, fetchedAt: Date.now() });
		return body;
	} catch (err) {
		console.warn("[ow] failed to fetch body summary:", err);
		return null;
	}
}

/** Exported for tests; production callers use `getOwBodySummary`. */
export function mapBodySummary(body: BodySummaryResponse): OwBodySummary {
	const bp = body.latest.blood_pressure;
	return {
		weightKg: body.slow_changing.weight_kg,
		heightCm: body.slow_changing.height_cm,
		bodyFatPercent: body.slow_changing.body_fat_percent,
		muscleMassKg: body.slow_changing.muscle_mass_kg,
		bmi: body.slow_changing.bmi,
		age: body.slow_changing.age,
		bloodPressure:
			bp?.avg_systolic_mmhg != null && bp.avg_diastolic_mmhg != null
				? {
						systolic: bp.avg_systolic_mmhg,
						diastolic: bp.avg_diastolic_mmhg,
					}
				: null,
		source: body.source,
	};
}

export async function getOwBodySummary(
	fitUserId: string,
): Promise<OwBodySummary | null> {
	const body = await resolveBodySummary(fitUserId);
	if (!body) return null;
	return mapBodySummary(body);
}

export function getOwLastSync(fitUserId: string): string | null {
	// Fast path: check the dedicated user_settings column
	const userRow = db
		.prepare("SELECT ow_last_sync_at FROM user_settings WHERE user_id = ?")
		.get(fitUserId) as { ow_last_sync_at: string | null } | undefined;
	if (userRow?.ow_last_sync_at) return userRow.ow_last_sync_at;

	// Fallback: inspect the history table
	return getLastHistoryUpdate(fitUserId, OW_SOURCE);
}

export function getOwHistory(
	fitUserId: string,
	startDate: string,
	endDate: string,
): HealthHistoryEntry[] {
	const snapshots = getDailySnapshots<OwDailySnapshot>(
		fitUserId,
		OW_SOURCE,
		startDate,
		endDate,
	);
	return snapshots.map(({ date, snap }) => {
		const rhr = pickOwRhr(snap);
		const hrv = pickOwHrv(snap);
		return {
			date,
			rhr: rhr != null ? Math.round(rhr) : null,
			hrv: hrv != null ? Math.round(hrv) : null,
			respiratoryRate:
				snap.sleep?.avgRespiratoryRate != null
					? Math.round(snap.sleep.avgRespiratoryRate * 10) / 10
					: null,
			spo2:
				snap.sleep?.avgSpo2Percent != null
					? Math.round(snap.sleep.avgSpo2Percent * 10) / 10
					: null,
			temperature:
				snap.bodyTemperatureC != null && snap.bodyTemperatureC > 0
					? Math.round(snap.bodyTemperatureC * 10) / 10
					: null,
			morningHeartRate: null,
			sleepDurationMinutes: snap.sleep?.durationMinutes ?? null,
			sleepEfficiencyPercent: snap.sleep?.efficiencyPercent ?? null,
			deepMinutes: snap.sleep?.stages?.deepMinutes ?? null,
			remMinutes: snap.sleep?.stages?.remMinutes ?? null,
		};
	});
}

export function clearOwCaches(fitUserId: string): void {
	const owUserId = getOwUserId(fitUserId);
	if (!owUserId) return;
	cache.delete(owUserId);
	bodyCache.delete(owUserId);
}

export { getOwUserId };

function getLastHistoryUpdate(
	fitUserId: string,
	source: HealthHistorySource,
): string | null {
	const rows = getDailySnapshots<unknown>(
		fitUserId,
		source,
		"0000-01-01",
		"9999-12-31",
	);
	if (rows.length === 0) return null;
	return rows[rows.length - 1].updatedAt;
}
