import { Hono } from "hono";
import { db } from "../db.js";
import type {
	ActivityStats,
	HealthData,
	HealthHistoryEntry,
	StoredRecord,
} from "@fit-analyzer/shared";
import type { ActivitySummary } from "@fit-analyzer/shared";
import { buildPowerBySecond, peakPowerFromSeconds } from "@fit-analyzer/shared";
import { getRawHealthContext } from "../lib/owClient.js";
import {
	getHaeHealthContext,
	getHaeLastSync,
	getHaeHistory,
} from "../lib/haeClient.js";

const health = new Hono();

function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) {
		throw new Error("Missing x-authentik-username header");
	}
	return userId;
}

function formatHours(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) {
		return `${h}h ${m}m`;
	}
	return `${m}m`;
}

function formatSleepDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return `${h}h ${String(m).padStart(2, "0")}m`;
}

function buildHealthData(
	healthContext: import("@fit-analyzer/shared").HealthContext,
): HealthData {
	const ctx = healthContext;

	let sleep: HealthData["sleep"] = null;
	if (ctx.sleep) {
		const recentNights = ctx.sleep.recentNights.map((n) => ({
			date: n.date,
			durationMinutes: n.durationMinutes,
			durationFormatted: formatSleepDuration(n.durationMinutes),
			quality: n.quality,
			efficiencyPercent: n.efficiencyPercent,
			stages: n.stages ?? null,
		}));
		let avgDurationFormatted7d: string | null = null;
		if (ctx.sleep.avgDurationMinutes7d != null) {
			avgDurationFormatted7d = formatSleepDuration(
				ctx.sleep.avgDurationMinutes7d,
			);
		}
		sleep = {
			recentNights,
			avgDurationMinutes7d: ctx.sleep.avgDurationMinutes7d,
			avgDurationFormatted7d,
			avgEfficiencyPercent7d: ctx.sleep.avgEfficiencyPercent7d,
			avgStages7d: ctx.sleep.avgStages7d ?? null,
		};
	}

	return {
		rhr: ctx.rhr,
		hrv: ctx.hrv,
		respiratoryRate: ctx.respiratoryRate,
		spo2: ctx.spo2,
		temperature: ctx.temperature,
		morningHeartRate: ctx.morningHeartRate,
		sleep,
	};
}

const getHealthSourceStmt = db.prepare<{ health_source: string }, [string]>(
	"SELECT health_source FROM user_settings WHERE user_id = ?",
);

async function resolveHealthData(
	userId: string,
	startDate: string,
	endDate: string,
): Promise<{
	healthData: HealthData | null;
	activityStats: ActivityStats;
	sourceUsed: "openwearables" | "health_auto_export" | null;
}> {
	const row = getHealthSourceStmt.get(userId);
	const healthSource = row?.health_source ?? "openwearables";

	let healthData: HealthData | null = null;
	let sourceUsed: "openwearables" | "health_auto_export" | null = null;

	// Try primary source
	try {
		if (healthSource === "health_auto_export") {
			const haeCtx = await getHaeHealthContext(userId);
			if (haeCtx) {
				healthData = buildHealthData(haeCtx);
				sourceUsed = "health_auto_export";
			}
		}
		if (!healthData) {
			const owCtx = await getRawHealthContext(userId);
			if (owCtx) {
				healthData = buildHealthData(
					owCtx as import("@fit-analyzer/shared").HealthContext,
				);
				sourceUsed = "openwearables";
			}
		}
	} catch (err) {
		console.warn("[health] Failed to fetch health data:", err);
	}

	// For 'auto' mode, compare freshness and potentially switch
	if (healthSource === "auto" && healthData) {
		// auto already resolved above (tried HAE first, then OW)
		// if only OW succeeded, sourceUsed is "openwearables"
		// if only HAE succeeded, sourceUsed is "health_auto_export"
		// if both could succeed, HAE was tried first
	}

	// Fallback: if auto and no data yet, try the other source
	if (healthSource === "auto" && !healthData) {
		try {
			const owCtx = await getRawHealthContext(userId);
			if (owCtx) {
				healthData = buildHealthData(
					owCtx as import("@fit-analyzer/shared").HealthContext,
				);
				sourceUsed = "openwearables";
			}
		} catch (err) {
			console.warn("[health] Auto fallback to OW failed:", err);
		}
		if (!healthData) {
			try {
				const haeCtx = await getHaeHealthContext(userId);
				if (haeCtx) {
					healthData = buildHealthData(haeCtx);
					sourceUsed = "health_auto_export";
				}
			} catch (err) {
				console.warn("[health] Auto fallback to HAE failed:", err);
			}
		}
	}

	const stats = computeActivityStats(userId, startDate, endDate);
	return { healthData, activityStats: stats, sourceUsed };
}

const summaryStmt = db.prepare(
	`SELECT summary FROM activities
   WHERE user_id = ? AND date >= ? AND date <= ?
   ORDER BY date ASC`,
);

