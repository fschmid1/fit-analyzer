import type { ActivityRecord } from "./types.js";

const NP_WINDOW_SECONDS = 30;

/**
 * Build a second-by-second power array from records, rebasing elapsedSeconds
 * so the first record sits at index 0 and carrying the last known value
 * forward across seconds without a power sample. Assumes records are
 * non-empty and sorted by elapsedSeconds.
 */
export function buildPowerBySecond(
	records: ActivityRecord[],
): (number | null)[] {
	const startTime = records[0].elapsedSeconds;
	const endTime = records[records.length - 1].elapsedSeconds;
	const length = Math.floor(endTime - startTime) + 1;
	const powerBySecond: (number | null)[] = new Array(length).fill(null);

	let recordIdx = 0;
	let lastPower: number | null = null;
	for (let s = 0; s < length; s++) {
		const absoluteSec = startTime + s;
		while (
			recordIdx < records.length &&
			records[recordIdx].elapsedSeconds <= absoluteSec + 0.5
		) {
			if (records[recordIdx].power !== null) {
				lastPower = records[recordIdx].power;
			}
			recordIdx++;
		}
		powerBySecond[s] = lastPower;
	}
	return powerBySecond;
}

/**
 * Compute Normalized Power (NP) from records using the standard Coggan
 * formula: 30-second rolling averages of (interpolated) per-second power,
 * each raised to the 4th power, mean, then 4th root. Zeros and gaps are
 * treated as zero power. Returns null if there isn't enough data.
 */
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
	if (powerBySecond.length < NP_WINDOW_SECONDS) return null;

	let sum = 0;
	for (let i = 0; i < NP_WINDOW_SECONDS; i++) {
		sum += powerBySecond[i] ?? 0;
	}

	const fourthPowers: number[] = [];
	fourthPowers.push((sum / NP_WINDOW_SECONDS) ** 4);

	for (let i = NP_WINDOW_SECONDS; i < powerBySecond.length; i++) {
		sum +=
			(powerBySecond[i] ?? 0) - (powerBySecond[i - NP_WINDOW_SECONDS] ?? 0);
		fourthPowers.push((sum / NP_WINDOW_SECONDS) ** 4);
	}

	const meanOfFourth =
		fourthPowers.reduce((a, b) => a + b, 0) / fourthPowers.length;
	const np = meanOfFourth ** 0.25;
	return np > 0 ? Math.round(np) : null;
}
