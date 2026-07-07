import { parseFit } from "@fit-analyzer/shared";
import type { StoredRecord } from "@fit-analyzer/shared";
import { Hono } from "hono";
import { db } from "../db.js";
import { env } from "../env.js";
import { handleNewActivityForWaxedChainReminder } from "../lib/waxedChainReminders.js";
import {
	getAthleteProfile,
	updateAthleteProfile,
} from "../lib/athleteProfile.js";
import { inferLocationFromActivities } from "../lib/athleteStats.js";

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

interface WahooWorkoutSummary {
	id: number;
	name?: string;
	ascent_accum: string;
	cadence_avg: string;
	calories_accum: string;
	distance_accum: string;
	duration_active_accum: string;
	duration_paused_accum: string;
	duration_total_accum: string;
	heart_rate_avg: string;
	power_bike_np_last: string;
	power_bike_tss_last: string;
	power_avg: string;
	speed_avg: string;
	work_accum: string;
	time_zone?: string;
	manual?: boolean;
	edited?: boolean;
	fitness_app_id?: number;
	file: { url: string | null };
	created_at: string;
	updated_at: string;
}

interface WahooWorkout {
	id: number;
	starts: string;
	minutes: number;
	name: string;
	plan_id: number | null;
	plan_ids: number[];
	route_id: number | null;
	workout_token: string;
	workout_type_id: number;
	workout_type_family_id?: number;
	workout_summary: WahooWorkoutSummary | null;
	created_at: string;
	updated_at: string;
}

