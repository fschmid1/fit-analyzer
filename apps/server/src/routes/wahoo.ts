import { Hono } from "hono";
import { db } from "../db.js";
import { env } from "../env.js";
import { importActivity } from "../lib/activityImporter.js";
import {
	defaultFitDownloader,
	wahooWorkoutToPayload,
	type WahooWorkout,
	type WahooWorkoutSummary,
	type WahooWorkoutsResponse,
} from "../lib/wahooImportAdapter.js";
import { getUserId } from "../lib/getUserId.js";
import { oauthStateStore } from "../lib/oauthStateStore.js";
import {
	type OAuth2Provider,
	type OAuth2TokenStore,
	type StoredToken,
	OAuth2Flow,
} from "../lib/oauth2.js";

const wahoo = new Hono();

// ─── Types ────────────────────────────────────────────────────────────────────

interface WahooTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
}

interface WahooUser {
	id: number;
	first: string;
	last: string;
	email?: string;
}

interface WahooWebhookEvent {
	event_type: "workout_summary";
	webhook_token: string;
	user: { id: number };
	workout_summary: WahooWorkoutSummary & {
		workout: Pick<
			WahooWorkout,
			"id" | "starts" | "minutes" | "name" | "workout_type_id"
		> & { workout_type_family_id?: number };
	};
}

// ─── OAuth2 provider + token store ────────────────────────────────────────────

interface WahooTokenRow {
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	wahoo_user_id: number | null;
	scope: string;
	webhook_enabled: number;
}

function rowToToken(row: WahooTokenRow): StoredToken {
	return {
		userId: row.user_id,
		accessToken: row.access_token,
		refreshToken: row.refresh_token,
		expiresAt: row.expires_at,
		providerUserId: row.wahoo_user_id,
		scope: row.scope,
	};
}

const WAHOO_SCOPE = "user_read user_write workouts_read offline_data";

