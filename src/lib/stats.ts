import type { ActivityRecord, Interval, LapMarker, SelectionStats } from "../types/fit";

export function computeAverages(records: ActivityRecord[]): SelectionStats {
  if (records.length === 0) {
    return { avgPower: null, avgHeartRate: null, avgCadence: null, duration: 0 };
  }

  const validPower = records.filter((r) => r.power !== null);
  const validHR = records.filter((r) => r.heartRate !== null);
  const validCadence = records.filter((r) => r.cadence !== null);

  return {
    avgPower: validPower.length
      ? Math.round(
          validPower.reduce((s, r) => s + r.power!, 0) / validPower.length
        )
      : null,
    avgHeartRate: validHR.length
      ? Math.round(
          validHR.reduce((s, r) => s + r.heartRate!, 0) / validHR.length
        )
      : null,
    avgCadence: validCadence.length
      ? Math.round(
          validCadence.reduce((s, r) => s + r.cadence!, 0) / validCadence.length
        )
      : null,
    duration:
      records[records.length - 1].elapsedSeconds - records[0].elapsedSeconds,
  };
}

/**
 * Sliding window best average power over a given duration.
 * Returns null if there aren't enough data points.
 */
export function computePeakPower(
  records: ActivityRecord[],
  windowSeconds: number
): number | null {
  const powerRecords = records.filter((r) => r.power !== null);
  if (powerRecords.length === 0) return null;

  // Build a time-indexed power array using elapsed seconds
  // We need contiguous second-by-second data for proper sliding window
  const maxTime = records[records.length - 1].elapsedSeconds;
  if (maxTime < windowSeconds) return null;

  // Create a second-by-second power array with interpolation for gaps
  const powerBySecond: (number | null)[] = new Array(Math.floor(maxTime) + 1).fill(null);
  for (const r of records) {
    if (r.power !== null) {
      const sec = Math.floor(r.elapsedSeconds);
      powerBySecond[sec] = r.power;
    }
  }

  let best = 0;
  let windowSum = 0;
  let windowCount = 0;

  // Initialize first window
  for (let i = 0; i < windowSeconds && i < powerBySecond.length; i++) {
    if (powerBySecond[i] !== null) {
      windowSum += powerBySecond[i]!;
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
 * Generate one interval per lap marker, each starting at the lap's start
 * and lasting `intervalSeconds` (capped at activity end).
 */
export function computeIntervals(
  records: ActivityRecord[],
  laps: LapMarker[],
  intervalSeconds: number
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
      (r) => r.elapsedSeconds >= start && r.elapsedSeconds <= end
    );

    const stats = slice.length > 0 ? computeAverages(slice) : { avgPower: null, avgHeartRate: null, avgCadence: null };

    return {
      index: idx,
      startSeconds: start,
      endSeconds: end,
      avgPower: stats.avgPower,
      avgHeartRate: stats.avgHeartRate,
      avgCadence: stats.avgCadence,
      duration: end - start,
    };
  });
}
