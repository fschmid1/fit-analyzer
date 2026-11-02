import type { ActivityRecord, Interval, SelectionStats } from "./types.js";
import {
	buildMetricBySecond,
	buildPowerBySecond,
	computeNormalizedCadence,
	computeNormalizedPower,
} from "./power.js";

/**
 * Window used to smooth a per-second metric before comparing it to a
 * threshold. A rolling median is used (rather than a mean) so a single
 * spike cannot start an interval and a short coasting gap cannot break
 * one. Flat blocks keep their exact edges.
 */
const SMOOTHING_WINDOW_SECONDS = 5;

const DEFAULT_COASTING_TOLERANCE_SECONDS = 5;

/**
 * Power only has to fall below this fraction of the threshold before an
 * effort is considered finished. A hard 4-minute effort typically dips to
 * 90–95% of its average for a few seconds (gear changes, a soft stroke);
 * using a hysteresis band keeps those dips from splitting one rep into
 * several. Genuine recoveries fall far below this line.
 */
const POWER_EXIT_THRESHOLD_RATIO = 0.85;

/**
 * Even inside the hysteresis band, close an effort once it has been below
 * the entry threshold for this long. This prevents a long sub-threshold
 * block (for example sweetspot after a threshold surge) from merging two
 * genuinely separate efforts.
 */
const MAX_SOFT_GAP_SECONDS = 30;

interface SecondRange {
	startIdx: number;
	endIdx: number;
}

/**
 * Rolling median over `windowSeconds`, clamped at the array edges.
 * Missing (`null`) samples count as zero so gaps pull the median down.
 */
function rollingMedian(
	values: (number | null)[],
	windowSeconds: number,
): (number | null)[] {
	if (windowSeconds <= 1) return values.slice();

	const half = Math.floor(windowSeconds / 2);
	const smoothed: (number | null)[] = new Array(values.length);

	for (let i = 0; i < values.length; i++) {
		const window: number[] = [];
		const from = Math.max(0, i - half);
		const to = Math.min(values.length - 1, i + half);
		for (let j = from; j <= to; j++) {
			window.push(values[j] ?? 0);
		}
		window.sort((a, b) => a - b);
		const mid = Math.floor(window.length / 2);
		smoothed[i] =
			window.length % 2 === 0
				? (window[mid - 1] + window[mid]) / 2
				: window[mid];
	}

	return smoothed;
}

/**
 * Find contiguous runs whose smoothed metric stays at or above
 * `enterThreshold`. A run remains open while the metric stays above
 * `exitThreshold` (a hysteresis band), and short gaps below the exit
 * threshold are tolerated for up to `toleranceSeconds`.
 *
 * The run ends at the last sample that was at or above the entry
 * threshold, so the hysteresis band does not pad the reported interval.
 */
function detectRuns(
	valuesBySecond: (number | null)[],
	enterThreshold: number,
	exitThreshold: number,
	toleranceSeconds: number,
): SecondRange[] {
	const smoothed = rollingMedian(valuesBySecond, SMOOTHING_WINDOW_SECONDS);
	const runs: SecondRange[] = [];

	let startIdx = -1;
	let lastAboveEnterIdx = -1;
	let lastAboveExitIdx = -1;

	for (let i = 0; i < smoothed.length; i++) {
		const value = smoothed[i];

		if (value !== null && value >= enterThreshold) {
			if (startIdx === -1) startIdx = i;
			lastAboveEnterIdx = i;
			lastAboveExitIdx = i;
			continue;
		}

		if (startIdx === -1) continue;

		if (value !== null && value >= exitThreshold) {
			lastAboveExitIdx = i;
		}

		const softGapExceeded = i - lastAboveEnterIdx > MAX_SOFT_GAP_SECONDS;
		const exitGapExceeded = i - lastAboveExitIdx > toleranceSeconds;
		if (softGapExceeded || exitGapExceeded) {
			runs.push({ startIdx, endIdx: lastAboveEnterIdx });
			startIdx = -1;
			lastAboveEnterIdx = -1;
			lastAboveExitIdx = -1;
		}
	}

	if (startIdx !== -1) {
		runs.push({ startIdx, endIdx: lastAboveEnterIdx });
	}

	return runs;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return Math.round(
		values.reduce((sum, value) => sum + value, 0) / values.length,
	);
}

