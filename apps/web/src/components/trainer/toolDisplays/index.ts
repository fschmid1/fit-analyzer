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
