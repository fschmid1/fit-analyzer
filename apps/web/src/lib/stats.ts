import {
	buildPowerBySecond,
	computeNormalizedPower,
	type ActivityRecord,
	type Interval,
	type LapMarker,
	type SelectionStats,
} from "@fit-analyzer/shared";

const EMPTY_SELECTION_STATS: SelectionStats = {
	avgPower: null,
	normalizedPower: null,
	avgHeartRate: null,
	avgCadence: null,
	duration: 0,
};

export function computeAverages(records: ActivityRecord[]): SelectionStats {
	if (records.length === 0) {
		return EMPTY_SELECTION_STATS;
	}

	const includedRecords = records.filter((r) => r.cadence !== 0);
	const validPower = includedRecords.filter((r) => r.power !== null);
	const validHR = includedRecords.filter((r) => r.heartRate !== null);
	const validCadence = includedRecords.filter((r) => r.cadence !== null);
	const duration = records.slice(0, -1).reduce((total, record, index) => {
		if (record.cadence === 0) return total;

		const nextRecord = records[index + 1];
		const sampleDuration = nextRecord.elapsedSeconds - record.elapsedSeconds;

		return sampleDuration > 0 ? total + sampleDuration : total;
	}, 0);

	return {
		avgPower: validPower.length
			? Math.round(
					validPower.reduce((s, r) => s + (r.power ?? 0), 0) /
						validPower.length,
				)
			: null,
		normalizedPower: computeNormalizedPower(records),
		avgHeartRate: validHR.length
			? Math.round(
					validHR.reduce((s, r) => s + (r.heartRate ?? 0), 0) / validHR.length,
				)
			: null,
		avgCadence: validCadence.length
			? Math.round(
					validCadence.reduce((s, r) => s + (r.cadence ?? 0), 0) /
						validCadence.length,
				)
			: null,
		duration,
	};
}

/**
 * Sliding window best average power over a given duration.
 * Returns null if there aren't enough data points.
 */
export function computePeakPower(
	records: ActivityRecord[],
	windowSeconds: number,
): number | null {
	const powerRecords = records.filter((r) => r.power !== null);
	if (powerRecords.length === 0) return null;

	const powerBySecond = buildPowerBySecond(records);
	if (powerBySecond.length - 1 < windowSeconds) return null;

	let best = 0;
	let windowSum = 0;
	let windowCount = 0;

	// Initialize first window
	for (let i = 0; i < windowSeconds && i < powerBySecond.length; i++) {
		const power = powerBySecond[i];
		if (power !== null) {
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

		if (entering !== null) {
			windowSum += entering;
			windowCount++;
		}
		if (leaving !== null) {
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

/**
 * Scan records for contiguous blocks where power > 0, merge blocks
 * separated by gaps up to `coastingToleranceSeconds`, then filter to
 * only segments with avgPower >= minAvgPower and duration >= minSeconds.
 */
export function detectPowerIntervals(
	records: ActivityRecord[],
	minAvgPower: number,
	minSeconds: number,
	coastingToleranceSeconds = 2,
): Interval[] {
	if (records.length === 0 || minAvgPower <= 0 || minSeconds <= 0) return [];

	const segments: { startIdx: number; endIdx: number }[] = [];
	let segmentStart = -1;

	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		if (r.power !== null && r.power > 0) {
			if (segmentStart === -1) segmentStart = i;
		} else if (segmentStart !== -1) {
			segments.push({ startIdx: segmentStart, endIdx: i - 1 });
			segmentStart = -1;
		}
	}
	if (segmentStart !== -1) {
		segments.push({
			startIdx: segmentStart,
			endIdx: records.length - 1,
		});
	}

	const merged: { startIdx: number; endIdx: number }[] = [];
	let current: (typeof segments)[0] | null = null;

	for (const seg of segments) {
		if (!current) {
			current = seg;
			continue;
		}
		const gapEnd = records[current.endIdx].elapsedSeconds;
		const gapStart = records[seg.startIdx].elapsedSeconds;
		if (gapStart - gapEnd <= coastingToleranceSeconds) {
			current.endIdx = seg.endIdx;
		} else {
			merged.push(current);
			current = seg;
		}
	}
	if (current) merged.push(current);

	const results: Interval[] = [];
	if (merged.length === 0) return [];

	const maxSeconds = records[records.length - 1].elapsedSeconds;

	for (const seg of merged) {
		const startSeconds = records[seg.startIdx].elapsedSeconds;
		const endSeconds = Math.min(records[seg.endIdx].elapsedSeconds, maxSeconds);
		const duration = endSeconds - startSeconds;

		if (duration < minSeconds) continue;

		const slice = records.slice(seg.startIdx, seg.endIdx + 1);
		const stats = computeAverages(slice);

		if (stats.avgPower === null || stats.avgPower < minAvgPower) continue;

		results.push({
			index: results.length,
			startSeconds,
			endSeconds,
			avgPower: stats.avgPower,
			normalizedPower: stats.normalizedPower,
			avgHeartRate: stats.avgHeartRate,
			avgCadence: stats.avgCadence,
			duration,
		});
	}

	return results;
}

/**
 * Generate one interval per lap marker, each starting at the lap's start
 * and lasting `intervalSeconds` (capped at activity end).
 */
export function computeIntervals(
	records: ActivityRecord[],
	laps: LapMarker[],
	intervalSeconds: number,
): Interval[] {
	if (laps.length < 2 || intervalSeconds <= 0 || records.length === 0) {
		return [];
	}

	const maxSeconds = records[records.length - 1].elapsedSeconds;

	// Skip the first lap (warmup/start) — intervals begin from lap 2
	return laps.slice(1).map((lap, idx) => {
		const start = lap.startSeconds;
		const end = Math.min(start + intervalSeconds, maxSeconds);

		const slice = records.filter(
			(r) => r.elapsedSeconds >= start && r.elapsedSeconds <= end,
		);

		const stats =
			slice.length > 0 ? computeAverages(slice) : EMPTY_SELECTION_STATS;

		return {
			index: idx,
			startSeconds: start,
			endSeconds: end,
			avgPower: stats.avgPower,
			normalizedPower: stats.normalizedPower,
			avgHeartRate: stats.avgHeartRate,
			avgCadence: stats.avgCadence,
			duration: stats.duration,
		};
	});
}
