import { Hono } from "hono";
import type {
	UpdateWaxedChainReminderSettingsBody,
	UpdateAthleteProfileBody,
	UpdateZoneOverridesBody,
	ZoneOverride,
	ProfileChangeEntry,
} from "@fit-analyzer/shared";
import {
	MAX_COACH_INSTRUCTIONS_LENGTH,
	isCoachInstructionsWithinLimit,
	isZoneOverrideArray,
	normalizeCoachInstructions,
	normalizeZoneOverrides,
} from "@fit-analyzer/shared";
import {
	getCoachInstructionsSettings,
	getCoachModelSettings,
	getCoachVerbositySettings,
	updateCoachInstructionsSettings,
	updateCoachModelSettings,
	updateCoachVerbositySettings,
} from "../lib/coachSettings.js";
import {
	getCompareSettings,
	updateCompareEnabled,
	updateCompareThreadIds,
} from "../lib/compareSettings.js";
import {
	getFavoriteModels,
	updateFavoriteModels,
} from "../lib/favoriteModels.js";
import { getOwUserId } from "../lib/owClient.js";
import {
	getWaxedChainReminderSettings,
	resetWaxedChainReminderProgress,
	sendTestWaxedChainReminder,
	updateWaxedChainReminderSettings,
} from "../lib/waxedChainReminders.js";
import { hasHaeToken, getHaeLastSync } from "../lib/haeClient.js";
import { getGoogleConnection } from "../lib/googleCalendarConnection.js";
import {
	getPlanRefreshSettings,
	updatePlanRefreshEnabled,
} from "../lib/planRefreshSettings.js";
import { getNtfyTopic, updateNtfyTopic } from "../lib/notificationSettings.js";
import { sendNtfy } from "../lib/ntfy.js";
import {
	getAthleteProfile,
	updateAthleteProfile,
} from "../lib/athleteProfile.js";
import { inferLocationFromActivities } from "../lib/athleteStats.js";
import { athleteZonesRepo } from "../lib/athleteZones.js";
import {
	profileChangesRepo,
	buildProfileDiff,
	buildZoneDiff,
} from "../lib/profileChanges.js";
import { buildUserZones, getUserEstimates } from "../lib/zonesService.js";
import { db } from "../db.js";
import { getUserId } from "../lib/getUserId.js";
import {
	getTrainingTimezone,
	setTrainingTimezone,
} from "../lib/trainingTimezone.js";
import { isValidTimezone } from "../lib/wallClock.js";

const me = new Hono();

// GET /me/athlete-estimates — heavy derived athlete data used by the settings page.
// Kept separate from /me/settings so the settings page can load fast and only
// request these estimates when the athlete profile card needs them.
me.get("/athlete-estimates", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const profile = getAthleteProfile(userId);
	const estimates = getUserEstimates(userId);
	return c.json({
		inferredLocation: profile.location
			? null
			: inferLocationFromActivities(userId),
		...estimates,
	});
});

// GET /me/zones — resolved power and heart-rate zones for the current athlete.
// Applies per-user overrides on top of derived defaults when present.
me.get("/zones", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const profile = getAthleteProfile(userId);
	const zones = buildUserZones(userId, profile, athleteZonesRepo);
	return c.json(zones, 200, { "Cache-Control": "no-store" });
});