const wahooProvider: OAuth2Provider = {
	name: "wahoo",
	authorizeUrl: "https://api.wahooligan.com/oauth/authorize",
	tokenUrl: "https://api.wahooligan.com/oauth/token",
	clientId: env.WAHOO_CLIENT_ID ?? "",
	clientSecret: env.WAHOO_CLIENT_SECRET ?? "",
	redirectUri: env.WAHOO_REDIRECT_URI ?? "",
	scope: WAHOO_SCOPE,
	// Wahoo requires redirect_uri in the code-for-token exchange.
	extraExchangeParams: { redirect_uri: env.WAHOO_REDIRECT_URI ?? "" },
	parseTokenResponse: (body) => {
		const b = body as WahooTokenResponse;
		return {
			accessToken: b.access_token,
			refreshToken: b.refresh_token,
			expiresAt: Math.floor(Date.now() / 1000) + b.expires_in,
			providerUserId: null, // fetched separately below
			scope: WAHOO_SCOPE,
		};
	},
	fetchProviderUserId: async (accessToken) => {
		const res = await fetch("https://api.wahooligan.com/v1/user", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!res.ok) {
			console.error(`[wahoo] Failed to fetch Wahoo user: ${res.status}`);
			return null;
		}
		const user = (await res.json()) as WahooUser;
		console.log(
			`[wahoo] Fetched Wahoo user: id=${user.id}, name=${user.first} ${user.last}`,
		);
		return user.id;
	},
	deauthorize: async (accessToken) => {
		await fetch("https://api.wahooligan.com/v1/permissions", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		console.log("[wahoo] Deauthorized app");
	},
};

const getTokenStmt = db.prepare<WahooTokenRow, [string]>(
	`SELECT user_id, access_token, refresh_token, expires_at, wahoo_user_id, scope, webhook_enabled
   FROM wahoo_tokens WHERE user_id = ?`,
);

const getTokenByWahooUserStmt = db.prepare<WahooTokenRow, [number]>(
	`SELECT user_id, access_token, refresh_token, expires_at, wahoo_user_id, scope, webhook_enabled
   FROM wahoo_tokens WHERE wahoo_user_id = ?`,
);

const upsertTokenStmt = db.prepare(
	`INSERT OR REPLACE INTO wahoo_tokens
     (user_id, access_token, refresh_token, expires_at, wahoo_user_id, scope, webhook_enabled, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT webhook_enabled FROM wahoo_tokens WHERE user_id = ?), 0), datetime('now'))`,
);

const updateTokenStmt = db.prepare(
	`UPDATE wahoo_tokens
   SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
   WHERE user_id = ?`,
);

const setWebhookEnabledStmt = db.prepare(
	`UPDATE wahoo_tokens SET webhook_enabled = ?, updated_at = datetime('now') WHERE user_id = ?`,
);

const wahooTokenStore: OAuth2TokenStore = {
	get: (userId) => {
		const row = getTokenStmt.get(userId);
		return row ? rowToToken(row) : null;
	},
	getByProviderUserId: (wahooUserId) => {
		const row = getTokenByWahooUserStmt.get(wahooUserId);
		return row ? rowToToken(row) : null;
	},
	upsert: (token) => {
		upsertTokenStmt.run(
			token.userId,
			token.accessToken,
			token.refreshToken,
			token.expiresAt,
			token.providerUserId ?? null,
			token.scope,
			token.userId,
		);
	},
	updateTokens: (userId, accessToken, refreshToken, expiresAt) => {
		updateTokenStmt.run(accessToken, refreshToken, expiresAt, userId);
	},
	delete: (userId) => {
		db.prepare("DELETE FROM wahoo_tokens WHERE user_id = ?").run(userId);
	},
};

const wahooFlow = new OAuth2Flow(wahooProvider, wahooTokenStore);

/**
 * Fetch a workout's FIT file, parse it, and persist it via the shared importer.
 * - "imported" / "updated": workout was imported (newly or as a replacement)
 * - "skipped": workout is not a biking workout — do not retry
 * - "pending": workout is biking but has no downloadable FIT file yet — the
 *   caller may want to retry later (Wahoo uploads the FIT file to its CDN
 *   asynchronously, and does NOT re-fire the workout_summary webhook when it
 *   becomes available, so the webhook handler polls for it).
 */
async function importWorkout(
	userId: string,
	workout: WahooWorkout,
): Promise<"imported" | "updated" | "skipped" | "pending"> {
	const result = await wahooWorkoutToPayload(userId, workout, {
		downloader: defaultFitDownloader,
	});
	if ("skipped" in result) {
		return result.skipped === "not-biking" ? "skipped" : "pending";
	}

	const importResult = await importActivity(db, result.payload);
	// Map importer "skipped" (no content change) to route "skipped" so the
	// webhook backoff loop and sync counter don't treat it as a re-import.
	return importResult.status === "skipped" ? "skipped" : importResult.status;
}

/**
 * Fetch a single workout by ID from the Wahoo API.
 */
async function fetchWorkout(
	workoutId: number,
	accessToken: string,
): Promise<WahooWorkout> {
	const res = await fetch(
		`https://api.wahooligan.com/v1/workouts/${workoutId}`,
		{
			headers: { Authorization: `Bearer ${accessToken}` },
		},
	);
	if (!res.ok) {
		throw new Error(`Failed to fetch workout ${workoutId}: ${res.status}`);
	}
	return (await res.json()) as WahooWorkout;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/wahoo/connect — redirect to Wahoo OAuth */
wahoo.get("/connect", (c) => {
	console.log("[wahoo] /connect requested");
	if (!env.WAHOO_CLIENT_ID || !env.WAHOO_CLIENT_SECRET) {
		console.log(
			"[wahoo] /connect aborted: missing WAHOO_CLIENT_ID or WAHOO_CLIENT_SECRET",
		);
		return c.json(
			{
				error: "WAHOO_CLIENT_ID and WAHOO_CLIENT_SECRET are not configured",
			},
			501,
		);
	}
	if (!env.WAHOO_REDIRECT_URI) {
		console.log("[wahoo] /connect aborted: missing WAHOO_REDIRECT_URI");
		return c.json({ error: "WAHOO_REDIRECT_URI is not configured" }, 501);
	}

	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		console.log("[wahoo] /connect aborted: missing authenticated user header");
		return c.json({ error: "Unauthorized" }, 401);
	}

	const state = oauthStateStore.create(wahooProvider.name, userId);
	console.log(`[wahoo] Created OAuth state ${state} for user ${userId}`);
	console.log(`[wahoo] Initiating OAuth for user ${userId}`);
	return c.redirect(wahooFlow.buildAuthorizeUrl(state));
});

/** GET /api/wahoo/callback — exchange code for tokens */
wahoo.get("/callback", async (c) => {
	console.log(`[wahoo] Received callback from Wahoo: ${c.req.url}`);
	const { code, state, error } = c.req.query();
	console.log(
		`[wahoo] Callback params: hasCode=${Boolean(code)}, state=${state ?? "missing"}, error=${error ?? "none"}`,
	);

	if (error || !code || !state) {
		console.warn(
			`[wahoo] OAuth denied or missing params: ${error ?? "no code/state"}`,
		);
		return c.redirect("/settings?wahoo=error");
	}

	const userId = oauthStateStore.consume(wahooProvider.name, state);
	console.log(
		`[wahoo] Callback state lookup: state=${state}, found=${Boolean(userId)}`,
	);
	if (!userId) {
		console.warn("[wahoo] Invalid or expired state parameter");
		return c.redirect("/settings?wahoo=error");
	}
	console.log(`[wahoo] Callback resolved user from state: userId=${userId}`);

	try {
		console.log(`[wahoo] Starting token exchange for user ${userId}`);
		const parsed = await wahooFlow.exchangeCode(code);
		console.log(
			`[wahoo] Token exchange parsed for user ${userId}: wahooUserId=${parsed.providerUserId ?? "none"}`,
		);

		if (parsed.providerUserId == null) {
			console.error(`[wahoo] Failed to resolve Wahoo user id for ${userId}`);
			return c.redirect("/settings?wahoo=error");
		}

		console.log(`[wahoo] Persisting Wahoo tokens for user ${userId}`);
		wahooTokenStore.upsert({
			userId,
			accessToken: parsed.accessToken,
			refreshToken: parsed.refreshToken,
			expiresAt: parsed.expiresAt,
			providerUserId: parsed.providerUserId,
			scope: parsed.scope ?? "",
		});

		console.log(
			`[wahoo] Connected Wahoo user ${parsed.providerUserId} for local user ${userId}`,
		);
		return c.redirect("/settings?wahoo=connected");
	} catch (err) {
		console.error("[wahoo] Callback error:", err);
		return c.redirect("/settings?wahoo=error");
	}
});

/** GET /api/wahoo/status — check connection status */
wahoo.get("/status", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const row = getTokenStmt.get(userId);
	if (!row) return c.json({ connected: false });

	return c.json({
		connected: true,
		wahooUserId: row.wahoo_user_id,
		scope: row.scope,
		webhookEnabled: row.webhook_enabled === 1,
	});
});

