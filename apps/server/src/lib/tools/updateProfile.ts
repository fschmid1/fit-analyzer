import type { ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { updateAthleteProfile } from "../athleteProfile.js";

export const updateProfileDefinition: ToolDefinition = {
	name: "update_profile",
	description:
		"Update the athlete's profile settings (FTP, max HR, goal event, weekly hours, focus areas). Use this when the athlete confirms a value you suggested, or when they explicitly ask you to update their profile.",
	parameters: {
		type: "object",
		properties: {
			ftp: {
				type: "number",
				description: "Functional Threshold Power in watts",
			},
			maxHr: {
				type: "number",
				description: "Maximum heart rate in bpm",
			},
			goalEventDate: {
				type: "string",
				description: "Target event date in YYYY-MM-DD format",
			},
			goalEventName: {
				type: "string",
				description: "Target event name",
			},
			goalDescription: {
				type: "string",
				description: "Description of the athlete's goal",
			},
			weeklyHours: {
				type: "number",
				description: "Available training hours per week",
			},
			focusAreas: {
				type: "string",
				description:
					"Comma-separated focus areas: endurance, threshold, vo2max, sprint, climbing, time-trial, recovery",
			},
		},
		required: [],
	},
};

type ProfileUpdate = Parameters<typeof updateAthleteProfile>[1];

export const updateProfileHandler: ToolHandler = async (args, context) => {
	const updates: ProfileUpdate = {};

	if (typeof args.ftp === "number" && args.ftp > 0) updates.ftp = args.ftp;
	if (typeof args.maxHr === "number" && args.maxHr > 0)
		updates.maxHr = args.maxHr;
	if (typeof args.goalEventDate === "string" && args.goalEventDate.trim())
		updates.goalEventDate = args.goalEventDate.trim();
	if (typeof args.goalEventName === "string" && args.goalEventName.trim())
		updates.goalEventName = args.goalEventName.trim();
	if (typeof args.goalDescription === "string" && args.goalDescription.trim())
		updates.goalDescription = args.goalDescription.trim();
	if (typeof args.weeklyHours === "number" && args.weeklyHours > 0)
		updates.weeklyHours = args.weeklyHours;
	if (typeof args.focusAreas === "string" && args.focusAreas.trim()) {
		updates.focusAreas = args.focusAreas
			.split(",")
			.map((s: string) => s.trim().toLowerCase())
			.filter(Boolean);
	}

	if (Object.keys(updates).length === 0) {
		return {
			id: "",
			name: "update_profile",
			content: "",
			display: null,
			error: "No profile fields provided to update.",
		};
	}

	const updated = updateAthleteProfile(context.userId, updates);

	const lines: string[] = ["Athlete profile updated:"];
	if (updates.ftp != null) lines.push(`- FTP: ${updated.ftp} W`);
	if (updates.maxHr != null) lines.push(`- Max HR: ${updated.maxHr} bpm`);
	if (updates.goalEventDate != null || updates.goalEventName != null) {
		lines.push(
			`- Goal Event: ${updated.goalEventName ?? "unset"} on ${updated.goalEventDate ?? "no date"}`,
		);
	}
	if (updates.goalDescription != null)
		lines.push(`- Goal: ${updated.goalDescription}`);
	if (updates.weeklyHours != null)
		lines.push(`- Weekly Hours: ${updated.weeklyHours}`);
	if (updates.focusAreas != null)
		lines.push(`- Focus Areas: ${updated.focusAreas.join(", ")}`);

	return {
		id: "",
		name: "update_profile",
		content: lines.join("\n"),
		display: {
			updated: Object.keys(updates),
			profile: updated,
		},
	};
};
