import { db } from "../db.js";
import { env } from "../env.js";
import type { HealthMetricStatus } from "@fit-analyzer/shared";

export interface SleepStages {
	awakeMinutes: number;
	lightMinutes: number;
	deepMinutes: number;
	remMinutes: number;
}

export interface RecentNight {
	date: string;
	durationMinutes: number;
	quality: string | null;
	efficiencyPercent: number | null;
	stages: SleepStages | null;
}

export interface HealthContext {
	rhr: {
		current: number | null;
		trend7d: number | null;
		status: HealthMetricStatus;
	} | null;
	hrv: {
		current: number | null;
		trend7d: number | null;
		status: HealthMetricStatus;
	} | null;
	respiratoryRate: {
		current: number | null;
		trend7d: number | null;
		status: HealthMetricStatus;
	} | null;
	spo2: {
		current: number | null;
		trend7d: number | null;
		status: HealthMetricStatus;
	} | null;
	temperature: {
		current: number | null;
		trend7d: number | null;
		status: HealthMetricStatus;
	} | null;
	morningHeartRate: {
		current: number | null;
		trend7d: number | null;
		status: HealthMetricStatus;
	} | null;
	sleep: {
		recentNights: RecentNight[];
		avgDurationMinutes7d: number | null;
		avgEfficiencyPercent7d: number | null;
		avgStages7d: SleepStages | null;
	} | null;
	bodyComposition: {
		weightKg: number | null;
		asOf: string | null;
	} | null;
}

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

