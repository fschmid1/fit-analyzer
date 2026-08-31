import type { SettingsDomainId } from "./integrationsStatus";

/**
 * One configurable domain of the settings page: a stable id plus display
 * metadata. Layout variants render the same domain list in their own
 * structure — ids are the contract.
 */
export interface SettingsDomain {
	id: SettingsDomainId;
	/** One- or two-word name, used for nav items and row titles. */
	name: string;
	/** Single line describing what the domain controls. */
	blurb: string;
	/** Group this domain belongs to; variants decide how to render groups. */
	group: "Integrations" | "Coach" | "Maintenance";
}

export const SETTINGS_DOMAINS: SettingsDomain[] = [
	{
		id: "strava",
		name: "Strava",
		blurb: "Sync rides from Strava, with optional webhook auto-import.",
		group: "Integrations",
	},
	{
		id: "wahoo",
		name: "Wahoo",
		blurb: "Sync indoor and outdoor workouts from the Wahoo cloud.",
		group: "Integrations",
	},
	{
		id: "calendar",
		name: "Training calendar",
		blurb: "Coach-scheduled workouts on a Google calendar.",
		group: "Integrations",
	},
	{
		id: "openwearables",
		name: "OpenWearables",
		blurb: "Wearable data (RHR, sleep, HRV) for the coach.",
		group: "Integrations",
	},
	{
		id: "hae",
		name: "Health Auto Export",
		blurb: "Apple Health data pushed from your phone.",
		group: "Integrations",
	},
	{
		id: "profile",
		name: "Athlete profile",
		blurb: "FTP, max HR, goals and weekly hours the coach plans around.",
		group: "Coach",
	},
	{
		id: "zones",
		name: "Zone overrides",
		blurb: "Custom power and heart-rate zone boundaries.",
		group: "Coach",
	},
	{
		id: "coachModel",
		name: "Coach model",
		blurb: "Which AI model answers in trainer chat.",
		group: "Coach",
	},
	{
		id: "waxed",
		name: "Waxed chain reminders",
		blurb: "ntfy notification when rides cross a maintenance threshold.",
		group: "Maintenance",
	},
	{
		id: "changelog",
		name: "Change history",
		blurb: "Recent profile and zone updates by you or the trainer.",
		group: "Maintenance",
	},
];
