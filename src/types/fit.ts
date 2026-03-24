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
