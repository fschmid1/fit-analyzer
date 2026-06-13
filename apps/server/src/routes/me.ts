import { Hono } from "hono";
import type {
	UpdateWaxedChainReminderSettingsBody,
	UpdateAthleteProfileBody,
} from "@fit-analyzer/shared";
import {
	getCoachModelSettings,
	updateCoachModelSettings,
} from "../lib/coachModelSettings.js";
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
import {
	getAthleteProfile,
	updateAthleteProfile,
} from "../lib/athleteProfile.js";
import { computeAllTimeEstimates } from "../lib/athleteStats.js";
import { db } from "../db.js";

const me = new Hono();

const maxHrStmt = db.prepare(
	`SELECT MAX(CAST(json_extract(summary, '$.maxHeartRate') AS INTEGER)) as maxHr
     FROM activities WHERE user_id = ? AND json_extract(summary, '$.maxHeartRate') IS NOT NULL`,
);

function getUserEstimates(userId: string) {
	const { estimatedFtp } = computeAllTimeEstimates(userId, null);
	const row = maxHrStmt.get(userId) as { maxHr: number | null } | undefined;
	return { estimatedFtp, estimatedMaxHr: row?.maxHr ?? null };
}

function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) {
		throw new Error("Missing x-authentik-username header");
	}
	return userId;
}

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

	const estimates = getUserEstimates(userId);

	return c.json({
		waxedChainReminder: getWaxedChainReminderSettings(userId),
		coachModel: await getCoachModelSettings(userId),
		favoriteModels: getFavoriteModels(userId),
		openwearables: { owUserId: getOwUserId(userId) },
		compare: getCompareSettings(userId),
		healthAutoExport: {
			apiKey: haeConfigured ? "••••••••" : null,
			configured: haeConfigured,
			healthSource: (sourceRow?.health_source ?? "openwearables") as
				| "openwearables"
				| "health_auto_export"
				| "auto",
			lastSyncAt: haeLastSyncAt,
		},
		athleteProfile: getAthleteProfile(userId),
		...estimates,
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
				favoriteModels?: string[];
				owUserId?: string;
				compareThreadIds?: string[];
				compareEnabled?: boolean;
				healthSource?: string;
			}
	>();

	if (typeof body.coachModel === "string" && body.coachModel.trim()) {
		await updateCoachModelSettings(userId, {
			coachModel: body.coachModel.trim(),
		});
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
		body.focusAreas !== undefined;
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
			(body.focusAreas !== undefined && !isStringArray(body.focusAreas))
		) {
			return c.json({ error: "Invalid athleteProfile payload" }, 400);
		}

		updateAthleteProfile(userId, {
			ftp: body.ftp,
			maxHr: body.maxHr,
			goalEventDate: body.goalEventDate,
			goalEventName: body.goalEventName,
			goalDescription: body.goalDescription,
			weeklyHours: body.weeklyHours,
			focusAreas: body.focusAreas,
		});
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

	if (
		body.enabled !== undefined ||
		body.thresholdKm !== undefined ||
		body.ntfyTopic !== undefined
	) {
		const thresholdKm = Number(body.thresholdKm);
		const ntfyTopic = body.ntfyTopic?.trim() ?? "";

		if (typeof body.enabled !== "boolean") {
			return c.json({ error: "enabled must be a boolean" }, 400);
		}

		if (!Number.isFinite(thresholdKm) || thresholdKm <= 0) {
			return c.json({ error: "thresholdKm must be a positive number" }, 400);
		}

		if (body.enabled && !ntfyTopic) {
			return c.json(
				{ error: "ntfyTopic is required when reminders are enabled" },
				400,
			);
		}

		updateWaxedChainReminderSettings(userId, {
			enabled: body.enabled,
			thresholdKm,
			ntfyTopic,
		});
	}

	const haeConfigured = hasHaeToken(userId);
	const haeLastSyncAt = getHaeLastSync(userId);
	const sourceRow = db
		.prepare("SELECT health_source FROM user_settings WHERE user_id = ?")
		.get(userId) as { health_source: string } | undefined;

	const patchEstimates = getUserEstimates(userId);

	return c.json({
		waxedChainReminder: getWaxedChainReminderSettings(userId),
		coachModel: await getCoachModelSettings(userId),
		favoriteModels: getFavoriteModels(userId),
		openwearables: { owUserId: getOwUserId(userId) },
		compare: getCompareSettings(userId),
		healthAutoExport: {
			apiKey: haeConfigured ? "••••••••" : null,
			configured: haeConfigured,
			healthSource: (sourceRow?.health_source ?? "openwearables") as
				| "openwearables"
				| "health_auto_export"
				| "auto",
			lastSyncAt: haeLastSyncAt,
		},
		athleteProfile: getAthleteProfile(userId),
		...patchEstimates,
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
