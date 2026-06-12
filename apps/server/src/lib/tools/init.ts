import { registerTool } from "./registry.js";
import {
	activityLookupDefinition,
	activityLookupHandler,
} from "./activityLookup.js";
import {
	eventCountdownDefinition,
	eventCountdownHandler,
} from "./eventCountdown.js";
import { powerCurveDefinition, powerCurveHandler } from "./powerCurve.js";
import { trainingLoadDefinition, trainingLoadHandler } from "./trainingLoad.js";
import {
	weatherHistoryDefinition,
	weatherHistoryHandler,
} from "./weatherHistory.js";
import { webSearchDefinition, webSearchHandler } from "./webSearch.js";

let initialized = false;

export function initTools(): void {
	if (initialized) return;
	initialized = true;
	registerTool(webSearchDefinition, webSearchHandler);
	registerTool(activityLookupDefinition, activityLookupHandler);
	registerTool(trainingLoadDefinition, trainingLoadHandler);
	registerTool(weatherHistoryDefinition, weatherHistoryHandler);
	registerTool(powerCurveDefinition, powerCurveHandler);
	registerTool(eventCountdownDefinition, eventCountdownHandler);
}
