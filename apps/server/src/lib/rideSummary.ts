import {
	normalizedCadenceFromSeconds,
	normalizedPowerFromSeconds,
	buildMetricBySecondFromTimeSeries,
	peakPowerFromTimeSeries,
	type ActivitySummary,
	type StoredRecord,
} from "@fit-analyzer/shared";

/**
 * Compute an activity summary from per-second records alone. Shared by every
 * activity importer (Strava, Wahoo, intervals.icu): the devices record at 1 Hz,
 * so a simple mean of non-zero samples matches Garmin's session record, and the
 * peak-power/NP helpers work off the same series.
 *
 * Nothing here takes a provider's pre-computed fields — the same ride imported
 * from two providers must summarise identically.
 */
export function summarizeRideRecords(input: {
	date: string;
	durationSeconds: number;
	distanceMeters: number | null;
	records: StoredRecord[];
	location?: {
		city: string | null;
		state: string | null;
		country: string | null;
	} | null;
}): ActivitySummary {
	const { records } = input;
	const timeArr = records.map((r) => r.elapsedSeconds);
	const wattsArr = records.map((r) => r.power ?? 0);
	const cadenceArr = records.map((r) => r.cadence ?? 0);

	const powerVals = records
		.map((r) => r.power)
		.filter((v): v is number => v !== null && v > 0);
	const hrVals = records
		.map((r) => r.heartRate)
		.filter((v): v is number => v !== null && v > 0);
	const cadVals = records
		.map((r) => r.cadence)
		.filter((v): v is number => v !== null && v > 0);

	const avg = (vals: number[]) =>
		vals.length
			? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
			: null;
	const max = (vals: number[]) =>
		vals.length ? vals.reduce((m, v) => (v > m ? v : m), vals[0]) : null;

	// Total work: ∫ power dt (W·s = J), nulls treated as 0W.
	let totalWork: number | null = null;
	if (records.length > 0) {
		let joules = 0;
		for (let i = 0; i < records.length; i++) {
			const dt = i === 0 ? timeArr[0] : timeArr[i] - timeArr[i - 1];
			joules += (records[i].power ?? 0) * dt;
		}
		totalWork = Math.round(joules);
	}

	return {
		date: input.date,
		totalTimerTime: input.durationSeconds,
		totalDistanceKm:
			input.distanceMeters != null
				? Math.round((input.distanceMeters / 1000) * 10) / 10
				: null,
		avgPower: avg(powerVals),
		normalizedPower: normalizedPowerFromSeconds(
			buildMetricBySecondFromTimeSeries(timeArr, wattsArr),
		),
		maxPower: max(powerVals),
		avgHeartRate: avg(hrVals),
		maxHeartRate: max(hrVals),
		avgCadence: avg(cadVals),
		normalizedCadence: normalizedCadenceFromSeconds(
			buildMetricBySecondFromTimeSeries(timeArr, cadenceArr),
		),
		totalWork,
		peak1minPower: peakPowerFromTimeSeries(timeArr, wattsArr, 60),
		peak5minPower: peakPowerFromTimeSeries(timeArr, wattsArr, 300),
		peak20minPower: peakPowerFromTimeSeries(timeArr, wattsArr, 1200),
		locationCity: input.location?.city ?? null,
		locationState: input.location?.state ?? null,
		locationCountry: input.location?.country ?? null,
	};
}
