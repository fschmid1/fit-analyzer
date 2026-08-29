import type { ReactNode } from "react";
import { renderTrainingLoad } from "./renderTrainingLoad";
import { renderPowerCurve } from "./renderPowerCurve";
import { renderWeatherHistory } from "./renderWeatherHistory";
import { renderZoneAnalysis } from "./renderZoneAnalysis";
import { renderActivityLookup } from "./renderActivityLookup";
import { renderEventCountdown } from "./renderEventCountdown";
import { renderTrendAnalysis } from "./renderTrendAnalysis";
import { renderWorkoutGenerator } from "./renderWorkoutGenerator";
import { renderCardiacDrift } from "./renderCardiacDrift";
import { renderRideRecommendation } from "./renderRideRecommendation";
import { renderHighlightChart } from "./renderHighlightChart";
import { renderUpdateProfile } from "./renderUpdateProfile";
import { renderSetZones, renderResetZones } from "./renderSetZones";
import {
	renderCalendarSync,
	renderCalendarRemoval,
} from "./renderCalendarSync";

const TOOL_RENDERERS: Record<string, (display: unknown) => ReactNode | null> = {
	training_load: renderTrainingLoad,
	power_curve: renderPowerCurve,
	weather_history: renderWeatherHistory,
	zone_analysis: renderZoneAnalysis,
	activity_lookup: renderActivityLookup,
	event_countdown: renderEventCountdown,
	trend_analysis: renderTrendAnalysis,
	workout_generator: renderWorkoutGenerator,
	cardiac_drift: renderCardiacDrift,
	ride_recommendation: renderRideRecommendation,
	highlight_chart: renderHighlightChart,
	update_profile: renderUpdateProfile,
	set_zones: renderSetZones,
	reset_zones: renderResetZones,
	add_workouts_to_calendar: renderCalendarSync,
	remove_workouts_from_calendar: renderCalendarRemoval,
};

export function renderToolDisplay(
	toolName: string,
	display: unknown,
): ReactNode | null {
	const renderer = TOOL_RENDERERS[toolName];
	if (!renderer) return null;
	try {
		return renderer(display);
	} catch {
		return null;
	}
}
