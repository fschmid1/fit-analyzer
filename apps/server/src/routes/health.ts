import { Hono } from "hono";
import { db } from "../db.js";
import type { ActivityStats, HealthData } from "@fit-analyzer/shared";
import type { ActivitySummary } from "@fit-analyzer/shared";
import { getRawHealthContext } from "../lib/owClient.js";

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
	healthContext: NonNullable<Awaited<ReturnType<typeof getRawHealthContext>>>,
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
		sleep,
	};
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
		totalWork: totalWork > 0 ? Math.round(totalWork) : null,
	};
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

	let healthData: HealthData | null = null;
	try {
		const ctx = await getRawHealthContext(userId);
		if (ctx) {
			healthData = buildHealthData(ctx);
		}
	} catch (err) {
		console.warn("[health] Failed to fetch health data:", err);
	}

	const stats = computeActivityStats(userId, startDate, endDate);

	return c.json({
		health: healthData,
		activityStats: stats,
	});
});

export { health };