function computeActivityStats(
	userId: string,
	startDate: string,
	endDate: string,
): ActivityStats {
	const rows = summaryStmt.all(userId, startDate, endDate) as {
		summary: string;
	}[];

	let totalDurationSeconds = 0;
	let totalDistanceKm = 0;
	let distanceCount = 0;
	const powerVals: number[] = [];
	const normalizedPowerVals: number[] = [];
	const hrVals: number[] = [];
	const cadenceVals: number[] = [];
	const normalizedCadenceVals: number[] = [];
	const peak1minVals: number[] = [];
	const peak5minVals: number[] = [];
	let totalWork = 0;
	let maxPower = 0;
	let maxHeartRate = 0;

	for (const row of rows) {
		const summary = JSON.parse(row.summary) as ActivitySummary;
		totalDurationSeconds += summary.totalTimerTime;

		if (summary.totalDistanceKm != null && summary.totalDistanceKm > 0) {
			totalDistanceKm += summary.totalDistanceKm;
			distanceCount++;
		}
		if (summary.avgPower != null) powerVals.push(summary.avgPower);
		if (summary.normalizedPower != null)
			normalizedPowerVals.push(summary.normalizedPower);
		if (summary.maxPower != null && summary.maxPower > maxPower) {
			maxPower = summary.maxPower;
		}
		if (summary.avgHeartRate != null) hrVals.push(summary.avgHeartRate);
		if (summary.maxHeartRate != null && summary.maxHeartRate > maxHeartRate) {
			maxHeartRate = summary.maxHeartRate;
		}
		if (summary.avgCadence != null) cadenceVals.push(summary.avgCadence);
		if (summary.normalizedCadence != null)
			normalizedCadenceVals.push(summary.normalizedCadence);
		if (summary.peak1minPower != null) peak1minVals.push(summary.peak1minPower);
		if (summary.peak5minPower != null) peak5minVals.push(summary.peak5minPower);
		if (summary.totalWork != null) totalWork += summary.totalWork;
	}

	const avg = (vals: number[]) =>
		vals.length > 0
			? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
			: null;

	return {
		count: rows.length,
		totalDurationSeconds,
		totalDurationFormatted: formatHours(totalDurationSeconds),
		totalDistanceKm:
			distanceCount > 0 ? Math.round(totalDistanceKm * 10) / 10 : null,
		avgPower: avg(powerVals),
		normalizedPower: avg(normalizedPowerVals),
		maxPower: maxPower > 0 ? maxPower : null,
		avgHeartRate: avg(hrVals),
		maxHeartRate: maxHeartRate > 0 ? maxHeartRate : null,
		avgCadence: avg(cadenceVals),
		normalizedCadence: avg(normalizedCadenceVals),
		peak1minPower: peak1minVals.length > 0 ? Math.max(...peak1minVals) : null,
		peak5minPower: peak5minVals.length > 0 ? Math.max(...peak5minVals) : null,
		peak20minPower: null,
		totalWork: totalWork > 0 ? Math.round(totalWork) : null,
	};
}

const allActivitiesStmt = db.prepare(
	"SELECT summary, records FROM activities WHERE user_id = ?",
);

function computeAllTimeEstimates(
	userId: string,
	healthData: HealthData | null,
): { estimatedFtp: number | null; estimatedVo2max: number | null } {
	const rows = allActivitiesStmt.all(userId) as {
		summary: string;
		records: string;
	}[];

	let bestPeak20min = 0;
	let maxHeartRate = 0;

	for (const row of rows) {
		const summary = JSON.parse(row.summary) as ActivitySummary;

		if (
			summary.peak20minPower != null &&
			summary.peak20minPower > bestPeak20min
		) {
			bestPeak20min = summary.peak20minPower;
		} else {
			// Fallback: compute on-the-fly from raw records for older activities
			const records = JSON.parse(row.records) as StoredRecord[];
			const powerBySecond = buildPowerBySecond(
				records.map((r) => ({
					timestamp: new Date(r.timestamp),
					elapsedSeconds: r.elapsedSeconds,
					power: r.power,
					heartRate: r.heartRate,
					cadence: r.cadence,
					speed: r.speed,
					gradient: r.gradient,
					lat: r.lat,
					lng: r.lng,
				})),
			);
			const computed = peakPowerFromSeconds(powerBySecond, 1200);
			if (computed != null && computed > bestPeak20min) {
				bestPeak20min = computed;
			}
		}

		if (summary.maxHeartRate != null && summary.maxHeartRate > maxHeartRate) {
			maxHeartRate = summary.maxHeartRate;
		}
	}

	const estimatedFtp =
		bestPeak20min > 0 ? Math.round(bestPeak20min * 0.95) : null;

	let estimatedVo2max: number | null = null;
	const restingHR = healthData?.rhr?.current ?? null;
	if (maxHeartRate > 0 && restingHR != null && restingHR > 0) {
		estimatedVo2max = Math.round(15.3 * (maxHeartRate / restingHR) * 10) / 10;
	}

	return { estimatedFtp, estimatedVo2max };
}

health.get("/", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized: missing x-authentik-username header" },
			401,
		);
	}

	const startDate = c.req.query("startDate");
	const endDate = c.req.query("endDate");

	if (!startDate || !endDate) {
		return c.json(
			{ error: "Missing required query params: startDate, endDate" },
			400,
		);
	}

	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
		!/^\d{4}-\d{2}-\d{2}$/.test(endDate)
	) {
		return c.json(
			{ error: "startDate and endDate must be in YYYY-MM-DD format" },
			400,
		);
	}

	const { healthData, activityStats, sourceUsed } = await resolveHealthData(
		userId,
		startDate,
		endDate,
	);

	const { estimatedFtp, estimatedVo2max } = computeAllTimeEstimates(
		userId,
		healthData,
	);

	// Determine last sync timestamp from the active source
	let lastSyncAt: string | null = null;
	let history: HealthHistoryEntry[] = [];
	if (sourceUsed === "health_auto_export") {
		lastSyncAt = getHaeLastSync(userId);
		history = await getHaeHistory(userId, startDate, endDate);
	}

	return c.json({
		health: healthData,
		activityStats,
		sourceUsed,
		lastSyncAt,
		history,
		estimatedFtp,
		estimatedVo2max,
	});
});

export { health };
