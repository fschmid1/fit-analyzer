export type {
	ActivityRecord,
	ActivitySummary,
	LapMarker,
	ParsedActivity,
	Interval,
	SelectionStats,
	StoredRecord,
	ActivityListItem,
	StoredActivity,
	CreateActivityBody,
	IntervalConfig,
	UpdateIntervalsBody,
	WaxedChainReminderSettings,
	UpdateWaxedChainReminderSettingsBody,
	CoachModelSettings,
	UpdateCoachModelSettingsBody,
	TrainerMessage,
	TrainerThread,
	TrainerChatHistory,
	SaveTrainerHistoryBody,
} from "./types.js";

export {
	AVAILABLE_MODELS,
	getCoachModelDisplayName,
	getModelProvider,
} from "./coachModels.js";
export type { AvailableModelId, ModelEntry, Provider } from "./coachModels.js";
