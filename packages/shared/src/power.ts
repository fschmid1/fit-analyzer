import type { ActivityRecord } from "./types.js";

const NP_WINDOW_SECONDS = 30;

/*
 * Reusable helper: given a per-second numeric array and a window size,
 * compute the rolling average raised to the 4th power, then the 4th root.
 * Zeros and gaps are treated as zero.
 */
function normalizedMetricFromSeconds(
	valuesBySecond: (number | null)[],
	windowSeconds: number,
): number | null {
	if (valuesBySecond.length < windowSeconds) return null;

	let sum = 0;
	for (let i = 0; i < windowSeconds; i++) {
		sum += valuesBySecond[i] ?? 0;
	}

	const fourthPowers: number[] = [];
	fourthPowers.push((sum / windowSeconds) ** 4);

	for (let i = windowSeconds; i < valuesBySecond.length; i++) {
		sum += (valuesBySecond[i] ?? 0) - (valuesBySecond[i - windowSeconds] ?? 0);
		fourthPowers.push((sum / windowSeconds) ** 4);
	}

	const meanOfFourth =
		fourthPowers.reduce((a, b) => a + b, 0) / fourthPowers.length;
	const nm = meanOfFourth ** 0.25;
	return nm > 0 ? Math.round(nm) : null;
}

/**
 * Build a second-by-second array from records for a given numeric key,
 * rebasing elapsedSeconds so the first record sits at index 0 and
 * carrying the last known value forward across seconds without a sample.
 * Assumes records are non-empty and sorted by elapsedSeconds.
 */
function buildMetricBySecond<K extends keyof ActivityRecord>(
	records: ActivityRecord[],
	key: K,
): (number | null)[] {
	const startTime = records[0].elapsedSeconds;
	const endTime = records[records.length - 1].elapsedSeconds;
	const length = Math.floor(endTime - startTime) + 1;
	const bySecond: (number | null)[] = new Array(length).fill(null);

	let recordIdx = 0;
	let lastValue: number | null = null;
	for (let s = 0; s < length; s++) {
		const absoluteSec = startTime + s;
		while (
			recordIdx < records.length &&
			records[recordIdx].elapsedSeconds <= absoluteSec + 0.5
		) {
			const val = records[recordIdx][key];
			if (typeof val === "number") {
				lastValue = val;
			}
			recordIdx++;
		}
		bySecond[s] = lastValue;
	}
	return bySecond;
}

/**
 * Build a second-by-second power array from records.
 */
export function buildPowerBySecond(
	records: ActivityRecord[],
): (number | null)[] {
	return buildMetricBySecond(records, "power");
}

/**
 * Build a second-by-second cadence array from records.
 */
export function buildCadenceBySecond(
	records: ActivityRecord[],
): (number | null)[] {
	return buildMetricBySecond(records, "cadence");
}

/**
 * Compute the best average power for a rolling time window (in seconds)
 * from a per-second power array. Gaps (null or zero) are ignored in the
 * average. Returns null if there aren't enough data points.
 */
export function peakPowerFromSeconds(
	powerBySecond: (number | null)[],
	windowSeconds: number,
): number | null {
	if (powerBySecond.length === 0 || powerBySecond.length - 1 < windowSeconds)
		return null;

	let best = 0;
	let windowSum = 0;
	let windowCount = 0;

	// Initialize first window
	for (let i = 0; i < windowSeconds && i < powerBySecond.length; i++) {
		const power = powerBySecond[i];
		if (power != null && power > 0) {
			windowSum += power;
			windowCount++;
		}
	}

	if (windowCount > 0) {
		best = windowSum / windowCount;
	}

	// Slide the window
	for (let i = windowSeconds; i < powerBySecond.length; i++) {
		const entering = powerBySecond[i];
		const leaving = powerBySecond[i - windowSeconds];

		if (entering != null && entering > 0) {
			windowSum += entering;
			windowCount++;
		}
		if (leaving != null && leaving > 0) {
			windowSum -= leaving;
			windowCount--;
		}

		if (windowCount > 0) {
			const avg = windowSum / windowCount;
			if (avg > best) best = avg;
		}
	}

	return best > 0 ? Math.round(best) : null;
}

export function computeNormalizedPower(
	records: ActivityRecord[],
): number | null {
	if (records.length === 0) return null;
	const powerBySecond = buildPowerBySecond(records);
	return normalizedPowerFromSeconds(powerBySecond);
}

/**
 * Compute Normalized Power from a per-second power series. Each entry is
 * the power for that second (in watts), or null for a gap which is treated
 * as zero. Used directly by the Strava importer, which already builds a
 * per-second array from its time/watts streams.
 */
export function normalizedPowerFromSeconds(
	powerBySecond: (number | null)[],
): number | null {
	return normalizedMetricFromSeconds(powerBySecond, NP_WINDOW_SECONDS);
}

/**
 * Compute Normalized Cadence from records using the same rolling formula
 * as NP but applied to per-second cadence. Zeros and gaps are treated as
 * zero cadence. Returns null if there isn't enough data.
 */
export function computeNormalizedCadence(
	records: ActivityRecord[],
): number | null {
	if (records.length === 0) return null;
	const cadenceBySecond = buildCadenceBySecond(records);
	return normalizedCadenceFromSeconds(cadenceBySecond);
}

/**
 * Compute Normalized Cadence from a per-second cadence series. Each entry
 * is the cadence for that second (in rpm), or null for a gap which is
 * treated as zero.
 */
export function normalizedCadenceFromSeconds(
	cadenceBySecond: (number | null)[],
): number | null {
	return normalizedMetricFromSeconds(cadenceBySecond, NP_WINDOW_SECONDS);
}
