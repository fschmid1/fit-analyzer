// --- Core activity types ---

export interface ActivityRecord {
	timestamp: Date;
	elapsedSeconds: number;
	power: number | null;
	heartRate: number | null;
	cadence: number | null;
	speed: number | null;
	gradient: number | null;
	lat: number | null;
	lng: number | null;
}

export interface ActivitySummary {
	date: string;
	totalTimerTime: number;
	totalDistanceKm: number | null;
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
	lat: number | null;
	lng: number | null;
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

export interface CoachModelSettings {
	coachModel: string;
}

export interface UpdateCoachModelSettingsBody {
	coachModel: string;
}

export interface UpdateFavoriteModelsBody {
	favoriteModels: string[];
}

export interface OpenwearablesSettings {
	owUserId: string | null;
}

export interface UpdateOpenwearablesSettingsBody {
	owUserId: string;
}

// --- Health & stats types ---

export interface SleepStages {
	awakeMinutes: number;
	lightMinutes: number;
	deepMinutes: number;
	remMinutes: number;
}

export interface RecentNight {
	date: string;
	durationMinutes: number;
	durationFormatted: string;
	quality: string | null;
	efficiencyPercent: number | null;
	stages: SleepStages | null;
}

export interface HealthData {
	rhr: {
		current: number | null;
		trend7d: number | null;
		elevated: boolean;
	} | null;
	hrv: {
		current: number | null;
		trend7d: number | null;
		declining: boolean;
	} | null;
	sleep: {
		recentNights: RecentNight[];
		avgDurationMinutes7d: number | null;
		avgDurationFormatted7d: string | null;
		avgEfficiencyPercent7d: number | null;
		avgStages7d: SleepStages | null;
	} | null;
}

export interface ActivityStats {
	count: number;
	totalDurationSeconds: number;
	totalDurationFormatted: string;
	totalDistanceKm: number | null;
	avgPower: number | null;
	maxPower: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	avgCadence: number | null;
	peak1minPower: number | null;
	peak5minPower: number | null;
	totalWork: number | null;
}

// --- Heatmap types ---

export interface HeatmapPoint {
	lat: number;
	lng: number;
}

export interface HeatmapResponse {
	points: HeatmapPoint[];
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
	coachModel: string | null;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

/** Response body for GET /api/trainer/history/:threadId */
export interface TrainerChatHistory {
	threadId: string; // was activityId
	messages: TrainerMessage[];
	updatedAt: string;
}

/** PUT body for saving chat history */
export interface SaveTrainerHistoryBody {
	messages: TrainerMessage[];
}

// --- Strava clubs & events types ---

export interface StravaClub {
	id: number;
	name: string;
	description: string | null;
	sportType: string;
	city: string | null;
	state: string | null;
	country: string | null;
	memberCount: number;
	coverPhoto: string | null;
}

export interface StravaClubEvent {
	id: number;
	clubId: number;
	clubName: string;
	title: string;
	sportType: string;
	description: string | null;
	address: string | null;
	city: string | null;
	state: string | null;
	route: { id: string; name: string } | null;
	organizer: { id: number; name: string } | null;
	participantCount: number | null;
	upcomingOccurrences: string[];
	isPast: boolean;
}
