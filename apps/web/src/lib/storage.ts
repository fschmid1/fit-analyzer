import type { ParsedActivity, ActivityRecord } from "@fit-analyzer/shared";

const ACTIVITY_KEY = "fit-analyzer:activity";
const CUSTOM_INTERVALS_KEY = "fit-analyzer:customIntervals";
const INTERVAL_MINUTES_KEY = "fit-analyzer:intervalMinutes";

// --- Activity ---

interface StoredActivity {
  records: {
    timestamp: string; // ISO string
    elapsedSeconds: number;
    power: number | null;
    heartRate: number | null;
    cadence: number | null;
  }[];
  summary: ParsedActivity["summary"];
  laps: ParsedActivity["laps"];
}

export function saveActivity(activity: ParsedActivity): void {
  try {
    const stored: StoredActivity = {
      records: activity.records.map((r: ActivityRecord) => ({
        ...r,
        timestamp: r.timestamp.toISOString(),
      })),
      summary: activity.summary,
      laps: activity.laps,
    };
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function loadActivity(): ParsedActivity | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return null;
    const stored: StoredActivity = JSON.parse(raw);
    return {
      records: stored.records.map((r) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      })),
      summary: stored.summary,
      laps: stored.laps,
    };
  } catch {
    localStorage.removeItem(ACTIVITY_KEY);
    return null;
  }
}

export function clearActivity(): void {
  localStorage.removeItem(ACTIVITY_KEY);
}

// --- Custom intervals ---

export function saveCustomIntervals(intervals: [number, number][]): void {
  try {
    localStorage.setItem(CUSTOM_INTERVALS_KEY, JSON.stringify(intervals));
  } catch {
    // ignore
  }
}

export function loadCustomIntervals(): [number, number][] {
  try {
    const raw = localStorage.getItem(CUSTOM_INTERVALS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(CUSTOM_INTERVALS_KEY);
    return [];
  }
}

export function clearCustomIntervals(): void {
  localStorage.removeItem(CUSTOM_INTERVALS_KEY);
}

// --- Interval length (minutes input) ---

export function saveIntervalMinutes(value: string): void {
  try {
    localStorage.setItem(INTERVAL_MINUTES_KEY, value);
  } catch {
    // ignore
  }
}

export function loadIntervalMinutes(): string {
  return localStorage.getItem(INTERVAL_MINUTES_KEY) ?? "";
}

export function clearIntervalMinutes(): void {
  localStorage.removeItem(INTERVAL_MINUTES_KEY);
}
