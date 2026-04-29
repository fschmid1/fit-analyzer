// --- Core activity types ---

export interface ActivityRecord {
  timestamp: Date;
  elapsedSeconds: number;
  power: number | null;
  heartRate: number | null;
  cadence: number | null;
  speed: number | null;
  gradient: number | null;
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
  speed: number | null;
  gradient: number | null;
}

/** Activity list item returned by GET /api/activities */
export interface ActivityListItem {
  id: string;
  date: string;
  summary: ActivitySummary;
  createdAt: string;
  stravaActivityId?: string | null;
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

// --- User settings types ---

export interface WaxedChainReminderSettings {
  enabled: boolean;
  thresholdKm: number;
  ntfyTopic: string;
  accumulatedKm: number;
  remainingKm: number;
  lastNotifiedAt: string | null;
}

export interface UpdateWaxedChainReminderSettingsBody {
  enabled: boolean;
  thresholdKm: number;
  ntfyTopic: string;
}

// --- Trainer chat types ---

/** A single persisted trainer chat message */
export interface TrainerMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO-8601
}

/** A thread (conversation) within a trainer chat for an activity */
export interface TrainerThread {
  id: string;
  name: string;
  activityId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Response body for GET /api/trainer/history/:threadId */
export interface TrainerChatHistory {
  threadId: string;   // was activityId
  messages: TrainerMessage[];
  updatedAt: string;
}

/** PUT body for saving chat history */
export interface SaveTrainerHistoryBody {
  messages: TrainerMessage[];
}