// PUT /me/zones — replace the full override array for power and/or HR zones.
// Omitting a side leaves it unchanged. Passing null clears that side back to
// derived defaults.
me.put("/zones", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const body = await c.req.json<UpdateZoneOverridesBody>();

	// `undefined` = leave unchanged, `null` = clear, array = replace
	const hasPower = body.powerZones !== undefined;
	const hasHr = body.hrZones !== undefined;
	const clearPower = body.powerZones === null;
	const clearHr = body.hrZones === null;

	if (
		body.powerZones !== undefined &&
		body.powerZones !== null &&
		!isZoneOverrideArray(body.powerZones)
	) {
		return c.json({ error: "powerZones must be an array of zone ranges" }, 400);
	}
	if (
		body.hrZones !== undefined &&
		body.hrZones !== null &&
		!isZoneOverrideArray(body.hrZones)
	) {
		return c.json({ error: "hrZones must be an array of zone ranges" }, 400);
	}

	const before = athleteZonesRepo.get(userId);
	const nextPower = clearPower
		? null
		: hasPower
			? normalizeZoneOverrides(body.powerZones as ZoneOverride[])
			: before.powerZonesOverride;
	const nextHr = clearHr
		? null
		: hasHr
			? normalizeZoneOverrides(body.hrZones as ZoneOverride[])
			: before.hrZonesOverride;
	const after = athleteZonesRepo.upsert(userId, nextPower, nextHr);

	const diff = buildZoneDiff(before, after, hasPower, hasHr);
	profileChangesRepo.append(userId, "manual", diff);

	const profile = getAthleteProfile(userId);
	const zones = buildUserZones(userId, profile, athleteZonesRepo);
	return c.json(zones, 200, { "Cache-Control": "no-store" });
});

// POST /me/zones/reset — clear all zone overrides, return to pure derivation.
me.post("/zones/reset", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const before = athleteZonesRepo.get(userId);
	athleteZonesRepo.reset(userId);

	const hasPower = before.powerZonesOverride != null;
	const hasHr = before.hrZonesOverride != null;
	const diff = buildZoneDiff(
		before,
		{ powerZonesOverride: null, hrZonesOverride: null },
		hasPower,
		hasHr,
	);
	profileChangesRepo.append(userId, "manual", diff);

	const profile = getAthleteProfile(userId);
	const zones = buildUserZones(userId, profile, athleteZonesRepo);
	return c.json(zones, 200, { "Cache-Control": "no-store" });
});

// GET /me/profile-changes — recent changelog entries (profile + zones).
me.get("/profile-changes", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const entries: ProfileChangeEntry[] = profileChangesRepo.list(userId, 50);
	return c.json({ entries });
});

// GET /me — return the current user info from Authentik proxy headers
me.get("/", (c) => {
	const username = c.req.header("x-authentik-username") || "";
	const email = c.req.header("x-authentik-email") || "";
	const name = c.req.header("x-authentik-name") || "";

	if (!username) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	return c.json({ username, email, name });
});

// GET /me/training-timezone — the athlete's timezone, shared by every plan
// target (ADR-0005).
me.get("/training-timezone", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}
	return c.json({ timezone: getTrainingTimezone(userId) });
});

// PATCH /me/training-timezone — set the athlete's timezone.
me.patch("/training-timezone", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}
	const body = await c.req
		.json<{ timezone?: string }>()
		.catch(() => ({ timezone: undefined }));
	if (!body.timezone || !isValidTimezone(body.timezone)) {
		return c.json({ error: "Invalid timezone" }, 400);
	}
	setTrainingTimezone(userId, body.timezone);
	return c.json({ timezone: body.timezone });
});

// GET /me/settings — return persisted user settings
me.get("/settings", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const haeConfigured = hasHaeToken(userId);
	const haeLastSyncAt = getHaeLastSync(userId);

	// Fetch health_source
	const sourceRow = db
		.prepare("SELECT health_source FROM user_settings WHERE user_id = ?")
		.get(userId) as { health_source: string } | undefined;

	const profile = getAthleteProfile(userId);

	return c.json({
		waxedChainReminder: getWaxedChainReminderSettings(userId),
		coachModel: await getCoachModelSettings(userId),
		coachVerbosity: getCoachVerbositySettings(userId),
		coachInstructions: getCoachInstructionsSettings(userId),
		favoriteModels: getFavoriteModels(userId),
		openwearables: { owUserId: getOwUserId(userId) },
		compare: getCompareSettings(userId),
		planRefresh: getPlanRefreshSettings(userId),
		healthAutoExport: {
			apiKey: haeConfigured ? "••••••••" : null,
			configured: haeConfigured,
			healthSource: (sourceRow?.health_source ?? "openwearables") as
				| "openwearables"
				| "health_auto_export"
				| "auto",
			lastSyncAt: haeLastSyncAt,
		},
		athleteProfile: profile,
	});
});

