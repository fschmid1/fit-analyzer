import { Hono } from "hono";
import { db } from "../db.js";
import type {
	ActivityStats,
	HealthData,
	HealthHistoryEntry,
} from "@fit-analyzer/shared";
import { getRawHealthContext } from "../lib/owClient.js";
import {
	getHaeHealthContext,
	getHaeLastSync,
	getHaeHistory,
} from "../lib/haeClient.js";
import {
	computeActivityStats,
	computeAllTimeEstimates,
} from "../lib/athleteStats.js";

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