/** DELETE /api/wahoo/disconnect — remove stored tokens and deauthorize */
wahoo.delete("/disconnect", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	await wahooFlow.deauthorize(userId);
	return c.json({ ok: true });
});

/** POST /api/wahoo/sync — import biking workouts. Pass daysBack=all for all time. */
wahoo.post("/sync", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const daysBackParam = c.req.query("daysBack");

	let accessToken: string;
	try {
		accessToken = await wahooFlow.getValidToken(userId);
	} catch (err) {
		return c.json({ error: (err as Error).message }, 400);
	}

	let cutoffMs: number | undefined;
	if (daysBackParam !== "all") {
		const daysBack = Number(daysBackParam ?? "30");
		if (Number.isNaN(daysBack) || daysBack < 1 || daysBack > 365) {
			return c.json(
				{ error: "daysBack must be between 1 and 365, or 'all'" },
				400,
			);
		}
		cutoffMs = Date.now() - daysBack * 86400 * 1000;
	}

	let imported = 0;
	let updated = 0;
	let skipped = 0;
	let page = 1;
	const perPage = 100;

	// Process a single list workout item. The list endpoint omits
	// workout_type_family_id (and may return workout_summary as null), so we
	// always fetch the full workout and let importWorkout decide whether to
	// skip (non-biking family or no FIT file yet).
	const processListed = async (workout: WahooWorkout) => {
		try {
			const full = await fetchWorkout(workout.id, accessToken);
			const result = await importWorkout(userId, full);
			if (result === "imported") imported++;
			else if (result === "updated") updated++;
			else skipped++;
		} catch (err) {
			console.error(`[wahoo] Failed to import workout ${workout.id}:`, err);
		}
	};

	// Wahoo's /workouts is sorted by `starts` descending and has no date filter
	// param, so we paginate and stop once we cross the cutoff.
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const url = `https://api.wahooligan.com/v1/workouts?per_page=${perPage}&page=${page}`;
		const listRes = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!listRes.ok) {
			if (page === 1) {
				return c.json({ error: `Wahoo API error: ${listRes.status}` }, 502);
			}
			console.warn(`[wahoo] API error on page ${page}: ${listRes.status}`);
			break;
		}

		const data = (await listRes.json()) as WahooWorkoutsResponse;
		if (data.workouts.length === 0) break;

		// Stop paginating once all workouts on this page are older than the cutoff.
		if (cutoffMs != null) {
			const oldestOnPage = new Date(
				data.workouts[data.workouts.length - 1].starts,
			).getTime();
			if (oldestOnPage < cutoffMs) {
				// Still process the in-range workouts on this page before breaking.
				for (const workout of data.workouts) {
					if (new Date(workout.starts).getTime() < cutoffMs) break;
					await processListed(workout);
				}
				break;
			}
		}

		for (const workout of data.workouts) {
			await processListed(workout);
		}

		if (data.workouts.length < perPage) break;
		page++;
	}

	return c.json({ imported, updated, skipped });
});

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * POST /api/wahoo/webhook — receive workout_summary events from Wahoo.
 * Wahoo POSTs here when a workout summary is created/updated. We validate the
 * webhook_token, ack 200 immediately, then process in the background.
 *
 * Wahoo fires this webhook the moment a workout_summary is created, but the
 * downloadable FIT file is uploaded to Wahoo's CDN asynchronously and may not
 * be available yet — and Wahoo does NOT re-fire the webhook when the file
 * becomes available. So when importWorkout reports "pending" (no FIT file yet),
 * we poll Wahoo's /workouts/:id endpoint with increasing backoff until the FIT
 * file shows up (or we exhaust the retry schedule).
 */
