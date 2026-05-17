import { db } from "../db.js";
import { env } from "../env.js";

interface HealthContext {
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
		recentNights: {
			date: string;
			durationMinutes: number;
			quality: string | null;
		}[];
		avgDurationMinutes7d: number | null;
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

	const fmt = (d: Date) => d.toISOString().split("T")[0];
	return { startDate: fmt(start), endDate: fmt(end) };
}

async function fetchSleepSummaries(
	owUserId: string,
): Promise<SleepRecord[] | null> {
	const { startDate, endDate } = getDateRange();
	const params = new URLSearchParams({
		start_date: startDate,
		end_date: endDate,
		limit: "7",
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
		const recentNights = sleepSummaries
			.map((n) => ({
				date: n.date,
				durationMinutes: n.duration_minutes,
				quality:
					n.efficiency_percent != null
						? `${n.efficiency_percent.toFixed(0)}% efficiency`
						: null,
			}))
			.sort((a, b) => b.date.localeCompare(a.date));

		const durations = recentNights
			.map((n) => n.durationMinutes)
			.filter((d) => d > 0);
		const avgDurationMinutes7d =
			durations.length > 0
				? durations.reduce((a, b) => a + b, 0) / durations.length
				: null;

		sleep = { recentNights, avgDurationMinutes7d };

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
		if (ctx.sleep.recentNights.length > 0) {
			const last = ctx.sleep.recentNights[0];
			if (last.durationMinutes > 0) {
				const hours = Math.floor(last.durationMinutes / 60);
				const mins = Math.round(last.durationMinutes % 60);
				let lastNight = `- Last Night's Sleep (${last.date}): ${hours}h ${String(mins).padStart(2, "0")}m`;
				if (last.quality) {
					lastNight += `, Quality: ${last.quality}`;
				}
				parts.push(lastNight);
			}
		}
	}

	if (parts.length <= 1) return "";

	return `\n## Athlete Health Data\nUse this data to contextualize training advice (fatigue, recovery, sleep). This data is fetched live from the athlete's wearables via OpenWearables.\n${parts.join("\n")}\n`;
}

export async function getHealthContext(
	fitUserId: string,
): Promise<{ text: string }> {
	if (!isConfigured()) {
		return { text: "" };
	}

	const owUserId = getOwUserId(fitUserId);
	if (!owUserId) {
		return { text: "" };
	}

	const cached = cache.get(owUserId);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return { text: formatHealthContext(cached.data) };
	}

	try {
		const sleepSummaries = await fetchSleepSummaries(owUserId);
		const ctx = computeHealthContext(sleepSummaries);
		pruneCache();
		cache.set(owUserId, { data: ctx, fetchedAt: Date.now() });

		const text = formatHealthContext(ctx);
		return { text };
	} catch (err) {
		console.warn("[ow] failed to fetch health context:", err);
		return { text: "" };
	}
}

export { getOwUserId };
