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

const recentActivitiesStmt = db.prepare(
	`SELECT id, summary, records, created_at FROM activities
   WHERE user_id = ? AND date >= date('now', '-90 days')
   ORDER BY date DESC, created_at DESC
   LIMIT 100`,
);

/**
 * Extract a human-readable location label from a Strava-style activity object.
 * Prefers the most specific non-empty value: city, state, then country.
 */
function formatLocation(
	city: string | null | undefined,
	state: string | null | undefined,
	country: string | null | undefined,
): string | null {
	const parts: string[] = [];
	if (city?.trim()) parts.push(city.trim());
	if (state?.trim()) parts.push(state.trim());
	if (parts.length === 0 && country?.trim()) parts.push(country.trim());
	return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Infer the athlete's likely home location from recent activities.
 * Returns the most frequently occurring location label in the trailing 90 days,
 * requiring it to appear in at least 20% of activities to avoid noise.
 */
export function inferLocationFromActivities(userId: string): string | null {
	const rows = recentActivitiesStmt.all(userId) as {
		id: string;
		summary: string;
		records: string;
		created_at: string;
	}[];

	const counts = new Map<string, { count: number; lastSeenAt: string }>();

	for (const row of rows) {
		const summary = JSON.parse(row.summary) as ActivitySummary & {
			locationCity?: string | null;
			locationState?: string | null;
			locationCountry?: string | null;
		};

		const label =
			formatLocation(
				summary.locationCity,
				summary.locationState,
				summary.locationCountry,
			) ?? inferLocationFromRecords(JSON.parse(row.records) as StoredRecord[]);

		if (!label) continue;

		const existing = counts.get(label);
		counts.set(label, {
			count: (existing?.count ?? 0) + 1,
			lastSeenAt:
				existing && existing.lastSeenAt > row.created_at
					? existing.lastSeenAt
					: row.created_at,
		});
	}

	if (counts.size === 0) return null;

	const minFrequency = Math.max(1, Math.floor(rows.length * 0.2));
	let best: { label: string; count: number; lastSeenAt: string } | null = null;

	for (const [label, { count, lastSeenAt }] of counts) {
		if (count < minFrequency) continue;
		if (
			!best ||
			count > best.count ||
			(count === best.count && lastSeenAt > best.lastSeenAt)
		) {
			best = { label, count, lastSeenAt };
		}
	}

	return best?.label ?? null;
}

/** Fallback: use the midpoint of the activity records to look up a location. */
function inferLocationFromRecords(_records: StoredRecord[]): string | null {
	// Reverse geocoding is intentionally not implemented to avoid external
	// API dependencies. Activities imported from Strava already carry location
	// fields in their summary; FIT uploads have no location metadata today.
	return null;
}

/**
 * Hawley–Noakes cycling VO₂max estimate from peak power output (PPO).
 *   VO₂max (ml/kg/min) = 10.8 × (PPO / kg) + 7
 * PPO is estimated as best 20-min peak power × 1.20, since PPO from a
 * ramp test is typically 15–20% above 20-min sustainable power.
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
		const estimatedPpo = bestPeak20min * 1.2;
		const vo2mlKgMin = vo2maxFromPowerAndMass(estimatedPpo, weightKg);
		estimatedVo2max = Math.round(vo2mlKgMin * 10) / 10;
	} else {
		const restingHR = healthData?.rhr?.current ?? null;
		if (maxHeartRate > 0 && restingHR != null && restingHR > 0) {
			estimatedVo2max = Math.round(15.3 * (maxHeartRate / restingHR) * 10) / 10;
		}
	}

	return { estimatedFtp, estimatedVo2max };
}
