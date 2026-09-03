import { db } from "../db.js";
import { env } from "../env.js";
import type {
	HealthContext,
	HealthHistoryEntry,
	HealthMetricStatus,
	SleepStages,
} from "@fit-analyzer/shared";
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
 * Sleep summaries carry the vitals; the body summary rides on the most
 * recent snapshot date.
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
}

interface SleepRecord {
	date: string;
	duration_minutes: number;
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
		blood_pressure: { systolic: number; diastolic: number } | null;
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

function getDateRange(): { startDate: string; endDate: string } {
	const end = new Date();
	const start = new Date();
	start.setDate(start.getDate() - 7);
	end.setDate(end.getDate() + 1); // include today

	const fmt = (d: Date) => d.toISOString().split("T")[0];
	return { startDate: fmt(start), endDate: fmt(end) };
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
		limit: "8",
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

async function fetchBodySummary(
	owUserId: string,
): Promise<BodySummaryResponse | null> {
	const apiKey = env.OW_API_KEY;
	if (!apiKey) throw new Error("OW_API_KEY not configured");
	const res = await fetch(
		`${env.OW_BASE_URL}/api/v1/users/${encodeURIComponent(owUserId)}/summaries/body`,
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
			durationMinutes: rec.duration_minutes,
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
	return {
		sleep: incoming.sleep ?? existing.sleep,
		weightKg: incoming.weightKg ?? existing.weightKg,
		bodyTemperatureC: incoming.bodyTemperatureC ?? existing.bodyTemperatureC,
	};
}

function persistOwSnapshots(
	fitUserId: string,
	sleepSummaries: SleepRecord[],
	bodySummary: BodySummaryResponse | null,
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
			// Body summary is a current-only snapshot; ride weight + body
			// temperature on the most recent night's date so they carry an asOf.
			if (
				bodySummary?.slow_changing?.weight_kg != null ||
				bodySummary?.latest?.body_temperature_celsius != null
			) {
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
				upsertDailySnapshot<OwDailySnapshot>(
					fitUserId,
					OW_SOURCE,
					latestDate,
					{
						weightKg: bodySummary.slow_changing?.weight_kg ?? null,
						bodyTemperatureC:
							bodySummary.latest?.body_temperature_celsius ?? null,
					},
					mergeOwSnapshots,
				);
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

function computeHealthContext(
	snapshots: Array<{ date: string; snap: OwDailySnapshot }>,
): HealthContext {
	// getDailySnapshots returns date ASC; derivation wants newest first.
	const rows = snapshots.slice().sort((a, b) => b.date.localeCompare(a.date));

	let rhr: HealthContext["rhr"] = null;
	let hrv: HealthContext["hrv"] = null;
	let respiratoryRate: HealthContext["respiratoryRate"] = null;
	let spo2: HealthContext["spo2"] = null;
	let temperature: HealthContext["temperature"] = null;
	const morningHeartRate: HealthContext["morningHeartRate"] = null;
	let sleep: HealthContext["sleep"] = null;

	// Temperature from the most recent persisted body temperature
	const latestTempRow = rows.find(
		(r) => r.snap.bodyTemperatureC != null && r.snap.bodyTemperatureC > 0,
	);
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

		// RHR from sleep summaries (per-night avg HR during sleep)
		rhr = determineMetric(
			nights
				.map((n) => ({ value: n.snap.sleep.avgHeartRateBpm }))
				.filter((v): v is { value: number } => v.value != null && v.value > 0),
			Math.round,
			"rhr",
		);

		// HRV from sleep summaries
		hrv = determineMetric(
			nights
				.map((n) => ({ value: n.snap.sleep.avgHrvSdnnMs }))
				.filter((v): v is { value: number } => v.value != null && v.value > 0),
			Math.round,
			"hrv",
		);

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
		const [sleepSummaries, bodySummary] = await Promise.all([
			fetchSleepSummaries(owUserId),
			fetchBodySummary(owUserId),
		]);
		console.log(
			`[ow] fetched ${sleepSummaries?.length} sleep summaries for user ${fitUserId} (OW ID: ${owUserId})`,
		);
		if (sleepSummaries && sleepSummaries.length > 0) {
			persistOwSnapshots(fitUserId, sleepSummaries, bodySummary);
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

export async function getOwBodySummary(
	fitUserId: string,
): Promise<OwBodySummary | null> {
	const body = await resolveBodySummary(fitUserId);
	if (!body) return null;
	return {
		weightKg: body.slow_changing.weight_kg,
		heightCm: body.slow_changing.height_cm,
		bodyFatPercent: body.slow_changing.body_fat_percent,
		muscleMassKg: body.slow_changing.muscle_mass_kg,
		bmi: body.slow_changing.bmi,
		age: body.slow_changing.age,
		bloodPressure: body.latest.blood_pressure,
		source: body.source,
	};
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
	return snapshots.map(({ date, snap }) => ({
		date,
		rhr:
			snap.sleep?.avgHeartRateBpm != null
				? Math.round(snap.sleep.avgHeartRateBpm)
				: null,
		hrv:
			snap.sleep?.avgHrvSdnnMs != null
				? Math.round(snap.sleep.avgHrvSdnnMs)
				: null,
		respiratoryRate:
			snap.sleep?.avgRespiratoryRate != null
				? Math.round(snap.sleep.avgRespiratoryRate * 10) / 10
				: null,
		spo2:
			snap.sleep?.avgSpo2Percent != null
				? Math.round(snap.sleep.avgSpo2Percent * 10) / 10
				: null,
		temperature: null,
		morningHeartRate: null,
		sleepDurationMinutes: snap.sleep?.durationMinutes ?? null,
		sleepEfficiencyPercent: snap.sleep?.efficiencyPercent ?? null,
		deepMinutes: snap.sleep?.stages?.deepMinutes ?? null,
		remMinutes: snap.sleep?.stages?.remMinutes ?? null,
	}));
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
