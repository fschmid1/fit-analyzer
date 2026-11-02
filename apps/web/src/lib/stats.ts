import {
	computeNormalizedPower,
	computeNormalizedCadence,
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
	normalizedCadence: null,
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
		normalizedCadence: computeNormalizedCadence(records),
		duration,
	};
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
			normalizedCadence: stats.normalizedCadence,
			duration: stats.duration,
		};
	});
}
