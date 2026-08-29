import { Hono } from "hono";
import type { UpdateCalendarTimezoneBody } from "@fit-analyzer/shared";
import { db } from "../db.js";
import { env } from "../env.js";
import { getUserId } from "../lib/getUserId.js";
import {
	consumeOAuthStateMeta,
	oauthStateStore,
	setOAuthStateMeta,
} from "../lib/oauthStateStore.js";
import {
	getCalendarContext,
	getGoogleConnection,
	googleFlow,
	googleTokenStore,
	isValidTimezone,
	setConnectionMetadata,
} from "../lib/googleCalendarConnection.js";
import { ensureTrainingCalendar } from "../lib/googleCalendarClient.js";

/**
 * Calendar connection routes: OAuth against Google plus the one-time setup
 * that creates (or reuses) the dedicated Training calendar and records the
 * training timezone captured by the browser at connect time. Domain logic
 * (token store, revocation, connection access) lives in
 * lib/googleCalendarConnection.ts.
 */

const google = new Hono();

const setTzStmt = db.prepare(
	"UPDATE google_tokens SET tz = ?, updated_at = datetime('now') WHERE user_id = ?",
);

/** GET /api/google/connect?tz=… — redirect to Google OAuth. */
google.get("/connect", (c) => {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
		return c.json(
			{ error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured" },
			501,
		);
	}
	if (!env.GOOGLE_REDIRECT_URI) {
		return c.json({ error: "GOOGLE_REDIRECT_URI is not configured" }, 501);
	}

	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const tzParam = c.req.query("tz") ?? "";
	if (!isValidTimezone(tzParam)) {
		return c.json(
			{ error: "Missing or invalid tz parameter (browser IANA timezone)" },
			400,
		);
	}

	const state = oauthStateStore.create(googleFlow.providerName, userId);
	// The training timezone is a property of the browser that starts the
	// flow; the callback is a different request, so it rides this state.
	setOAuthStateMeta(state, "tz", tzParam);

	return c.redirect(googleFlow.buildAuthorizeUrl(state));
});

/** GET /api/google/callback — exchange code, ensure Training calendar, persist tz. */
google.get("/callback", async (c) => {
	const { code, state, error } = c.req.query();
	if (error || !code || !state) {
		return c.redirect("/settings?google=error");
	}

	const userId = oauthStateStore.consume(googleFlow.providerName, state);
	if (!userId) {
		console.warn("[google] Invalid or expired state parameter");
		return c.redirect("/settings?google=error");
	}
	const tz = consumeOAuthStateMeta(state, "tz");
	if (!tz || !isValidTimezone(tz)) {
		console.warn("[google] Missing captured timezone for callback");
		return c.redirect("/settings?google=error");
	}

	try {
		const parsed = await googleFlow.exchangeCode(code);
		if (!parsed.refreshToken) {
			console.error("[google] No refresh token in exchange response");
			return c.redirect("/settings?google=error");
		}

		googleTokenStore.upsert({
			userId,
			accessToken: parsed.accessToken,
			refreshToken: parsed.refreshToken,
			expiresAt: parsed.expiresAt,
			providerUserId: null,
			scope: parsed.scope ?? "",
		});

		const { calendarId } = await ensureTrainingCalendar(parsed.accessToken, tz);
		setConnectionMetadata(userId, calendarId, tz);

		console.log(
			`[google] Connected user ${userId} to calendar ${calendarId} (tz ${tz})`,
		);
		return c.redirect("/settings?google=connected");
	} catch (err) {
		console.error("[google] Callback error:", err);
		return c.redirect("/settings?google=error");
	}
});

/** GET /api/google/status — Calendar connection status for the settings card. */
google.get("/status", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const connection = getGoogleConnection(userId);
	if (!connection)
		return c.json({
			connected: false,
			calendarId: null,
			timezone: null,
			calendarUrl: null,
		});

	return c.json({
		connected: true,
		calendarId: connection.calendarId,
		timezone: connection.tz,
		calendarUrl: connection.calendarId
			? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(connection.calendarId)}`
			: null,
	});
});

/** DELETE /api/google/disconnect — revoke + delete the token; the Training
 * calendar and its events deliberately survive. */
google.delete("/disconnect", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	await googleFlow.deauthorize(userId);
	return c.json({ ok: true });
});

/** PATCH /api/google/timezone — update the training timezone. */
google.patch("/timezone", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const body = await c.req.json<UpdateCalendarTimezoneBody>();
	if (!isValidTimezone(body.timezone)) {
		return c.json({ error: "Invalid timezone" }, 400);
	}

	setTzStmt.run(body.timezone, userId);
	return c.json({ ok: true });
});

export { google, getCalendarContext };