wahoo.post("/webhook", async (c) => {
	if (!env.WAHOO_WEBHOOK_TOKEN) {
		console.warn(
			"[wahoo] Webhook received but WAHOO_WEBHOOK_TOKEN not configured",
		);
		return c.json({ error: "Webhook not configured" }, 501);
	}

	const event = await c.req.json<WahooWebhookEvent>();

	// Validate authenticity via the shared webhook token
	if (event.webhook_token !== env.WAHOO_WEBHOOK_TOKEN) {
		console.warn("[wahoo] Webhook token mismatch — rejecting");
		return c.json({ error: "Forbidden" }, 403);
	}

	// Acknowledge immediately so Wahoo doesn't retry
	const response = c.json({ ok: true }, 200);

	if (event.event_type !== "workout_summary") {
		console.log(`[wahoo] Ignoring webhook event type: ${event.event_type}`);
		return response;
	}

	// Process in background — don't block the response
	(async () => {
		try {
			const tokenRow = wahooTokenStore.getByProviderUserId(event.user.id);
			if (!tokenRow) {
				console.log(
					`[wahoo] Webhook for unknown Wahoo user ${event.user.id} — no local token`,
				);
				return;
			}

			const userId = tokenRow.userId;
			const workoutId = event.workout_summary.workout.id;

			// Backoff schedule (ms) for re-fetching the workout while the FIT
			// file is still uploading to Wahoo's CDN. Wahoo doesn't re-fire the
			// webhook when the file lands, so we poll until it's available.
			// Total worst-case wait ≈ 6 minutes.
			const backoffScheduleMs = [
				15_000, 30_000, 60_000, 120_000, 120_000, 60_000,
			];

			let result: "imported" | "updated" | "skipped" | "pending" = "pending";
			for (let attempt = 0; attempt < backoffScheduleMs.length; attempt++) {
				// Re-resolve the access token each iteration — it may expire
				// during the long backoff window.
				const accessToken = await wahooFlow.getValidToken(userId);
				const full = await fetchWorkout(workoutId, accessToken);
				result = await importWorkout(userId, full);
				if (result !== "pending") break;

				const delayMs = backoffScheduleMs[attempt];
				console.log(
					`[wahoo] Workout ${workoutId} FIT file not ready — retry ${attempt + 1}/${backoffScheduleMs.length} in ${delayMs / 1000}s`,
				);
				await Bun.sleep(delayMs);
			}

			if (result === "pending") {
				console.warn(
					`[wahoo] Workout ${workoutId} FIT file never became available after ${backoffScheduleMs.length} retries — giving up`,
				);
			} else {
				console.log(
					`[wahoo] Webhook import result for workout ${workoutId}: ${result}`,
				);
			}
		} catch (err) {
			console.error("[wahoo] Webhook background processing failed:", err);
		}
	})();

	return response;
});