function computeIntervalStats(records: ActivityRecord[]): SelectionStats {
	// Records with cadence 0 are coasting; exclude them from averages the
	// same way the UI's selection stats do.
	const included = records.filter((record) => record.cadence !== 0);
	const powers = included
		.map((record) => record.power)
		.filter((power): power is number => power !== null);
	const heartRates = included
		.map((record) => record.heartRate)
		.filter((hr): hr is number => hr !== null);
	const cadences = included
		.map((record) => record.cadence)
		.filter((cadence): cadence is number => cadence !== null);

	return {
		avgPower: average(powers),
		normalizedPower: computeNormalizedPower(records),
		avgHeartRate: average(heartRates),
		avgCadence: average(cadences),
		normalizedCadence: computeNormalizedCadence(records),
		duration: 0,
	};
}

interface IntervalOptions {
	/** Minimum interval duration in seconds. */
	minSeconds: number;
}

function runsToIntervals(
	records: ActivityRecord[],
	runs: SecondRange[],
	options: IntervalOptions,
): Interval[] {
	if (records.length === 0) return [];

	const baseElapsed = records[0].elapsedSeconds;
	const results: Interval[] = [];

	for (const run of runs) {
		// A run covers `startIdx..endIdx` inclusive. With one sample per
		// second that is `endIdx - startIdx + 1` seconds of effort.
		const duration = run.endIdx - run.startIdx + 1;
		if (duration < options.minSeconds) continue;

		const startSeconds = baseElapsed + run.startIdx;
		const endSeconds = baseElapsed + run.endIdx;
		const slice = records.filter(
			(record) =>
				record.elapsedSeconds >= startSeconds &&
				record.elapsedSeconds <= endSeconds,
		);
		if (slice.length === 0) continue;

		const stats = computeIntervalStats(slice);

		results.push({
			index: results.length,
			startSeconds,
			endSeconds,
			avgPower: stats.avgPower,
			normalizedPower: stats.normalizedPower,
			avgHeartRate: stats.avgHeartRate,
			avgCadence: stats.avgCadence,
			normalizedCadence: stats.normalizedCadence,
			duration,
		});
	}

	return results;
}

/**
 * Detect sustained power efforts in an activity.
 *
 * Each contiguous stretch where power stays at or above `minPower` for at
 * least `minSeconds` becomes one interval. Brief dips — even down to 85% of
 * the threshold for a few seconds — are bridged so they do not split one
 * rep into several. Genuine recoveries fall far below that band and end the
 * effort.
 *
 * This scans for efforts *inside* the ride. It does not compare whole
 * pedaling blocks to the threshold, which previously made it impossible to
 * find a hard 4-minute effort inside a mostly-endurance ride.
 *
 * `minPower` is a detection threshold, not a strict average: a 4-minute rep
 * that averages 261 W while being ridden at ~265 W can still be reported
 * when `minPower` is 262 W, because the dips are what pulled the average
 * down.
 */
export function detectPowerIntervals(
	records: ActivityRecord[],
	minPower: number,
	minSeconds: number,
	coastingToleranceSeconds = DEFAULT_COASTING_TOLERANCE_SECONDS,
): Interval[] {
	if (records.length === 0 || minPower <= 0 || minSeconds <= 0) return [];

	const powerBySecond = buildPowerBySecond(records);
	const runs = detectRuns(
		powerBySecond,
		minPower,
		minPower * POWER_EXIT_THRESHOLD_RATIO,
		Math.max(0, coastingToleranceSeconds),
	);

	return runsToIntervals(records, runs, { minSeconds });
}

/**
 * Detect sustained heart-rate efforts in an activity.
 *
 * Uses the same run detection as power: contiguous seconds at or above
 * `minHeartRate`, with short dips bridged.
 */
export function detectHeartRateIntervals(
	records: ActivityRecord[],
	minHeartRate: number,
	minSeconds: number,
	coastingToleranceSeconds = DEFAULT_COASTING_TOLERANCE_SECONDS,
): Interval[] {
	if (records.length === 0 || minHeartRate <= 0 || minSeconds <= 0) return [];

	const heartRateBySecond = buildMetricBySecond(records, "heartRate");
	const runs = detectRuns(
		heartRateBySecond,
		minHeartRate,
		minHeartRate,
		Math.max(0, coastingToleranceSeconds),
	);

	return runsToIntervals(records, runs, { minSeconds });
}