function computeHealthContext(
	sleepSummaries: SleepRecord[] | null,
	bodySummary: BodySummaryResponse | null,
): HealthContext {
	let rhr: HealthContext["rhr"] = null;
	let hrv: HealthContext["hrv"] = null;
	let respiratoryRate: HealthContext["respiratoryRate"] = null;
	let spo2: HealthContext["spo2"] = null;
	let temperature: HealthContext["temperature"] = null;
	const morningHeartRate: HealthContext["morningHeartRate"] = null;
	let sleep: HealthContext["sleep"] = null;

	if (sleepSummaries && sleepSummaries.length > 0) {
		const recentNights: RecentNight[] = sleepSummaries
			.map((n) => {
				const stages: SleepStages | null = n.stages
					? {
							awakeMinutes: n.stages.awake_minutes ?? 0,
							lightMinutes: n.stages.light_minutes ?? 0,
							deepMinutes: n.stages.deep_minutes ?? 0,
							remMinutes: n.stages.rem_minutes ?? 0,
						}
					: null;
				return {
					date: n.date,
					durationMinutes: n.duration_minutes,
					quality:
						n.efficiency_percent != null
							? `${n.efficiency_percent.toFixed(0)}% efficiency`
							: null,
					efficiencyPercent: n.efficiency_percent ?? null,
					stages,
				};
			})
			.sort((a, b) => b.date.localeCompare(a.date));

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
		const datedHrValues = sleepSummaries
			.map((n) => ({
				date: n.date,
				value: n.avg_heart_rate_bpm,
			}))
			.filter(
				(v): v is { date: string; value: number } =>
					typeof v.value === "number" && v.value > 0,
			)
			.sort((a, b) => b.date.localeCompare(a.date));
		if (datedHrValues.length > 0) {
			const latest = datedHrValues[0].value;
			const avg =
				datedHrValues.reduce((a, b) => a + b.value, 0) / datedHrValues.length;
			rhr = {
				current: Math.round(latest),
				trend7d: Math.round(avg),
				status: determineStatus(latest, avg, "rhr"),
			};
		}

		// HRV from sleep summaries
		const datedHrvValues = sleepSummaries
			.map((n) => ({
				date: n.date,
				value: n.avg_hrv_sdnn_ms,
			}))
			.filter(
				(v): v is { date: string; value: number } =>
					typeof v.value === "number" && v.value > 0,
			)
			.sort((a, b) => b.date.localeCompare(a.date));
		if (datedHrvValues.length > 0) {
			const latest = datedHrvValues[0].value;
			const avg =
				datedHrvValues.reduce((a, b) => a + b.value, 0) / datedHrvValues.length;
			hrv = {
				current: Math.round(latest),
				trend7d: Math.round(avg),
				status: determineStatus(latest, avg, "hrv"),
			};
		}

		// Respiratory rate from sleep summaries
		const datedRrValues = sleepSummaries
			.map((n) => ({
				date: n.date,
				value: n.avg_respiratory_rate,
			}))
			.filter(
				(v): v is { date: string; value: number } =>
					typeof v.value === "number" && v.value > 0,
			)
			.sort((a, b) => b.date.localeCompare(a.date));
		if (datedRrValues.length > 0) {
			const latest = datedRrValues[0].value;
			const avg =
				datedRrValues.reduce((a, b) => a + b.value, 0) / datedRrValues.length;
			respiratoryRate = {
				current: Math.round(latest * 10) / 10,
				trend7d: Math.round(avg * 10) / 10,
				status: determineStatus(latest, avg, "respiratoryRate"),
			};
		}

		// SpO2 from sleep summaries
		const datedSpo2Values = sleepSummaries
			.map((n) => ({
				date: n.date,
				value: n.avg_spo2_percent,
			}))
			.filter(
				(v): v is { date: string; value: number } =>
					typeof v.value === "number" && v.value > 0,
			)
			.sort((a, b) => b.date.localeCompare(a.date));
		if (datedSpo2Values.length > 0) {
			const latest = datedSpo2Values[0].value;
			const avg =
				datedSpo2Values.reduce((a, b) => a + b.value, 0) /
				datedSpo2Values.length;
			spo2 = {
				current: Math.round(latest * 10) / 10,
				trend7d: Math.round(avg * 10) / 10,
				status: determineStatus(latest, avg, "spo2"),
			};
		}
	}

	// Temperature from body summary
	if (bodySummary?.latest?.body_temperature_celsius != null) {
		const current = bodySummary.latest.body_temperature_celsius;
		temperature = {
			current: Math.round(current * 10) / 10,
			trend7d: null,
			status: current > 37.5 ? "higher" : current < 36.0 ? "lower" : "normal",
		};
	}

	// Override RHR/HRV from body summary if available (more accurate 7-day average)
	if (bodySummary?.averaged?.resting_heart_rate_bpm != null) {
		const current = bodySummary.averaged.resting_heart_rate_bpm;
		const trend7d = current; // body summary already gives 7-day average
		rhr = {
			current: Math.round(current),
			trend7d: Math.round(trend7d),
			status: rhr?.status ?? "normal",
		};
	}

	if (bodySummary?.averaged?.avg_hrv_sdnn_ms != null) {
		const current = bodySummary.averaged.avg_hrv_sdnn_ms;
		hrv = {
			current: Math.round(current),
			trend7d: Math.round(current),
			status: hrv?.status ?? "normal",
		};
	}

	return {
		rhr,
		hrv,
		respiratoryRate,
		spo2,
		temperature,
		morningHeartRate,
		sleep,
		bodyComposition: null,
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
		const ctx = computeHealthContext(sleepSummaries, bodySummary);
		pruneCache();
		cache.set(owUserId, { data: ctx, fetchedAt: Date.now() });
		if (bodySummary) {
			bodyCache.set(owUserId, { data: bodySummary, fetchedAt: Date.now() });
		}
		return ctx;
	} catch (err) {
		console.warn("[ow] failed to fetch health context:", err);
		return null;
	}
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

export function clearOwCaches(fitUserId: string): void {
	const owUserId = getOwUserId(fitUserId);
	if (!owUserId) return;
	cache.delete(owUserId);
	bodyCache.delete(owUserId);
}

export { getOwUserId };
