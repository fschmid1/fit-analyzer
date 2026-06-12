import { db } from "../db.js";
import {
	buildPowerBySecond,
	peakPowerFromSeconds,
	type ActivitySummary,
	type StoredRecord,
} from "@fit-analyzer/shared";
import type { ActivityStats } from "@fit-analyzer/shared";

/**
 * Minimal shape the VO₂max estimate needs. Both `HealthData` and
 * `HealthContext` (returned by OW/HAE clients) satisfy this.
 */
type Vo2maxSource = {
	rhr: { current: number | null } | null;
	bodyComposition: { weightKg: number | null; asOf: string | null } | null;
} | null;

function formatHours(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) {
		return `${h}h ${m}m`;
	}
	return `${m}m`;
}

const summaryStmt = db.prepare(
	`SELECT summary FROM activities
   WHERE user_id = ? AND date >= ? AND date <= ?
   ORDER BY date ASC`,
);

export function computeActivityStats(
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

/**
 * Hawley–Noakes cycling VO₂max estimate from sustainable power output.
 *   VO₂max (ml/kg/min) = 10.8 × (W / kg) + 7
 * Reference: Hawley JA, Noakes TD. "Peak power output predicts maximal
 * oxygen uptake and performance time in trained cyclists."
 * Eur J Appl Physiol. 1992;65(1):79-83.
 */
function vo2maxFromPowerAndMass(powerW: number, bodyMassKg: number): number {
	return 10.8 * (powerW / bodyMassKg) + 7;
}

export function computeAllTimeEstimates(
	userId: string,
	healthData: Vo2maxSource,
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

	const weightKg = healthData?.bodyComposition?.weightKg ?? null;
	let estimatedVo2max: number | null = null;
	if (weightKg != null && weightKg > 0 && bestPeak20min > 0) {
		const vo2mlKgMin = vo2maxFromPowerAndMass(bestPeak20min, weightKg);
		estimatedVo2max = Math.round(vo2mlKgMin * 10) / 10;
	} else {
		const restingHR = healthData?.rhr?.current ?? null;
		if (maxHeartRate > 0 && restingHR != null && restingHR > 0) {
			estimatedVo2max = Math.round(15.3 * (maxHeartRate / restingHR) * 10) / 10;
		}
	}

	return { estimatedFtp, estimatedVo2max };
}
