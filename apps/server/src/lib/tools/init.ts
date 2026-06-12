import {
	activityLookupDefinition,
	activityLookupHandler,
} from "./activityLookup.js";
import {
	eventCountdownDefinition,
	eventCountdownHandler,
} from "./eventCountdown.js";
import { powerCurveDefinition, powerCurveHandler } from "./powerCurve.js";
import { registerTool } from "./registry.js";
import { trainingLoadDefinition, trainingLoadHandler } from "./trainingLoad.js";
import {
	weatherHistoryDefinition,
	weatherHistoryHandler,
} from "./weatherHistory.js";
import { webFetchDefinition, webFetchHandler } from "./webFetch.js";

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
}
