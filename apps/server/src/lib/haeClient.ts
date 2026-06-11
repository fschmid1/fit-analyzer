import { db } from "../db.js";
import type { HealthContext, HealthMetricStatus } from "@fit-analyzer/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HaeQuantityData {
	date: string;
	qty: number;
	units: string;
	source?: string;
}

interface HaeHeartRateData extends HaeQuantityData {
	Min: number;
	Avg: number;
	Max: number;
}

interface HaeSleepEntry {
	date: string;
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
	units: string;
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
}

interface HaeDailySnapshot {
	rhr: number | null;
	hrv: number | null;
	respiratoryRate: number | null;
	spo2: number | null;
	temperature: number | null;
	sleep: HaeSleepData | null;
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

const upsertHistoryStmt = db.prepare(
	`INSERT INTO hae_health_history (user_id, date, data, updated_at)
   VALUES (?, ?, ?, datetime('now'))
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
   ORDER BY date DESC`,
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

function parseMetrics(metrics: HaeMetric[]): Map<string, HaeDailySnapshot> {
	const byDate = new Map<string, Partial<HaeDailySnapshot>>();

	function ensureDate(date: string): Partial<HaeDailySnapshot> {
		let snap = byDate.get(date);
		if (!snap) {
			snap = {};
			byDate.set(date, snap);
		}
		return snap;
	}

	for (const metric of metrics) {
		for (const raw of metric.data) {
			const date = parseHaeDate(raw.date);
			const snap = ensureDate(date);

			switch (metric.name) {
				case "resting_heart_rate": {
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
				case "body_temperature": {
					const qty = (raw as HaeQuantityData).qty;
					if (typeof qty === "number") {
						// HAE may export in degF or degC
						const units = metric.units;
						snap.temperature =
							units === "degF" || units === "°F" ? (qty - 32) * (5 / 9) : qty;
					}
					break;
				}
				case "sleep_analysis": {
					const entry = raw as HaeSleepEntry;
					if (entry.totalSleep != null || entry.asleep != null) {
						const totalHours = entry.totalSleep ?? entry.asleep ?? 0;
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
						};
					}
					break;
				}
			}
		}
	}

	// Normalize: ensure every date has all fields
	const result = new Map<string, HaeDailySnapshot>();
	for (const [date, snap] of byDate) {
		result.set(date, {
			rhr: snap.rhr ?? null,
			hrv: snap.hrv ?? null,
			respiratoryRate: snap.respiratoryRate ?? null,
			spo2: snap.spo2 ?? null,
			temperature: snap.temperature ?? null,
			sleep: snap.sleep ?? null,
		});
	}
	return result;
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

const updateLastSyncStmt = db.prepare(
	`UPDATE user_settings SET hae_last_sync_at = datetime('now') WHERE user_id = ?`,
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
			upsertHistoryStmt.run(userId, date, JSON.stringify(snapshot));
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

	// ── RHR ───────────────────────────────────────────────────────────────────
	const rhrValues = rows
		.map((r) => r.rhr)
		.filter((v): v is number => typeof v === "number" && v > 0)
		.sort((a, b) => b - a);
	if (rhrValues.length > 0) {
		const latest = rhrValues[0];
		const avg = rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length;
		rhr = {
			current: Math.round(latest),
			trend7d: Math.round(avg),
			status: determineStatus(latest, avg, "rhr"),
		};
	}

	// ── HRV ────────────────────────────────────────────────────────────────────
	const hrvValues = rows
		.map((r) => r.hrv)
		.filter((v): v is number => typeof v === "number" && v > 0)
		.sort((a, b) => b - a);
	if (hrvValues.length > 0) {
		const latest = hrvValues[0];
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
		.filter((v): v is number => typeof v === "number" && v > 0)
		.sort((a, b) => b - a);
	if (rrValues.length > 0) {
		const latest = rrValues[0];
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
		.filter((v): v is number => typeof v === "number" && v > 0)
		.sort((a, b) => b - a);
	if (spo2Values.length > 0) {
		const latest = spo2Values[0];
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
		.filter((v): v is number => typeof v === "number" && v > 0)
		.sort((a, b) => b - a);
	if (tempValues.length > 0) {
		const current = tempValues[0];
		temperature = {
			current: Math.round(current * 10) / 10,
			trend7d: null,
			status: current > 37.5 ? "higher" : current < 36.0 ? "lower" : "normal",
		};
	}

	return { rhr, hrv, respiratoryRate, spo2, temperature, sleep };
}

function formatSleepDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return `${h}h ${String(m).padStart(2, "0")}m`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getHaeHealthContext(
	fitUserId: string,
): Promise<HealthContext | null> {
	const cached = cache.get(fitUserId);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.data;
	}

	// Fetch last 7 days of history
	const end = new Date().toISOString().split("T")[0];
	const start = new Date();
	start.setDate(start.getDate() - 7);
	const startStr = start.toISOString().split("T")[0];

	const rows = getHistoryStmt.all(fitUserId, startStr, end) as Array<{
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