// PATCH /me/settings — update persisted user settings
me.patch("/settings", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const body = await c.req.json<
		Partial<UpdateWaxedChainReminderSettingsBody> &
			Partial<UpdateAthleteProfileBody> & {
				coachModel?: string;
				coachVerbosity?: string;
				coachInstructions?: string;
				favoriteModels?: string[];
				owUserId?: string;
				compareThreadIds?: string[];
				compareEnabled?: boolean;
				healthSource?: string;
				ntfyTopic?: string;
				planRefreshEnabled?: boolean;
			}
	>();

	// Validate the free-form instructions before any field is written, so a
	// rejected request leaves the rest of the settings untouched.
	if (
		body.coachInstructions !== undefined &&
		typeof body.coachInstructions !== "string"
	) {
		return c.json({ error: "coachInstructions must be a string" }, 400);
	}
	const instructions =
		body.coachInstructions !== undefined
			? normalizeCoachInstructions(body.coachInstructions)
			: undefined;
	if (
		instructions !== undefined &&
		!isCoachInstructionsWithinLimit(instructions)
	) {
		return c.json(
			{
				error: `coachInstructions must be ${MAX_COACH_INSTRUCTIONS_LENGTH} characters or fewer`,
			},
			400,
		);
	}

	if (typeof body.coachModel === "string" && body.coachModel.trim()) {
		await updateCoachModelSettings(userId, {
			coachModel: body.coachModel.trim(),
		});
	}

	if (body.coachVerbosity !== undefined) {
		updateCoachVerbositySettings(userId, body.coachVerbosity);
	}

	if (instructions !== undefined) {
		updateCoachInstructionsSettings(userId, instructions);
	}

	if (Array.isArray(body.favoriteModels)) {
		updateFavoriteModels(userId, body.favoriteModels);
	}

	if (Array.isArray(body.compareThreadIds)) {
		updateCompareThreadIds(userId, body.compareThreadIds);
	}

	if (typeof body.compareEnabled === "boolean") {
		updateCompareEnabled(userId, body.compareEnabled);
	}

	const hasProfileUpdate =
		body.ftp !== undefined ||
		body.maxHr !== undefined ||
		body.goalEventDate !== undefined ||
		body.goalEventName !== undefined ||
		body.goalDescription !== undefined ||
		body.weeklyHours !== undefined ||
		body.focusAreas !== undefined ||
		body.location !== undefined;
	if (hasProfileUpdate) {
		const isPositiveNumberOrNull = (v: unknown): v is number | null =>
			v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);
		const isNullableString = (v: unknown): v is string | null =>
			v === null || typeof v === "string";
		const isStringArray = (v: unknown): v is string[] =>
			Array.isArray(v) && v.every((x) => typeof x === "string");

		if (
			(body.ftp !== undefined && !isPositiveNumberOrNull(body.ftp)) ||
			(body.maxHr !== undefined && !isPositiveNumberOrNull(body.maxHr)) ||
			(body.weeklyHours !== undefined &&
				!isPositiveNumberOrNull(body.weeklyHours)) ||
			(body.goalEventDate !== undefined &&
				!isNullableString(body.goalEventDate)) ||
			(body.goalEventName !== undefined &&
				!isNullableString(body.goalEventName)) ||
			(body.goalDescription !== undefined &&
				!isNullableString(body.goalDescription)) ||
			(body.focusAreas !== undefined && !isStringArray(body.focusAreas)) ||
			(body.location !== undefined && !isNullableString(body.location))
		) {
			return c.json({ error: "Invalid athleteProfile payload" }, 400);
		}

		const before = getAthleteProfile(userId);
		updateAthleteProfile(userId, {
			ftp: body.ftp,
			maxHr: body.maxHr,
			goalEventDate: body.goalEventDate,
			goalEventName: body.goalEventName,
			goalDescription: body.goalDescription,
			weeklyHours: body.weeklyHours,
			focusAreas: body.focusAreas,
			location: body.location,
		});
		const after = getAthleteProfile(userId);
		const diff = buildProfileDiff(
			before as unknown as Record<string, unknown>,
			after as unknown as Record<string, unknown>,
		);
		profileChangesRepo.append(userId, "manual", diff);
	}

	if (typeof body.owUserId === "string") {
		const trimmed = body.owUserId.trim();
		db.prepare(
			"INSERT INTO user_settings (user_id, ow_user_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ow_user_id = excluded.ow_user_id",
		).run(userId, trimmed || null);
	}

	if (
		body.healthSource === "openwearables" ||
		body.healthSource === "health_auto_export" ||
		body.healthSource === "auto"
	) {
		db.prepare(
			"INSERT INTO user_settings (user_id, health_source) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET health_source = excluded.health_source",
		).run(userId, body.healthSource);
	}

	if (typeof body.ntfyTopic === "string") {
		updateNtfyTopic(userId, body.ntfyTopic);
	}

	// Plan refresh requires a connected Calendar and a way to be told it ran.
	if (typeof body.planRefreshEnabled === "boolean") {
		if (body.planRefreshEnabled) {
			const connection = getGoogleConnection(userId);
			if (!connection?.calendarId || !connection.tz) {
				return c.json(
					{
						error:
							"Connect Google Calendar before enabling weekly plan refresh",
					},
					400,
				);
			}
		}
		updatePlanRefreshEnabled(userId, body.planRefreshEnabled);
	}

	if (body.enabled !== undefined || body.thresholdKm !== undefined) {
		const current = getWaxedChainReminderSettings(userId);
		const thresholdKm =
			body.thresholdKm !== undefined
				? Number(body.thresholdKm)
				: current.thresholdKm;
		const enabled = body.enabled !== undefined ? body.enabled : current.enabled;

		if (typeof enabled !== "boolean") {
			return c.json({ error: "enabled must be a boolean" }, 400);
		}

		if (!Number.isFinite(thresholdKm) || thresholdKm <= 0) {
			return c.json({ error: "thresholdKm must be a positive number" }, 400);
		}

		if (enabled && !getNtfyTopic(userId)) {
			return c.json(
				{ error: "ntfyTopic is required when reminders are enabled" },
				400,
			);
		}

		updateWaxedChainReminderSettings(userId, {
			enabled,
			thresholdKm,
			ntfyTopic: getNtfyTopic(userId),
		});
	}

	const haeConfigured = hasHaeToken(userId);
	const haeLastSyncAt = getHaeLastSync(userId);
	const sourceRow = db
		.prepare("SELECT health_source FROM user_settings WHERE user_id = ?")
		.get(userId) as { health_source: string } | undefined;

	const patchProfile = getAthleteProfile(userId);

	return c.json({
		waxedChainReminder: getWaxedChainReminderSettings(userId),
		coachModel: await getCoachModelSettings(userId),
		coachVerbosity: getCoachVerbositySettings(userId),
		coachInstructions: getCoachInstructionsSettings(userId),
		favoriteModels: getFavoriteModels(userId),
		openwearables: { owUserId: getOwUserId(userId) },
		compare: getCompareSettings(userId),
		planRefresh: getPlanRefreshSettings(userId),
		healthAutoExport: {
			apiKey: haeConfigured ? "••••••••" : null,
			configured: haeConfigured,
			healthSource: (sourceRow?.health_source ?? "openwearables") as
				| "openwearables"
				| "health_auto_export"
				| "auto",
			lastSyncAt: haeLastSyncAt,
		},
		athleteProfile: patchProfile,
	});
});

// POST /me/settings/waxed-chain/reset — reset persisted reminder progress
me.post("/settings/waxed-chain/reset", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const settings = resetWaxedChainReminderProgress(userId);
	return c.json({ waxedChainReminder: settings });
});

// POST /me/settings/waxed-chain/send-test — send a test notification
me.post("/settings/waxed-chain/send-test", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Not authenticated" }, 401);
	}

	try {
		await sendTestWaxedChainReminder(userId);
		return c.json({ ok: true });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to send test notification",
			},
			400,
		);
	}
});

export { me };
