import {
	activityLookupDefinition,
	activityLookupHandler,
} from "./activityLookup.js";
import {
	analyzeIntervalsDefinition,
	analyzeIntervalsHandler,
} from "./analyzeIntervals.js";
import { cardiacDriftDefinition, cardiacDriftHandler } from "./cardiacDrift.js";
import {
	compareActivitiesDefinition,
	compareActivitiesHandler,
} from "./compareActivities.js";
import {
	currentActivityDefinition,
	currentActivityHandler,
} from "./currentActivity.js";
import {
	eventCountdownDefinition,
	eventCountdownHandler,
} from "./eventCountdown.js";
import { powerCurveDefinition, powerCurveHandler } from "./powerCurve.js";
import { registerTool } from "./registry.js";
import {
	rideRecommendationDefinition,
	rideRecommendationHandler,
} from "./rideRecommendation.js";
import {
	segmentFinderDefinition,
	segmentFinderHandler,
} from "./segmentFinder.js";
import { trainingLoadDefinition, trainingLoadHandler } from "./trainingLoad.js";
import {
	trendAnalysisDefinition,
	trendAnalysisHandler,
} from "./trendAnalysis.js";
import {
	weatherHistoryDefinition,
	weatherHistoryHandler,
} from "./weatherHistory.js";
import { webFetchDefinition, webFetchHandler } from "./webFetch.js";
import {
	workoutGeneratorDefinition,
	workoutGeneratorHandler,
} from "./workoutGenerator.js";
import { zoneAnalysisDefinition, zoneAnalysisHandler } from "./zoneAnalysis.js";

let initialized = false;

export function initTools(): void {
	if (initialized) return;
	initialized = true;
	registerTool(webFetchDefinition, webFetchHandler);
	registerTool(activityLookupDefinition, activityLookupHandler);
	registerTool(trainingLoadDefinition, trainingLoadHandler);
	registerTool(weatherHistoryDefinition, weatherHistoryHandler);
	registerTool(powerCurveDefinition, powerCurveHandler);
	registerTool(eventCountdownDefinition, eventCountdownHandler);
	registerTool(currentActivityDefinition, currentActivityHandler);
	registerTool(zoneAnalysisDefinition, zoneAnalysisHandler);
	registerTool(analyzeIntervalsDefinition, analyzeIntervalsHandler);
	registerTool(compareActivitiesDefinition, compareActivitiesHandler);
	registerTool(segmentFinderDefinition, segmentFinderHandler);
	registerTool(trendAnalysisDefinition, trendAnalysisHandler);
	registerTool(workoutGeneratorDefinition, workoutGeneratorHandler);
	registerTool(cardiacDriftDefinition, cardiacDriftHandler);
	registerTool(rideRecommendationDefinition, rideRecommendationHandler);
}