// ─── Webhook registration ─────────────────────────────────────────────────────

/**
 * Derive the webhook URL from WAHOO_REDIRECT_URI by replacing /callback with /webhook.
 * e.g. https://fit.schmid-felix.de/api/wahoo/callback → https://fit.schmid-felix.de/api/wahoo/webhook
 */
function deriveWebhookUrl(): string {
	if (!env.WAHOO_REDIRECT_URI) {
		throw new Error("WAHOO_REDIRECT_URI is not configured");
	}
	return env.WAHOO_REDIRECT_URI.replace(/\/callback$/, "/webhook");
}

/** PUT /api/wahoo/webhook/register — enable webhooks on the Wahoo user record */
wahoo.post("/webhook/register", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	if (!env.WAHOO_WEBHOOK_TOKEN) {
		return c.json({ error: "WAHOO_WEBHOOK_TOKEN is not configured" }, 501);
	}

	let accessToken: string;
	try {
		accessToken = await wahooFlow.getValidToken(userId);
	} catch (err) {
		return c.json({ error: (err as Error).message }, 400);
	}

	const webhookUrl = deriveWebhookUrl();
	const params = new URLSearchParams({
		"user[webhook_enabled]": "true",
		"user[webhook_url]": webhookUrl,
		"user[webhook_token]": env.WAHOO_WEBHOOK_TOKEN,
	});

	const res = await fetch("https://api.wahooligan.com/v1/user", {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params,
	});

	if (!res.ok) {
		console.error(`[wahoo] Failed to register webhook: ${res.status}`);
		return c.json({ error: `Wahoo API error: ${res.status}` }, 502);
	}

	setWebhookEnabledStmt.run(1, userId);
	console.log(`[wahoo] Registered webhook ${webhookUrl} for user ${userId}`);
	return c.json({ ok: true, webhookUrl });
});

/** DELETE /api/wahoo/webhook/register — disable webhooks on the Wahoo user record */
wahoo.delete("/webhook/register", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	let accessToken: string;
	try {
		accessToken = await wahooFlow.getValidToken(userId);
	} catch (err) {
		return c.json({ error: (err as Error).message }, 400);
	}

	const params = new URLSearchParams({
		"user[webhook_enabled]": "false",
	});

	const res = await fetch("https://api.wahooligan.com/v1/user", {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params,
	});

	if (!res.ok) {
		console.error(`[wahoo] Failed to unregister webhook: ${res.status}`);
		return c.json({ error: `Wahoo API error: ${res.status}` }, 502);
	}

	setWebhookEnabledStmt.run(0, userId);
	console.log(`[wahoo] Unregistered webhook for user ${userId}`);
	return c.json({ ok: true });
});

export { wahoo };
