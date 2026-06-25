import { db } from "../db.js";
import type {
	HealthContext,
	HealthMetricStatus,
	HealthHistoryEntry,
} from "@fit-analyzer/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HaeQuantityData {
	date: string;
	qty?: number;
	avg?: number;
	min?: number;
	max?: number;
	units?: string;
	source?: string;
}

interface HaeHeartRateData extends HaeQuantityData {
	Min?: number;
	Avg?: number;
	Max?: number;
}

interface HaeSleepEntry {
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

interface HaeMetric {
	name: string;
	units?: string;
	data: Array<HaeQuantityData | HaeHeartRateData | HaeSleepEntry>;
}

interface HaePayload {
	metrics?: HaeMetric[];
}

// ─── Daily Snapshot Shape (stored in DB) ─────────────────────────────────────

interface HaeSleepData {
	durationMinutes: number;
	efficiencyPercent: number | null;
	stages: {
		awakeMinutes: number;
		lightMinutes: number;
		deepMinutes: number;
		remMinutes: number;
	} | null;
	sleepStart: string | null;
	sleepEnd: string | null;
}

interface HaeHeartRateReading {
	date: string;
	avg: number;
	min: number;
	max: number;
}

interface HaeBloodPressureEntry {
	date: string;
	systolic: number;
	diastolic: number;
}

interface HaeBodyComposition {
	heightCm: number | null;
	weightKg: number | null;
	bodyFatPercent: number | null;
	leanBodyMassKg: number | null;
	bmi: number | null;
	waistCircumferenceCm: number | null;
}

interface HaeDailySnapshot {
	rhr: number | null;
	hrv: number | null;
	respiratoryRate: number | null;
	spo2: number | null;
	temperature: number | null;
	sleep: HaeSleepData | null;
	heartRateReadings: HaeHeartRateReading[];
	bloodPressure: HaeBloodPressureEntry | null;
	bodyComposition: HaeBodyComposition;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
	data: HealthContext;
	fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function pruneCache() {
	const now = Date.now();
	for (const [key, entry] of cache) {
		if (now - entry.fetchedAt >= CACHE_TTL_MS) {
			cache.delete(key);
		}
	}
}

// ─── DB Statements ────────────────────────────────────────────────────────────

const getExistingDataStmt = db.prepare(
	"SELECT data FROM hae_health_history WHERE user_id = ? AND date = ?",
);

function mergeHeartRateReadings(
	existing: HaeHeartRateReading[],
	incoming: HaeHeartRateReading[],
): HaeHeartRateReading[] {
	if (existing.length === 0) return incoming;
	if (incoming.length === 0) return existing;
	const byDate = new Map<string, HaeHeartRateReading>();
	for (const r of existing) byDate.set(r.date, r);
	for (const r of incoming) byDate.set(r.date, r);
	return Array.from(byDate.values()).sort(
		(a, b) =>
			parseHaeDateTime(a.date).getTime() - parseHaeDateTime(b.date).getTime(),
	);
}

function mergeBodyComposition(
	existing: HaeBodyComposition,
	incoming: HaeBodyComposition,
): HaeBodyComposition {
	return {
		heightCm: incoming.heightCm ?? existing.heightCm,
		weightKg: incoming.weightKg ?? existing.weightKg,
		bodyFatPercent: incoming.bodyFatPercent ?? existing.bodyFatPercent,
		leanBodyMassKg: incoming.leanBodyMassKg ?? existing.leanBodyMassKg,
		bmi: incoming.bmi ?? existing.bmi,
		waistCircumferenceCm:
			incoming.waistCircumferenceCm ?? existing.waistCircumferenceCm,
	};
}

function mergeSnapshots(
	existing: HaeDailySnapshot,
	incoming: HaeDailySnapshot,
): HaeDailySnapshot {
	return {
		rhr: incoming.rhr ?? existing.rhr,
		hrv: incoming.hrv ?? existing.hrv,
		respiratoryRate: incoming.respiratoryRate ?? existing.respiratoryRate,
		spo2: incoming.spo2 ?? existing.spo2,
		temperature: incoming.temperature ?? existing.temperature,
		sleep: incoming.sleep ?? existing.sleep,
		heartRateReadings: mergeHeartRateReadings(
			existing.heartRateReadings,
			incoming.heartRateReadings,
		),
		bloodPressure: incoming.bloodPressure ?? existing.bloodPressure,
		bodyComposition: mergeBodyComposition(
			existing.bodyComposition,
			incoming.bodyComposition,
		),
	};
}

const upsertHistoryStmt = db.prepare(
	`INSERT INTO hae_health_history (user_id, date, data, updated_at)
   VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
   ON CONFLICT(user_id, date) DO UPDATE SET
     data = excluded.data,
     updated_at = excluded.updated_at`,
);

const getHistoryStmt = db.prepare<
	{ user_id: string; date: string; data: string; updated_at: string },
	[string, string, string]
>(
	`SELECT user_id, date, data, updated_at FROM hae_health_history
   WHERE user_id = ? AND date >= ? AND date <= ?
   ORDER BY date ASC`,
);

const getLastSyncStmt = db.prepare<{ updated_at: string }, [string]>(
	`SELECT updated_at FROM hae_health_history
   WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
);

const getTokenStmt = db.prepare<{ hae_api_token: string | null }, [string]>(
	"SELECT hae_api_token FROM user_settings WHERE user_id = ?",
);

const getUserByTokenStmt = db.prepare<{ user_id: string }, [string]>(
	"SELECT user_id FROM user_settings WHERE hae_api_token = ?",
);

// ─── Metric Parsing ───────────────────────────────────────────────────────────

function parseHaeDate(dateStr: string): string {
	// HAE dates are like "2024-02-06 14:30:00 -0800" or "2024-02-06"
	return dateStr.split(" ")[0].slice(0, 10);
}

function extractQty(
	data: Array<HaeQuantityData | HaeHeartRateData | HaeSleepEntry>,
): number | null {
	const entry = data[0] as HaeQuantityData;
	if (entry?.qty != null && typeof entry.qty === "number") {
		return entry.qty;
	}
	return null;
}

function parseHaeDateTime(dateStr: string): Date {
	// HAE dates are like "2024-02-06 14:30:00 -0800" or "2024-02-06"
	return new Date(dateStr);
}

function ensureBodyComposition(
	snap: Partial<HaeDailySnapshot> & {
		heartRateReadings: HaeHeartRateReading[];
	},
): HaeBodyComposition {
	if (!snap.bodyComposition) {
		snap.bodyComposition = {
			heightCm: null,
			weightKg: null,
			bodyFatPercent: null,
			leanBodyMassKg: null,
			bmi: null,
			waistCircumferenceCm: null,
		};
	}
	return snap.bodyComposition;
}

function convertWeightToKg(qty: number, units: string | undefined): number {
	if (units === "lb") return qty * 0.45359237;
	if (units === "g") return qty / 1000;
	return qty; // assume kg
}

function convertHeightToCm(qty: number, units: string | undefined): number {
	if (units === "in") return qty * 2.54;
	if (units === "m") return qty * 100;
	if (units === "ft") return qty * 30.48;
	return qty; // assume cm
}

function parseMetrics(metrics: HaeMetric[]): Map<string, HaeDailySnapshot> {
	const byDate = new Map<
		string,
		Partial<HaeDailySnapshot> & { heartRateReadings: HaeHeartRateReading[] }
	>();

	function ensureDate(
		date: string,
	): Partial<HaeDailySnapshot> & { heartRateReadings: HaeHeartRateReading[] } {
		let snap = byDate.get(date);
		if (!snap) {
			snap = { heartRateReadings: [] };
			byDate.set(date, snap);
		}
		return snap;
	}

	const unrecognized = new Set<string>();

	for (const metric of metrics) {
		for (const raw of metric.data) {
			const date = parseHaeDate(raw.date);
			const snap = ensureDate(date);

			switch (metric.name) {
				case "resting_heart_rate":
				case "restingHeartRate":
				case "RestingHeartRate":
				case "resting_hr":
				case "RHR": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") snap.rhr = qty;
					break;
				}
				case "heart_rate_variability_sdnn":
				case "heart_rate_variability": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") snap.hrv = qty;
					break;
				}
				case "respiratory_rate": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") snap.respiratoryRate = qty;
					break;
				}
				case "blood_oxygen_saturation": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						// HAE may export as 0.98 (fraction) or 98 (percent)
						snap.spo2 = qty <= 1.0 ? Math.round(qty * 100) : qty;
					}
					break;
				}
				case "body_temperature":
				case "bodyTemperature":
				case "BodyTemperature":
				case "wrist_temperature":
				case "wristTemperature":
				case "WristTemperature":
				case "basal_body_temperature":
				case "basalBodyTemperature":
				case "BasalBodyTemperature":
				case "skin_temperature":
				case "skinTemperature":
				case "SkinTemperature": {
					// With aggregation ON, HAE sends avg/min/max instead of qty.
					const d = raw as HaeQuantityData;
					const qty = d.qty ?? d.avg ?? d.min ?? d.max;
					if (typeof qty === "number") {
						// HAE may export in degF or degC; units can live on the metric
						// or on each individual data record.
						const units = metric.units ?? d.units;
						snap.temperature =
							units === "degF" || units === "°F" || units === "F"
								? (qty - 32) * (5 / 9)
								: qty;
						console.log(
							`[hae] Parsed temperature for ${date}: ${snap.temperature}°C (raw: ${qty}, units: ${units}, metric: ${metric.name})`,
						);
					}
					break;
				}
				case "weight_body_mass": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						const body = ensureBodyComposition(snap);
						body.weightKg = convertWeightToKg(qty, metric.units);
					}
					break;
				}
				case "height": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						const body = ensureBodyComposition(snap);
						body.heightCm = convertHeightToCm(qty, metric.units);
					}
					break;
				}
				case "body_fat_percentage": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						const body = ensureBodyComposition(snap);
						// HAE may export as 0..1 fraction or 0..100 percent
						body.bodyFatPercent = qty <= 1 ? qty * 100 : qty;
					}
					break;
				}
				case "lean_body_mass": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						const body = ensureBodyComposition(snap);
						body.leanBodyMassKg = convertWeightToKg(qty, metric.units);
					}
					break;
				}
				case "body_mass_index": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						const body = ensureBodyComposition(snap);
						body.bmi = qty;
					}
					break;
				}
				case "waist_circumference": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						const body = ensureBodyComposition(snap);
						body.waistCircumferenceCm = convertHeightToCm(qty, metric.units);
					}
					break;
				}
				case "blood_pressure": {
					const entry = raw as HaeHeartRateData;
					if (
						typeof (
							entry as HaeHeartRateData & {
								systolic?: number;
								diastolic?: number;
							}
						).systolic === "number" &&
						typeof (
							entry as HaeHeartRateData & {
								systolic?: number;
								diastolic?: number;
							}
						).diastolic === "number"
					) {
						snap.bloodPressure = {
							date: entry.date,
							systolic: (entry as unknown as { systolic: number }).systolic,
							diastolic: (entry as unknown as { diastolic: number }).diastolic,
						};
					}
					break;
				}
				case "heart_rate": {
					const entry = raw as HaeHeartRateData;
					if (typeof entry.Avg === "number" && entry.Avg > 0) {
						snap.heartRateReadings.push({
							date: entry.date,
							avg: entry.Avg,
							min: entry.Min ?? entry.Avg,
							max: entry.Max ?? entry.Avg,
						});
					}
					break;
				}
				case "sleep_analysis": {
					const entry = raw as HaeSleepEntry;
					// HAE exports the total sleep value under the generic `qty` field
					// when no dedicated `totalSleep`/`asleep` keys are present.
					const totalHours =
						entry.totalSleep ?? entry.asleep ?? entry.qty ?? null;
					if (totalHours != null && totalHours > 0) {
						const durationMinutes = Math.round(totalHours * 60);

						// Compute efficiency if possible
						let efficiencyPercent: number | null = null;
						if (entry.inBed != null && entry.inBed > 0 && totalHours > 0) {
							efficiencyPercent = Math.round((totalHours / entry.inBed) * 100);
						}

						let stages: HaeSleepData["stages"] = null;
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

						snap.sleep = {
							durationMinutes,
							efficiencyPercent,
							stages,
							sleepStart: entry.sleepStart ?? null,
							sleepEnd: entry.sleepEnd ?? null,
						};
					}
					break;
				}
				default:
					unrecognized.add(metric.name);
			}
		}
	}

	if (unrecognized.size > 0) {
		console.warn(
			`[hae] Unrecognized metric names (no parser): ${Array.from(unrecognized).join(", ")}`,
		);
	}

	// Normalize: ensure every date has all fields
	const result = new Map<string, HaeDailySnapshot>();
	for (const [date, snap] of byDate) {
		// Sort heart rate readings chronologically
		snap.heartRateReadings.sort(
			(a, b) =>
				parseHaeDateTime(a.date).getTime() - parseHaeDateTime(b.date).getTime(),
		);
		const body = snap.bodyComposition ?? {
			heightCm: null,
			weightKg: null,
			bodyFatPercent: null,
			leanBodyMassKg: null,
			bmi: null,
			waistCircumferenceCm: null,
		};
		result.set(date, {
			rhr: snap.rhr ?? null,
			hrv: snap.hrv ?? null,
			respiratoryRate: snap.respiratoryRate ?? null,
			spo2: snap.spo2 ?? null,
			temperature: snap.temperature ?? null,
			sleep: snap.sleep ?? null,
			heartRateReadings: snap.heartRateReadings,
			bloodPressure: snap.bloodPressure ?? null,
			bodyComposition: body,
		});
	}
	return result;
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

const updateLastSyncStmt = db.prepare(
	`UPDATE user_settings SET hae_last_sync_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE user_id = ?`,
);

export function ingestHaePayload(
	userId: string,
	payload: HaePayload,
): { received: number; dates: string[] } {
	const metrics = payload.metrics ?? [];
	if (metrics.length === 0) return { received: 0, dates: [] };

	const byDate = parseMetrics(metrics);

	db.transaction(() => {
		for (const [date, snapshot] of byDate) {
			// Fetch existing data for this date so we can merge instead of
			// overwrite (HAE sends partial updates per metric).
			const existingRow = getExistingDataStmt.get(userId, date) as
				| { data: string }
				| undefined;
			let final = snapshot;
			if (existingRow) {
				try {
					const existing = JSON.parse(existingRow.data) as HaeDailySnapshot;
					final = mergeSnapshots(existing, snapshot);
				} catch {
					/* ignore parse errors, fall back to incoming snapshot */
				}
			}
			upsertHistoryStmt.run(userId, date, JSON.stringify(final));
		}
		// Track successful webhook delivery on the user row
		updateLastSyncStmt.run(userId);
	})();

	return {
		received: metrics.length,
		dates: Array.from(byDate.keys()).sort(),
	};
}

// ─── Authentication ───────────────────────────────────────────────────────────

export function getUserIdByHaeToken(token: string): string | null {
	const row = getUserByTokenStmt.get(token);
	return row?.user_id ?? null;
}

export function hasHaeToken(userId: string): boolean {
	const row = getTokenStmt.get(userId);
	return !!row?.hae_api_token;
}

// ─── Health Context Building ─────────────────────────────────────────────────

/** Window after sleep end during which we look for the morning RHR reading. */
const MORNING_HR_WINDOW_MS = 30 * 60 * 1000;

function computeMorningHeartRateByDate(
	rows: Array<{ date: string } & HaeDailySnapshot>,
): Map<string, number> {
	const result = new Map<string, number>();
	for (const row of rows) {
		if (!row.heartRateReadings?.length) continue;
		const sleepEndStr = row.sleep?.sleepEnd;
		if (!sleepEndStr) continue;
		const sleepEnd = parseHaeDateTime(sleepEndStr).getTime();
		if (Number.isNaN(sleepEnd)) continue;
		let lowest: number | null = null;
		for (const hr of row.heartRateReadings) {
			const t = parseHaeDateTime(hr.date).getTime();
			if (Number.isNaN(t)) continue;
			if (t < sleepEnd || t > sleepEnd + MORNING_HR_WINDOW_MS) continue;
			if (lowest == null || hr.avg < lowest) lowest = hr.avg;
		}
		if (lowest != null) result.set(row.date, lowest);
	}
	return result;
}

/**
 * Resolve the sleep window start. HAE often omits `sleepStart`; fall back to
 * `sleepEnd - durationMinutes` so we can still bound the sleep window.
 */
function resolveSleepStart(snap: HaeDailySnapshot): number | null {
	const sleepStartStr = snap.sleep?.sleepStart;
	if (sleepStartStr) {
		const t = parseHaeDateTime(sleepStartStr).getTime();
		if (!Number.isNaN(t)) return t;
	}
	const sleepEndStr = snap.sleep?.sleepEnd;
	const durationMin = snap.sleep?.durationMinutes;
	if (sleepEndStr && durationMin && durationMin > 0) {
		const end = parseHaeDateTime(sleepEndStr).getTime();
		if (!Number.isNaN(end)) return end - durationMin * 60 * 1000;
	}
	return null;
}

/**
 * Compute the average HR during sleep for each dated snapshot (Bevel-style RHR).
 * Uses heart_rate readings that fall within [sleepStart, sleepEnd].
 */
function computeSleepAverageHrByDate(
	rows: Array<{ date: string } & HaeDailySnapshot>,
): Map<string, number> {
	const result = new Map<string, number>();
	for (const row of rows) {
		if (!row.heartRateReadings?.length) continue;
		const sleepEndStr = row.sleep?.sleepEnd;
		if (!sleepEndStr) continue;
		const sleepEnd = parseHaeDateTime(sleepEndStr).getTime();
		if (Number.isNaN(sleepEnd)) continue;
		const sleepStart = resolveSleepStart(row);
		if (sleepStart == null) continue;

		const inSleep: number[] = [];
		for (const hr of row.heartRateReadings) {
			const t = parseHaeDateTime(hr.date).getTime();
			if (Number.isNaN(t)) continue;
			if (t < sleepStart || t > sleepEnd) continue;
			if (typeof hr.avg === "number" && hr.avg > 0) inSleep.push(hr.avg);
		}
		if (inSleep.length > 0) {
			result.set(row.date, inSleep.reduce((a, b) => a + b, 0) / inSleep.length);
		}
	}
	return result;
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

function computeHaeHealthContext(
	history: Array<{ date: string; data: string }>,
): HealthContext {
	// Parse all rows
	const rows = history.map((row) => ({
		date: row.date,
		...JSON.parse(row.data),
	})) as Array<{ date: string } & HaeDailySnapshot>;

	// Sort newest first
	rows.sort((a, b) => b.date.localeCompare(a.date));

	let rhr: HealthContext["rhr"] = null;
	let hrv: HealthContext["hrv"] = null;
	let respiratoryRate: HealthContext["respiratoryRate"] = null;
	let spo2: HealthContext["spo2"] = null;
	let temperature: HealthContext["temperature"] = null;
	let morningHeartRate: HealthContext["morningHeartRate"] = null;
	let sleep: HealthContext["sleep"] = null;

	// ── Sleep ─────────────────────────────────────────────────────────────────
	const nights = rows
		.filter((r) => r.sleep != null)
		.map((r) => ({
			date: r.date,
			durationMinutes: r.sleep?.durationMinutes ?? 0,
			quality:
				r.sleep?.efficiencyPercent != null
					? `${r.sleep.efficiencyPercent}% efficiency`
					: null,
			efficiencyPercent: r.sleep?.efficiencyPercent ?? null,
			stages: r.sleep?.stages ?? null,
			sleepEnd: r.sleep?.sleepEnd ?? null,
		}));

	if (nights.length > 0) {
		const durations = nights.map((n) => n.durationMinutes).filter((d) => d > 0);
		const avgDurationMinutes7d =
			durations.length > 0
				? durations.reduce((a, b) => a + b, 0) / durations.length
				: null;

		const efficiencies = nights
			.map((n) => n.efficiencyPercent)
			.filter((e): e is number => e != null);
		const avgEfficiencyPercent7d =
			efficiencies.length > 0
				? Math.round(
						efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length,
					)
				: null;

		const nightsWithStages = nights.filter((n) => n.stages != null);
		let avgStages7d: import("@fit-analyzer/shared").SleepStages | null = null;
		if (nightsWithStages.length > 0) {
			const total = nightsWithStages.reduce(
				(acc, n) => {
					acc.awakeMinutes += n.stages?.awakeMinutes ?? 0;
					acc.lightMinutes += n.stages?.lightMinutes ?? 0;
					acc.deepMinutes += n.stages?.deepMinutes ?? 0;
					acc.remMinutes += n.stages?.remMinutes ?? 0;
					return acc;
				},
				{ awakeMinutes: 0, lightMinutes: 0, deepMinutes: 0, remMinutes: 0 },
			);
			avgStages7d = {
				awakeMinutes: Math.round(total.awakeMinutes / nightsWithStages.length),
				lightMinutes: Math.round(total.lightMinutes / nightsWithStages.length),
				deepMinutes: Math.round(total.deepMinutes / nightsWithStages.length),
				remMinutes: Math.round(total.remMinutes / nightsWithStages.length),
			};
		}

		sleep = {
			recentNights: nights.map((n) => ({
				date: n.date,
				durationMinutes: n.durationMinutes,
				durationFormatted: formatSleepDuration(n.durationMinutes),
				quality: n.quality,
				efficiencyPercent: n.efficiencyPercent,
				stages: n.stages ?? null,
			})),
			avgDurationMinutes7d,
			avgDurationFormatted7d: avgDurationMinutes7d
				? formatSleepDuration(avgDurationMinutes7d)
				: null,
			avgEfficiencyPercent7d,
			avgStages7d,
		};
	}

	// ── Morning Heart Rate (lowest HR reading within 30 min of waking) ───────
	const morningHrByDate = computeMorningHeartRateByDate(rows);
	const morningHrValues = Array.from(morningHrByDate, ([date, value]) => ({
		date,
		value,
	})).sort((a, b) => b.date.localeCompare(a.date));
	if (morningHrValues.length > 0) {
		const latest = morningHrValues[0].value;
		const avg =
			morningHrValues.reduce((a, b) => a + b.value, 0) / morningHrValues.length;
		morningHeartRate = {
			current: Math.round(latest),
			trend7d: Math.round(avg),
			status:
				latest > avg + 5 ? "elevated" : latest < avg * 0.9 ? "lower" : "normal",
		};
	}

	// ── RHR (average HR during sleep — Bevel-style) ───────────────────────────
	// Apple's `resting_heart_rate` metric is recomputed throughout the day and
	// drifts upward; the average HR during the sleep window is a stable,
	// morning-grounded RHR that matches what apps like Bevel report.
	const sleepAvgHrByDate = computeSleepAverageHrByDate(rows);
	const rhrValues = Array.from(sleepAvgHrByDate, ([date, value]) => ({
		date,
		value,
	})).sort((a, b) => b.date.localeCompare(a.date));
	if (rhrValues.length > 0) {
		const latest = rhrValues[0].value; // rows are date-desc → most recent first
		const avg = rhrValues.reduce((a, b) => a + b.value, 0) / rhrValues.length;
		rhr = {
			current: Math.round(latest),
			trend7d: Math.round(avg),
			status: determineStatus(latest, avg, "rhr"),
		};
	}

	// ── HRV ────────────────────────────────────────────────────────────────────
	const hrvValues = rows
		.map((r) => r.hrv)
		.filter((v): v is number => typeof v === "number" && v > 0);
	if (hrvValues.length > 0) {
		const latest = hrvValues[0]; // rows are date-desc → most recent first
		const avg = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
		hrv = {
			current: Math.round(latest),
			trend7d: Math.round(avg),
			status: determineStatus(latest, avg, "hrv"),
		};
	}

	// ── Respiratory Rate ───────────────────────────────────────────────────────
	const rrValues = rows
		.map((r) => r.respiratoryRate)
		.filter((v): v is number => typeof v === "number" && v > 0);
	if (rrValues.length > 0) {
		const latest = rrValues[0]; // rows are date-desc → most recent first
		const avg = rrValues.reduce((a, b) => a + b, 0) / rrValues.length;
		respiratoryRate = {
			current: Math.round(latest * 10) / 10,
			trend7d: Math.round(avg * 10) / 10,
			status: determineStatus(latest, avg, "respiratoryRate"),
		};
	}

	// ── SpO2 ───────────────────────────────────────────────────────────────────
	const spo2Values = rows
		.map((r) => r.spo2)
		.filter((v): v is number => typeof v === "number" && v > 0);
	if (spo2Values.length > 0) {
		const latest = spo2Values[0]; // rows are date-desc → most recent first
		const avg = spo2Values.reduce((a, b) => a + b, 0) / spo2Values.length;
		spo2 = {
			current: Math.round(latest * 10) / 10,
			trend7d: Math.round(avg * 10) / 10,
			status: determineStatus(latest, avg, "spo2"),
		};
	}

	// ── Temperature ──────────────────────────────────────────────────────────
	const tempValues = rows
		.map((r) => r.temperature)
		.filter((v): v is number => typeof v === "number" && v > 0);
	console.log(
		`[hae] Temperature values found: ${tempValues.length}`,
		tempValues,
	);
	if (tempValues.length > 0) {
		const current = tempValues[0]; // rows are date-desc → most recent first
		temperature = {
			current: Math.round(current * 10) / 10,
			trend7d: null,
			status: current > 37.5 ? "higher" : current < 36.0 ? "lower" : "normal",
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
		bodyComposition: pickLatestBodyComposition(rows),
	};
}

function pickLatestBodyComposition(
	rows: Array<{ date: string } & HaeDailySnapshot>,
): { weightKg: number | null; asOf: string | null } {
	// rows are date-desc (newest first); find the most recent non-null weight.
	for (const row of rows) {
		const weightKg = row.bodyComposition?.weightKg ?? null;
		if (weightKg != null && weightKg > 0) {
			return { weightKg, asOf: row.date };
		}
	}
	return { weightKg: null, asOf: null };
}

function formatSleepDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return `${h}h ${String(m).padStart(2, "0")}m`;
}

// ─── History query (raw daily rows for charting) ───────────────────────────

export async function getHaeHistory(
	fitUserId: string,
	startDate: string,
	endDate: string,
): Promise<HealthHistoryEntry[]> {
	const rows = getHistoryStmt.all(fitUserId, startDate, endDate) as Array<{
		date: string;
		data: string;
	}>;

	if (rows.length === 0) return [];

	const parsed = rows.map((row) => ({
		date: row.date,
		snap: JSON.parse(row.data) as HaeDailySnapshot,
	}));
	const datedSnaps = parsed.map(({ date, snap }) => ({ date, ...snap }));
	const morningHrByDate = computeMorningHeartRateByDate(datedSnaps);
	const sleepAvgHrByDate = computeSleepAverageHrByDate(datedSnaps);

	return parsed.map(({ date, snap }) => {
		let sleepDurationMinutes: number | null = null;
		let sleepEfficiencyPercent: number | null = null;
		let deepMinutes: number | null = null;
		let remMinutes: number | null = null;

		if (snap.sleep) {
			sleepDurationMinutes = snap.sleep.durationMinutes ?? null;
			sleepEfficiencyPercent = snap.sleep.efficiencyPercent ?? null;
			if (snap.sleep.stages) {
				deepMinutes = snap.sleep.stages.deepMinutes ?? null;
				remMinutes = snap.sleep.stages.remMinutes ?? null;
			}
		}

		const morningHr = morningHrByDate.get(date);
		const sleepAvgHr = sleepAvgHrByDate.get(date);
		return {
			date,
			rhr: sleepAvgHr != null ? Math.round(sleepAvgHr) : null,
			hrv: snap.hrv ?? null,
			respiratoryRate: snap.respiratoryRate ?? null,
			spo2: snap.spo2 ?? null,
			temperature: snap.temperature ?? null,
			morningHeartRate: morningHr != null ? Math.round(morningHr) : null,
			sleepDurationMinutes,
			sleepEfficiencyPercent,
			deepMinutes,
			remMinutes,
		};
	});
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getHaeHealthContext(
	fitUserId: string,
): Promise<HealthContext | null> {
	const cached = cache.get(fitUserId);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.data;
	}

	// Fetch last 7 days of history (use tomorrow as the upper bound so data
	// pushed from timezones ahead of the server isn't dropped).
	const end = new Date();
	end.setDate(end.getDate() + 1);
	const endStr = end.toISOString().split("T")[0];
	const start = new Date();
	start.setDate(start.getDate() - 7);
	const startStr = start.toISOString().split("T")[0];

	const rows = getHistoryStmt.all(fitUserId, startStr, endStr) as Array<{
		user_id: string;
		date: string;
		data: string;
		updated_at: string;
	}>;

	if (rows.length === 0) return null;

	const ctx = computeHaeHealthContext(
		rows.map((r) => ({ date: r.date, data: r.data })),
	);

	pruneCache();
	cache.set(fitUserId, { data: ctx, fetchedAt: Date.now() });
	return ctx;
}

export function getHaeLastSync(userId: string): string | null {
	// Fast path: check the dedicated user_settings column
	const userRow = db
		.prepare("SELECT hae_last_sync_at FROM user_settings WHERE user_id = ?")
		.get(userId) as { hae_last_sync_at: string | null } | undefined;
	if (userRow?.hae_last_sync_at) return userRow.hae_last_sync_at;

	// Fallback: inspect the history table
	const row = getLastSyncStmt.get(userId);
	return row?.updated_at ?? null;
}

export function clearHaeCache(userId: string): void {
	cache.delete(userId);
}