interface WahooWorkoutsResponse {
	workouts: WahooWorkout[];
	total: number;
	page: number;
	per_page: number;
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

interface StoredWahooToken {
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	wahoo_user_id: number | null;
	scope: string;
}

// ─── CSRF State Store ─────────────────────────────────────────────────────────

interface PendingState {
	userId: string;
	expiresAt: number;
}

/** state UUID → pending callback context */
const pendingStates = new Map<string, PendingState>();

/** Prune expired states to avoid unbounded growth */
function pruneStates() {
	const now = Date.now();
	for (const [key, pending] of pendingStates) {
		if (now > pending.expiresAt) {
			console.log(
				`[wahoo] Pruning expired OAuth state ${key} for user ${pending.userId}`,
			);
			pendingStates.delete(key);
		}
	}
}

async function exchangeWahooToken(
	params: Record<string, string>,
): Promise<Response> {
	const startedAt = Date.now();
	console.log("[wahoo] Token request starting");
	const response = await fetch("https://api.wahooligan.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});
	console.log(
		`[wahoo] Token exchange completed in ${Date.now() - startedAt}ms with status ${response.status}`,
	);
	return response;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) throw new Error("Missing x-authentik-username header");
	return userId;
}

const getTokenStmt = db.prepare<StoredWahooToken, [string]>(
	`SELECT user_id, access_token, refresh_token, expires_at, wahoo_user_id, scope
   FROM wahoo_tokens WHERE user_id = ?`,
);

const getTokenByWahooUserStmt = db.prepare<StoredWahooToken, [number]>(
	`SELECT user_id, access_token, refresh_token, expires_at, wahoo_user_id, scope
   FROM wahoo_tokens WHERE wahoo_user_id = ?`,
);

const upsertTokenStmt = db.prepare(
	`INSERT OR REPLACE INTO wahoo_tokens
     (user_id, access_token, refresh_token, expires_at, wahoo_user_id, scope, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
);

const updateTokenStmt = db.prepare(
	`UPDATE wahoo_tokens
   SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
   WHERE user_id = ?`,
);

const checkWahooActivityStmt = db.prepare<{ id: string }, [string, string]>(
	"SELECT id FROM activities WHERE user_id = ? AND wahoo_activity_id = ?",
);

const deleteWahooActivityStmt = db.prepare(
	"DELETE FROM activities WHERE user_id = ? AND wahoo_activity_id = ?",
);

const insertActivityStmt = db.prepare(
	`INSERT INTO activities
     (id, date, summary, records, laps, intervals, user_id, wahoo_activity_id)
   VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
);

/**
 * Update the athlete's inferred location from recent activities, but only if
 * they haven't set a location manually. Runs async and logs failures instead of
 * blocking the import path.
 */
function maybeUpdateAthleteLocation(userId: string): void {
	const profile = getAthleteProfile(userId);
	if (profile.location) return;

	const inferred = inferLocationFromActivities(userId);
	if (!inferred) return;

	try {
		updateAthleteProfile(userId, { location: inferred });
		console.log(
			`[wahoo] Inferred athlete location for user ${userId}: ${inferred}`,
		);
	} catch (err) {
		console.error(
			`[wahoo] Failed to update inferred location for user ${userId}:`,
			err,
		);
	}
}

/** Return a valid access token for the user, refreshing if within 60s of expiry. */
async function getValidToken(userId: string): Promise<string> {
	const token = getTokenStmt.get(userId);
	if (!token) throw new Error("Wahoo not connected for this user");

	if (Math.floor(Date.now() / 1000) >= token.expires_at - 60) {
		console.log(`[wahoo] Starting token refresh for user ${userId}`);
		const res = await exchangeWahooToken({
			client_id: env.WAHOO_CLIENT_ID ?? "",
			client_secret: env.WAHOO_CLIENT_SECRET ?? "",
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
		});
		console.log(
			`[wahoo] Token refresh response received for user ${userId}: status=${res.status}`,
		);
		if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
		const data = (await res.json()) as WahooTokenResponse;
		const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
		updateTokenStmt.run(
			data.access_token,
			data.refresh_token,
			expiresAt,
			userId,
		);
		return data.access_token;
	}

	return token.access_token;
}

/** Biking workout type family id (covers road, indoor, trainer, virtual, ebike, etc.) */
const BIKING_WORKOUT_TYPE_FAMILY_ID = 0;

/**
 * Fetch a workout's FIT file, parse it, and insert it into the activities table.
 * Returns "imported" | "updated" if imported, null if skipped (not biking, or no
 * FIT file available yet).
 */
async function importWorkout(
	userId: string,
	workout: WahooWorkout,
): Promise<"imported" | "updated" | null> {
	// Only import biking workouts
	if (workout.workout_type_family_id !== BIKING_WORKOUT_TYPE_FAMILY_ID) {
		return null;
	}

	const wahooId = String(workout.id);

	// Need a workout summary with a downloadable FIT file
	const fitUrl = workout.workout_summary?.file?.url;
	if (!fitUrl) {
		console.log(
			`[wahoo] Workout ${wahooId} has no FIT file yet — skipping (webhook will fire later)`,
		);
		return null;
	}

	const alreadyExists = checkWahooActivityStmt.get(userId, wahooId);

	// Download FIT file from Wahoo CDN (unauthenticated, doesn't count against rate limits)
	const fitRes = await fetch(fitUrl);
	if (!fitRes.ok) {
		throw new Error(
			`Failed to download FIT file for workout ${wahooId}: ${fitRes.status}`,
		);
	}
	const fitBuffer = await fitRes.arrayBuffer();

	// Parse using the shared FIT parser (same as client-side uploads)
	const { records, summary, laps } = parseFit(fitBuffer);

	// Convert ActivityRecord[] (Date timestamps) → StoredRecord[] (ISO strings)
	const storedRecords: StoredRecord[] = records.map((r) => ({
		...r,
		timestamp: r.timestamp.toISOString(),
	}));

	if (alreadyExists) {
		deleteWahooActivityStmt.run(userId, wahooId);
	}

	const id = crypto.randomUUID();
	insertActivityStmt.run(
		id,
		summary.date,
		JSON.stringify(summary),
		JSON.stringify(storedRecords),
		JSON.stringify(laps),
		userId,
		wahooId,
	);

	await handleNewActivityForWaxedChainReminder(userId, storedRecords);
	maybeUpdateAthleteLocation(userId);

	console.log(
		`[wahoo] ${alreadyExists ? "Re-imported" : "Imported"} workout ${wahooId} (${workout.name}) → ${id}`,
	);
	return alreadyExists ? "updated" : "imported";
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

	pruneStates();
	const state = crypto.randomUUID();
	pendingStates.set(state, {
		userId,
		expiresAt: Date.now() + 10 * 60 * 1000,
	});
	console.log(
		`[wahoo] Created OAuth state ${state} for user ${userId}; pendingStates=${pendingStates.size}`,
	);

	const params = new URLSearchParams({
		client_id: env.WAHOO_CLIENT_ID,
		redirect_uri: env.WAHOO_REDIRECT_URI,
		response_type: "code",
		scope: "user_read workouts_read offline_data",
		state,
	});

	console.log(`[wahoo] Initiating OAuth for user ${userId}`);
	return c.redirect(
		`https://api.wahooligan.com/oauth/authorize?${params.toString()}`,
	);
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

	pruneStates();
	const pending = pendingStates.get(state);
	console.log(
		`[wahoo] Callback state lookup: state=${state}, found=${Boolean(pending)}, pendingStates=${pendingStates.size}`,
	);
	if (!pending) {
		console.warn("[wahoo] Invalid or expired state parameter");
		return c.redirect("/settings?wahoo=error");
	}
	pendingStates.delete(state);
	console.log(
		`[wahoo] Callback state consumed: state=${state}, remainingPendingStates=${pendingStates.size}`,
	);
	const userId = pending.userId;
	console.log(`[wahoo] Callback resolved user from state: userId=${userId}`);

	try {
		console.log(`[wahoo] Starting token exchange for user ${userId}`);
		const res = await exchangeWahooToken({
			client_id: env.WAHOO_CLIENT_ID ?? "",
			client_secret: env.WAHOO_CLIENT_SECRET ?? "",
			code,
			redirect_uri: env.WAHOO_REDIRECT_URI ?? "",
			grant_type: "authorization_code",
		});
		console.log(
			`[wahoo] Token exchange response received for user ${userId}: status=${res.status}`,
		);

		if (!res.ok) {
			console.error(`[wahoo] Token exchange failed: ${res.status}`);
			return c.redirect("/settings?wahoo=error");
		}

		const data = (await res.json()) as WahooTokenResponse;
		const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
		console.log(
			`[wahoo] Token exchange JSON parsed for user ${userId}: expires_in=${data.expires_in}`,
		);

		// Fetch the authenticated Wahoo user to get their wahoo_user_id
		const userRes = await fetch("https://api.wahooligan.com/v1/user", {
			headers: { Authorization: `Bearer ${data.access_token}` },
		});
		if (!userRes.ok) {
			console.error(`[wahoo] Failed to fetch Wahoo user: ${userRes.status}`);
			return c.redirect("/settings?wahoo=error");
		}
		const wahooUser = (await userRes.json()) as WahooUser;
		console.log(
			`[wahoo] Fetched Wahoo user: id=${wahooUser.id}, name=${wahooUser.first} ${wahooUser.last}`,
		);

		console.log(`[wahoo] Persisting Wahoo tokens for user ${userId}`);
		upsertTokenStmt.run(
			userId,
			data.access_token,
			data.refresh_token,
			expiresAt,
			wahooUser.id,
			"user_read workouts_read offline_data",
		);

		console.log(
			`[wahoo] Connected Wahoo user ${wahooUser.id} for local user ${userId}`,
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

	const token = getTokenStmt.get(userId);
	if (!token) return c.json({ connected: false });

	return c.json({
		connected: true,
		wahooUserId: token.wahoo_user_id,
		scope: token.scope,
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

	const token = getTokenStmt.get(userId);

	// Deauthorize on Wahoo's side (revokes the app's access)
	if (token) {
		try {
			const accessToken = await getValidToken(userId);
			await fetch("https://api.wahooligan.com/v1/permissions", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			console.log(`[wahoo] Deauthorized app for user ${userId}`);
		} catch (err) {
			console.warn(
				`[wahoo] Failed to deauthorize on Wahoo side for user ${userId}:`,
				err,
			);
		}
	}

	db.prepare("DELETE FROM wahoo_tokens WHERE user_id = ?").run(userId);
	console.log(`[wahoo] Disconnected user ${userId}`);
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
		accessToken = await getValidToken(userId);
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
					if (
						workout.workout_type_family_id !== BIKING_WORKOUT_TYPE_FAMILY_ID
					) {
						skipped++;
						continue;
					}
					try {
						// Fetch the full workout to get the embedded workout_summary (the
						// list endpoint returns summary as null until populated).
						const full = await fetchWorkout(workout.id, accessToken);
						const result = await importWorkout(userId, full);
						if (result === "imported") imported++;
						else if (result === "updated") updated++;
						else skipped++;
					} catch (err) {
						console.error(
							`[wahoo] Failed to import workout ${workout.id}:`,
							err,
						);
					}
				}
				break;
			}
		}

		for (const workout of data.workouts) {
			if (workout.workout_type_family_id !== BIKING_WORKOUT_TYPE_FAMILY_ID) {
				skipped++;
				continue;
			}
			try {
				const full = await fetchWorkout(workout.id, accessToken);
				const result = await importWorkout(userId, full);
				if (result === "imported") imported++;
				else if (result === "updated") updated++;
				else skipped++;
			} catch (err) {
				console.error(`[wahoo] Failed to import workout ${workout.id}:`, err);
			}
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
			const tokenRow = getTokenByWahooUserStmt.get(event.user.id);
			if (!tokenRow) {
				console.log(
					`[wahoo] Webhook for unknown Wahoo user ${event.user.id} — no local token`,
				);
				return;
			}

			const accessToken = await getValidToken(tokenRow.user_id);
			const workoutId = event.workout_summary.workout.id;
			const full = await fetchWorkout(workoutId, accessToken);
			const result = await importWorkout(tokenRow.user_id, full);
			console.log(
				`[wahoo] Webhook import result for workout ${workoutId}: ${result ?? "skipped"}`,
			);
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
		accessToken = await getValidToken(userId);
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
		accessToken = await getValidToken(userId);
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

	console.log(`[wahoo] Unregistered webhook for user ${userId}`);
	return c.json({ ok: true });
});

export { wahoo };
