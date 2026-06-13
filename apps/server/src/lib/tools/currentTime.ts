import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

export const currentTimeDefinition: ToolDefinition = {
	name: "current_time",
	description:
		"Get the current date and time in UTC. You MUST call this tool FIRST whenever the user mentions relative dates (yesterday, last week, last Tuesday, etc.) or when you need to compute absolute dates for any tool lookup. Never assume or guess the current date.",
	parameters: {
		type: "object",
		properties: {},
		required: [],
	},
};

export const currentTimeHandler: ToolHandler = async () => {
	const now = new Date();
	const iso = now.toISOString();
	const utcDate = iso.split("T")[0];
	const utcTime = iso.split("T")[1].split(".")[0];
	const dayOfWeek = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	][now.getUTCDay()];

	const content = [
		`Current UTC date: ${utcDate}`,
		`Current UTC time: ${utcTime}`,
		`Day of week: ${dayOfWeek}`,
		`ISO 8601: ${iso}`,
	].join("\n");

	return {
		id: "",
		name: "current_time",
		content,
		display: {
			utcDate,
			utcTime,
			dayOfWeek,
			iso,
		},
	};
};
