import { Hono } from "hono";
import type { UpdateWaxedChainReminderSettingsBody } from "@fit-analyzer/shared";
import {
	getCoachModelSettings,
	updateCoachModelSettings,
} from "../lib/coachModelSettings.js";
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
import { db } from "../db.js";

const me = new Hono();

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

	return c.json({
		waxedChainReminder: getWaxedChainReminderSettings(userId),
		coachModel: await getCoachModelSettings(userId),
		favoriteModels: getFavoriteModels(userId),
		openwearables: { owUserId: getOwUserId(userId) },
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
		Partial<UpdateWaxedChainReminderSettingsBody> & {
			coachModel?: string;
			favoriteModels?: string[];
			owUserId?: string;
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

	if (typeof body.owUserId === "string") {
		const trimmed = body.owUserId.trim();
		db.prepare(
			"INSERT INTO user_settings (user_id, ow_user_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET ow_user_id = excluded.ow_user_id",
		).run(userId, trimmed || null);
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

	return c.json({
		waxedChainReminder: getWaxedChainReminderSettings(userId),
		coachModel: await getCoachModelSettings(userId),
		favoriteModels: getFavoriteModels(userId),
		openwearables: { owUserId: getOwUserId(userId) },
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
