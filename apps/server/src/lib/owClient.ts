import { db } from "../db.js";
import { env } from "../env.js";

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
		elevated: boolean;
	} | null;
	hrv: {
		current: number | null;
		trend7d: number | null;
		declining: boolean;
	} | null;
	sleep: {
		recentNights: RecentNight[];
		avgDurationMinutes7d: number | null;
		avgEfficiencyPercent7d: number | null;
		avgStages7d: SleepStages | null;
	} | null;
}

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
	[key: string]: unknown;
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

function computeHealthContext(
	sleepSummaries: SleepRecord[] | null,
): HealthContext {
	let rhr: HealthContext["rhr"] = null;
	let hrv: HealthContext["hrv"] = null;
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
				elevated: latest > avg + 5,
			};
		}

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
				declining: latest < avg * 0.9,
			};
		}
	}

	return { rhr, hrv, sleep };
}

function formatHealthContext(ctx: HealthContext): string {
	const parts: string[] = [];
	const now = new Date().toISOString().split("T")[0];
	parts.push(
		`*Health data retrieved ${now} from OpenWearables — this is live, up-to-date data.*`,
	);

	if (ctx.rhr?.current != null) {
		let rhrLine = `- Resting Heart Rate (from sleep): ${ctx.rhr.current} bpm`;
		if (ctx.rhr.trend7d != null) {
			rhrLine += ` (7-day avg: ${ctx.rhr.trend7d} bpm)`;
			if (ctx.rhr.elevated) {
				rhrLine +=
					" ⚠ Elevated — may indicate fatigue, illness, or incomplete recovery.";
			}
		}
		parts.push(rhrLine);
	}

	if (ctx.hrv?.current != null) {
		let hrvLine = `- HRV (from sleep): ${ctx.hrv.current} ms`;
		if (ctx.hrv.trend7d != null) {
			hrvLine += ` (7-day avg: ${ctx.hrv.trend7d} ms)`;
			if (ctx.hrv.declining) {
				hrvLine +=
					" ⚠ Declining — may indicate accumulated stress or overtraining.";
			}
		}
		parts.push(hrvLine);
	}

	if (ctx.sleep) {
		if (ctx.sleep.avgDurationMinutes7d != null) {
			const hours = Math.floor(ctx.sleep.avgDurationMinutes7d / 60);
			const mins = Math.round(ctx.sleep.avgDurationMinutes7d % 60);
			parts.push(
				`- Average Sleep (7 days): ${hours}h ${String(mins).padStart(2, "0")}m`,
			);
		}
		if (ctx.sleep.avgEfficiencyPercent7d != null) {
			parts.push(
				`- Average Sleep Efficiency (7 days): ${ctx.sleep.avgEfficiencyPercent7d}%`,
			);
		}
		if (ctx.sleep.avgStages7d) {
			const s = ctx.sleep.avgStages7d;
			parts.push(
				`- Avg Sleep Stages (7d): Awake ${s.awakeMinutes}m, Light ${s.lightMinutes}m, Deep ${s.deepMinutes}m, REM ${s.remMinutes}m`,
			);
		}
		if (ctx.sleep.recentNights.length > 0) {
			const last = ctx.sleep.recentNights[0];
			if (last.durationMinutes > 0) {
				const hours = Math.floor(last.durationMinutes / 60);
				const mins = Math.round(last.durationMinutes % 60);
				let lastNight = `- Last Night's Sleep (${last.date}): ${hours}h ${String(mins).padStart(2, "0")}m`;
				if (last.quality) {
					lastNight += `, Quality: ${last.quality}`;
				}
				if (last.stages) {
					lastNight += `, Stages: Awake ${last.stages.awakeMinutes}m, Light ${last.stages.lightMinutes}m, Deep ${last.stages.deepMinutes}m, REM ${last.stages.remMinutes}m`;
				}
				parts.push(lastNight);
			}
		}
	}

	if (parts.length <= 1) return "";

	return `\n## Athlete Health Data\nUse this data to contextualize training advice (fatigue, recovery, sleep). This data is fetched live from the athlete's wearables via OpenWearables.\n${parts.join("\n")}\n`;
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
		const sleepSummaries = await fetchSleepSummaries(owUserId);
		console.log(
			`[ow] fetched ${sleepSummaries?.length} sleep summaries for user ${fitUserId} (OW ID: ${owUserId})`,
		);
		console.log(
			`[ow] sleep summaries: ${JSON.stringify(sleepSummaries, null, 2)}`,
		);
		const ctx = computeHealthContext(sleepSummaries);
		pruneCache();
		cache.set(owUserId, { data: ctx, fetchedAt: Date.now() });
		return ctx;
	} catch (err) {
		console.warn("[ow] failed to fetch health context:", err);
		return null;
	}
}

export async function getHealthContext(
	fitUserId: string,
): Promise<{ text: string }> {
	const ctx = await resolveHealthContext(fitUserId);
	if (!ctx) return { text: "" };
	return { text: formatHealthContext(ctx) };
}

export async function getRawHealthContext(
	fitUserId: string,
): Promise<HealthContext | null> {
	return resolveHealthContext(fitUserId);
}

export { getOwUserId };
