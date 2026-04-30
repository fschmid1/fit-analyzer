import { Hono } from "hono";
import type { UpdateWaxedChainReminderSettingsBody } from "@fit-analyzer/shared";
import {
  getWaxedChainReminderSettings,
  resetWaxedChainReminderProgress,
  sendTestWaxedChainReminder,
  updateWaxedChainReminderSettings,
} from "../lib/waxedChainReminders.js";

const me = new Hono();

function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
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
me.get("/settings", (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Not authenticated" }, 401);
  }

  return c.json({
    waxedChainReminder: getWaxedChainReminderSettings(userId),
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

  const body = await c.req.json<UpdateWaxedChainReminderSettingsBody>();
  const thresholdKm = Number(body.thresholdKm);
  const ntfyTopic = body.ntfyTopic?.trim() ?? "";

  if (typeof body.enabled !== "boolean") {
    return c.json({ error: "enabled must be a boolean" }, 400);
  }

  if (!Number.isFinite(thresholdKm) || thresholdKm <= 0) {
    return c.json({ error: "thresholdKm must be a positive number" }, 400);
  }

  if (body.enabled && !ntfyTopic) {
    return c.json({ error: "ntfyTopic is required when reminders are enabled" }, 400);
  }

  const settings = updateWaxedChainReminderSettings(userId, {
    enabled: body.enabled,
    thresholdKm,
    ntfyTopic,
  });

  return c.json({ waxedChainReminder: settings });
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
      { error: error instanceof Error ? error.message : "Failed to send test notification" },
      400
    );
  }
});

export { me };
