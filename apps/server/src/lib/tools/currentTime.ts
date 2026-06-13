import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

export const currentTimeDefinition: ToolDefinition = {
	name: "current_time",
	description:
		"Get the current date and time in UTC. Use this whenever you need to know the current date, time, day of the week, or relative time calculations.",
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
