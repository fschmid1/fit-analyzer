// --- Core activity types ---

export interface ActivityRecord {
  timestamp: Date;
  elapsedSeconds: number;
  power: number | null;
  heartRate: number | null;
  cadence: number | null;
}

export interface ActivitySummary {
  date: string;
  totalTimerTime: number;
  avgPower: number | null;
  maxPower: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  totalWork: number | null;
  peak1minPower: number | null;
  peak5minPower: number | null;
}

export interface LapMarker {
  startSeconds: number;
  endSeconds: number;
  avgPower: number | null;
  avgHeartRate: number | null;
  avgCadence: number | null;
}

export interface ParsedActivity {
  records: ActivityRecord[];
  summary: ActivitySummary;
  laps: LapMarker[];
}

export interface Interval {
  index: number;
  startSeconds: number;
  endSeconds: number;
  avgPower: number | null;
  avgHeartRate: number | null;
  avgCadence: number | null;
  duration: number;
}

export interface SelectionStats {
  avgPower: number | null;
  avgHeartRate: number | null;
  avgCadence: number | null;
  duration: number;
}

// --- API types ---

/** Serialized record for storage/transport (timestamps as ISO strings) */
export interface StoredRecord {
  timestamp: string;
  elapsedSeconds: number;
  power: number | null;
  heartRate: number | null;
  cadence: number | null;
}

/** Activity list item returned by GET /api/activities */
export interface ActivityListItem {
  id: string;
  date: string;
  summary: ActivitySummary;
  createdAt: string;
}

/** Full activity returned by GET /api/activities/:id */
export interface StoredActivity {
  id: string;
  date: string;
  summary: ActivitySummary;
  records: StoredRecord[];
  laps: LapMarker[];
  intervals: Interval[];
  intervalMinutes: string;
  customRanges: [number, number][];
  createdAt: string;
}

/** POST body for creating an activity */
export interface CreateActivityBody {
  summary: ActivitySummary;
  records: StoredRecord[];
  laps: LapMarker[];
  intervals?: Interval[];
}

/** Stored interval configuration for an activity */
export interface IntervalConfig {
  intervals: Interval[];
  intervalMinutes: string;
  customRanges: [number, number][];
}

/** PATCH body for updating activity intervals */
export interface UpdateIntervalsBody {
  intervals: Interval[];
  intervalMinutes: string;
  customRanges: [number, number][];
}
