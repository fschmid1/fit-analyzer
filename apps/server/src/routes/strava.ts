import type {
	ActivitySummary,
	LapMarker,
	StoredRecord,
	StravaClubEvent,
} from "@fit-analyzer/shared";
import { Hono } from "hono";
import { db } from "../db.js";
import { env } from "../env.js";
import { handleNewActivityForWaxedChainReminder } from "../lib/waxedChainReminders.js";

const strava = new Hono();

// ─── Types ────────────────────────────────────────────────────────────────────

interface StravaTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	athlete: { id: number };
	scope?: string;
}

interface StravaActivity {
	id: number;
	name: string;
	type: string;
	sport_type: string;
	start_date: string;
	moving_time: number;
	elapsed_time: number;
	distance?: number;
	average_watts?: number;
	max_watts?: number;
	average_heartrate?: number;
	max_heartrate?: number;
	average_cadence?: number;
	kilojoules?: number;
}

interface StravaNumericStream {
	type: string;
	data: number[];
}

interface StravaLatLngStream {
	type: string;
	data: [number, number][];
}

interface StravaStreams {
	time?: StravaNumericStream;
	watts?: StravaNumericStream;
	heartrate?: StravaNumericStream;
	cadence?: StravaNumericStream;
	velocity_smooth?: StravaNumericStream;
	grade_smooth?: StravaNumericStream;
	latlng?: StravaLatLngStream;
}

interface StravaLap {
	start_index: number;
	end_index: number;
	average_watts?: number;
	average_heartrate?: number;
	average_cadence?: number;
}

interface StoredToken {
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	athlete_id: number;
	scope: string;
}

interface StravaWebhookEvent {
	object_type: string; // "activity" | "athlete"
	aspect_type: string; // "create" | "update" | "delete"
	object_id: number; // activity ID
	owner_id: number; // athlete ID
	subscription_id: number;
	event_time: number;
	updates?: Record<string, string>;
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
				`[strava] Pruning expired OAuth state ${key} for user ${pending.userId}`,
			);
			pendingStates.delete(key);
		}
	}
}

async function exchangeStravaTokenWithBunFetch(
	params: Record<string, string>,
): Promise<Response> {
	const startedAt = Date.now();
	console.log("[strava] Bun fetch token request starting");
	const response = await fetch("https://www.strava.com/oauth/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams(params),
	});
	console.log(
		`[strava] Bun fetch token exchange completed in ${Date.now() - startedAt}ms with status ${response.status}`,
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

const getTokenStmt = db.prepare<StoredToken, [string]>(
	`SELECT user_id, access_token, refresh_token, expires_at, athlete_id, scope
   FROM strava_tokens WHERE user_id = ?`,
);

const getTokenByAthleteStmt = db.prepare<StoredToken, [number]>(
	`SELECT user_id, access_token, refresh_token, expires_at, athlete_id, scope
   FROM strava_tokens WHERE athlete_id = ?`,
);

const upsertTokenStmt = db.prepare(
	`INSERT OR REPLACE INTO strava_tokens
     (user_id, access_token, refresh_token, expires_at, athlete_id, scope, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
);

const updateTokenStmt = db.prepare(
	`UPDATE strava_tokens
   SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
   WHERE user_id = ?`,
);

const checkStravaActivityStmt = db.prepare<{ id: string }, [string, string]>(
	"SELECT id FROM activities WHERE user_id = ? AND strava_activity_id = ?",
);

const deleteStravaActivityStmt = db.prepare(
	"DELETE FROM activities WHERE user_id = ? AND strava_activity_id = ?",
);

const insertActivityStmt = db.prepare(
	`INSERT INTO activities
     (id, date, summary, records, laps, intervals, user_id, strava_activity_id)
   VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
);

/** Return a valid access token for the user, refreshing if within 60s of expiry. */
async function getValidToken(userId: string): Promise<string> {
	const token = getTokenStmt.get(userId);
	if (!token) throw new Error("Strava not connected for this user");

	if (Math.floor(Date.now() / 1000) >= token.expires_at - 60) {
		console.log(`[strava] Starting token refresh for user ${userId}`);
		const res = await exchangeStravaTokenWithBunFetch({
			client_id: env.STRAVA_CLIENT_ID ?? "",
			client_secret: env.STRAVA_CLIENT_SECRET ?? "",
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
		});
		console.log(
			`[strava] Token refresh response received for user ${userId}: status=${res.status}`,
		);
		if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
		const data = (await res.json()) as StravaTokenResponse;
		updateTokenStmt.run(
			data.access_token,
			data.refresh_token,
			data.expires_at,
			userId,
		);
		return data.access_token;
	}

	return token.access_token;
}

/** Compute the best average power for a rolling time window (in seconds). */
function computePeakPower(
	timeArr: number[],
	wattsArr: number[],
	windowSecs: number,
): number | null {
	if (!wattsArr.length || !timeArr.length) return null;

	let bestAvg = 0;
	let lo = 0;
	let sum = 0;

	for (let hi = 0; hi < timeArr.length; hi++) {
		sum += wattsArr[hi];
		while (timeArr[hi] - timeArr[lo] > windowSecs) {
			sum -= wattsArr[lo];
			lo++;
		}
		const actualWindow = timeArr[hi] - timeArr[lo];
		if (actualWindow >= Math.min(windowSecs, timeArr[timeArr.length - 1])) {
			const avg = sum / (hi - lo + 1);
			if (avg > bestAvg) bestAvg = avg;
		}
	}

	return bestAvg > 0 ? Math.round(bestAvg) : null;
}

/** Build StoredRecord[] from Strava streams (key_by_type format). */
function buildRecords(startDate: Date, streams: StravaStreams): StoredRecord[] {
	const timeData = streams.time?.data ?? [];
	const wattsData = streams.watts?.data ?? [];
	const hrData = streams.heartrate?.data ?? [];
	const cadData = streams.cadence?.data ?? [];
	const velData = streams.velocity_smooth?.data ?? [];
	const gradeData = streams.grade_smooth?.data ?? [];
	const latLngData = streams.latlng?.data ?? [];

	return timeData.map((elapsed, i) => ({
		timestamp: new Date(startDate.getTime() + elapsed * 1000).toISOString(),
		elapsedSeconds: elapsed,
		power: wattsData[i] ?? null,
		heartRate: hrData[i] ?? null,
		cadence: cadData[i] ?? null,
		speed: velData[i] != null ? Math.round(velData[i] * 3.6 * 10) / 10 : null,
		gradient: gradeData[i] ?? null,
		lat: latLngData[i]?.[0] ?? null,
		lng: latLngData[i]?.[1] ?? null,
	}));
}

/**
 * Build ActivitySummary entirely from raw stream data.
 * Nothing is taken from Strava's pre-computed API fields.
 *
 * Uses a simple mean of non-zero samples, matching Garmin's session record:
 * the device records at 1 Hz so its simple mean == its time-weighted mean.
 * Time-weighting Strava's variable-rate stream is NOT equivalent because large
 * Δt values at pause/auto-pause boundaries are gaps, not sample durations —
 * weighting by them over-penalises the first sample after each stop.
 */
function buildSummary(
	activity: StravaActivity,
	records: StoredRecord[],
	timeArr: number[],
	wattsArr: number[],
): ActivitySummary {
	// Simple mean of non-zero values, mirroring Garmin session record behaviour:
	// zeros (coasting / sensor dropout) are excluded from averages.
	const powerVals = records
		.map((r) => r.power)
		.filter((v): v is number => v !== null && v > 0);
	const hrVals = records
		.map((r) => r.heartRate)
		.filter((v): v is number => v !== null && v > 0);
	const cadVals = records
		.map((r) => r.cadence)
		.filter((v): v is number => v !== null && v > 0);

	const avg = (vals: number[]) =>
		vals.length
			? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
			: null;
	const max = (vals: number[]) =>
		vals.length ? vals.reduce((m, v) => (v > m ? v : m), vals[0]) : null;

	// Total work: ∫ power dt (W·s = J), nulls treated as 0W
	let totalWork: number | null = null;
	if (wattsArr.length > 0 && timeArr.length === wattsArr.length) {
		let joules = 0;
		for (let i = 0; i < wattsArr.length; i++) {
			const dt = i === 0 ? timeArr[0] : timeArr[i] - timeArr[i - 1];
			joules += (wattsArr[i] ?? 0) * dt;
		}
		totalWork = Math.round(joules);
	}

	return {
		date: activity.start_date.slice(0, 10),
		// moving_time matches Garmin's totalTimerTime (excludes pauses; time stream
		// runs 0→elapsed_time which overshoots by the total paused duration)
		totalTimerTime: activity.moving_time,
		totalDistanceKm:
			activity.distance != null
				? Math.round((activity.distance / 1000) * 10) / 10
				: null,
		avgPower: avg(powerVals),
		maxPower: max(powerVals),
		avgHeartRate: avg(hrVals),
		maxHeartRate: max(hrVals),
		avgCadence: avg(cadVals),
		totalWork,
		peak1minPower: computePeakPower(timeArr, wattsArr, 60),
		peak5minPower: computePeakPower(timeArr, wattsArr, 300),
	};
}

/** Build LapMarker[] from Strava laps, converting stream indices to elapsed seconds. */
function buildLaps(laps: StravaLap[], timeArr: number[]): LapMarker[] {
	return laps.map((lap) => ({
		startSeconds: timeArr[lap.start_index] ?? lap.start_index,
		endSeconds:
			timeArr[Math.min(lap.end_index, timeArr.length - 1)] ?? lap.end_index,
		avgPower: lap.average_watts ?? null,
		avgHeartRate: lap.average_heartrate ?? null,
		avgCadence: lap.average_cadence ?? null,
	}));
}

const RIDE_TYPES = new Set(["Ride", "VirtualRide", "EBikeRide"]);

/**
 * Fetch a single Strava activity by ID and insert it into the activities table.
 * Returns true if imported, false if skipped (already exists or not a ride).
 */
async function importSingleActivity(
	userId: string,
	stravaActivityId: number,
	accessToken: string,
): Promise<"imported" | "updated" | null> {
	const stravaId = String(stravaActivityId);

	const alreadyExists = checkStravaActivityStmt.get(userId, stravaId);

	// Fetch full activity details
	const actRes = await fetch(
		`https://www.strava.com/api/v3/activities/${stravaActivityId}`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	if (!actRes.ok)
		throw new Error(
			`Failed to fetch activity ${stravaActivityId}: ${actRes.status}`,
		);
	const activity = (await actRes.json()) as StravaActivity;

	// Only import rides
	if (!RIDE_TYPES.has(activity.type) && !RIDE_TYPES.has(activity.sport_type))
		return null;

	// Fetch streams
	const streamsRes = await fetch(
		`https://www.strava.com/api/v3/activities/${stravaActivityId}/streams?keys=time,watts,heartrate,cadence,velocity_smooth,grade_smooth,latlng&key_by_type=true`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	const streams: StravaStreams = streamsRes.ok
		? ((await streamsRes.json()) as StravaStreams)
		: {};

	if (!streamsRes.ok) {
		console.warn(
			`[strava] Streams unavailable for activity ${stravaActivityId}: ${streamsRes.status}`,
		);
	}

	// Fetch laps
	const lapsRes = await fetch(
		`https://www.strava.com/api/v3/activities/${stravaActivityId}/laps`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	const rawLaps: StravaLap[] = lapsRes.ok
		? ((await lapsRes.json()) as StravaLap[])
		: [];

	const timeArr = streams.time?.data ?? [];
	const wattsArr = streams.watts?.data ?? [];
	const startDate = new Date(activity.start_date);

	const records = buildRecords(startDate, streams);
	const summary = buildSummary(activity, records, timeArr, wattsArr);
	const laps = buildLaps(rawLaps, timeArr);

	if (alreadyExists) {
		deleteStravaActivityStmt.run(userId, stravaId);
	}

	const id = crypto.randomUUID();
	insertActivityStmt.run(
		id,
		summary.date,
		JSON.stringify(summary),
		JSON.stringify(records),
		JSON.stringify(laps),
		userId,
		stravaId,
	);

	if (alreadyExists) {
		await handleNewActivityForWaxedChainReminder(userId, records);
	}

	console.log(
		`[strava] ${alreadyExists ? "Re-imported" : "Imported"} activity ${stravaActivityId} (${activity.name}) → ${id}`,
	);
	return alreadyExists ? "updated" : "imported";
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/strava/connect — redirect to Strava OAuth */
strava.get("/connect", (c) => {
	console.log("[strava] /connect requested");
	if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
		console.log(
			"[strava] /connect aborted: missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET",
		);
		return c.json(
			{
				error: "STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are not configured",
			},
			501,
		);
	}
	if (!env.STRAVA_REDIRECT_URI) {
		console.log("[strava] /connect aborted: missing STRAVA_REDIRECT_URI");
		return c.json({ error: "STRAVA_REDIRECT_URI is not configured" }, 501);
	}

	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		console.log("[strava] /connect aborted: missing authenticated user header");
		return c.json({ error: "Unauthorized" }, 401);
	}

	pruneStates();
	const state = crypto.randomUUID();
	pendingStates.set(state, {
		userId,
		expiresAt: Date.now() + 10 * 60 * 1000,
	});
	console.log(
		`[strava] Created OAuth state ${state} for user ${userId}; pendingStates=${pendingStates.size}`,
	);

	const params = new URLSearchParams({
		client_id: env.STRAVA_CLIENT_ID,
		redirect_uri: env.STRAVA_REDIRECT_URI,
		response_type: "code",
		approval_prompt: "auto",
		scope: "activity:read_all,read",
		state,
	});

	console.log(`[strava] Initiating OAuth for user ${userId}`);
	return c.redirect(
		`https://www.strava.com/oauth/authorize?${params.toString()}`,
	);
});

/** GET /api/strava/callback — exchange code for tokens */
strava.get("/callback", async (c) => {
	console.log(`[strava] Received callback from Strava: ${c.req.url}`);
	const { code, state, error } = c.req.query();
	console.log(
		`[strava] Callback params: hasCode=${Boolean(code)}, state=${state ?? "missing"}, error=${error ?? "none"}`,
	);

	if (error || !code || !state) {
		console.warn(
			`[strava] OAuth denied or missing params: ${error ?? "no code/state"}`,
		);
		return c.redirect("/settings?strava=error");
	}

	pruneStates();
	const pending = pendingStates.get(state);
	console.log(
		`[strava] Callback state lookup: state=${state}, found=${Boolean(pending)}, pendingStates=${pendingStates.size}`,
	);
	if (!pending) {
		console.warn("[strava] Invalid or expired state parameter");
		return c.redirect("/settings?strava=error");
	}
	pendingStates.delete(state);
	console.log(
		`[strava] Callback state consumed: state=${state}, remainingPendingStates=${pendingStates.size}`,
	);
	const userId = pending.userId;
	console.log(`[strava] Callback resolved user from state: userId=${userId}`);

	try {
		console.log(`[strava] Starting token exchange for user ${userId}`);
		const res = await exchangeStravaTokenWithBunFetch({
			client_id: env.STRAVA_CLIENT_ID ?? "",
			client_secret: env.STRAVA_CLIENT_SECRET ?? "",
			code,
			grant_type: "authorization_code",
		});
		console.log(
			`[strava] Token exchange response received for user ${userId}: status=${res.status}`,
		);

		if (!res.ok) {
			console.error(`[strava] Token exchange failed: ${res.status}`);
			return c.redirect("/settings?strava=error");
		}

		console.log(`[strava] Parsing token exchange JSON for user ${userId}`);
		const data = (await res.json()) as StravaTokenResponse;
		console.log(
			`[strava] Token exchange JSON parsed for user ${userId}: athleteId=${data.athlete.id}, scope=${data.scope ?? "none"}`,
		);

		console.log(`[strava] Persisting Strava tokens for user ${userId}`);
		upsertTokenStmt.run(
			userId,
			data.access_token,
			data.refresh_token,
			data.expires_at,
			data.athlete.id,
			data.scope ?? "",
		);

		console.log(
			`[strava] Connected athlete ${data.athlete.id} for user ${userId}`,
		);
		console.log(
			`[strava] Callback completed successfully for user ${userId}, redirecting to settings`,
		);
		return c.redirect("/settings?strava=connected");
	} catch (err) {
		console.error("[strava] Callback error:", err);
		return c.redirect("/settings?strava=error");
	}
});

/** GET /api/strava/status — check connection status */
strava.get("/status", (c) => {
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
		athleteId: token.athlete_id,
		scope: token.scope,
	});
});

/** DELETE /api/strava/disconnect — remove stored tokens */
strava.delete("/disconnect", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	db.prepare("DELETE FROM strava_tokens WHERE user_id = ?").run(userId);
	console.log(`[strava] Disconnected user ${userId}`);
	return c.json({ ok: true });
});

/** POST /api/strava/sync — import ride activities. Pass daysBack=all for all time. */
strava.post("/sync", async (c) => {
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

	let after: number | undefined;
	if (daysBackParam === "all") {
		after = undefined;
	} else {
		const daysBack = Number(daysBackParam ?? "30");
		if (Number.isNaN(daysBack) || daysBack < 1 || daysBack > 365) {
			return c.json(
				{ error: "daysBack must be between 1 and 365, or 'all'" },
				400,
			);
		}
		after = Math.floor((Date.now() - daysBack * 86400 * 1000) / 1000);
	}

	let imported = 0;
	let updated = 0;
	let page = 1;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		let url = `https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}`;
		if (after != null) {
			url += `&after=${after}`;
		}

		const listRes = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!listRes.ok) {
			if (page === 1) {
				return c.json({ error: `Strava API error: ${listRes.status}` }, 502);
			}
			console.warn(
				`[strava] Strava API error on page ${page}: ${listRes.status}`,
			);
			break;
		}

		const pageActivities = (await listRes.json()) as StravaActivity[];
		if (pageActivities.length === 0) break;

		const rides = pageActivities.filter(
			(a) => RIDE_TYPES.has(a.type) || RIDE_TYPES.has(a.sport_type),
		);

		for (const activity of rides) {
			try {
				const result = await importSingleActivity(
					userId,
					activity.id,
					accessToken,
				);
				if (result === "imported") imported++;
				else if (result === "updated") updated++;
			} catch (err) {
				console.error(
					`[strava] Failed to import activity ${activity.id}:`,
					err,
				);
			}
		}

		if (pageActivities.length < 100) break;
		page++;
	}

	return c.json({ imported, updated });
});

// ─── Clubs & Group Events ───────────────────────────────────────────────────

interface StravaClubResponse {
	id: number;
	name: string;
	description: string | null;
	sport_type: string;
	city: string | null;
	state: string | null;
	country: string | null;
	member_count: number;
	cover_photo: string | null;
}

interface StravaGroupEventResponse {
	id: number;
	title: string;
	sport_type: string;
	description: string | null;
	address: string | null;
	city: string | null;
	state: string | null;
	route: {
		id: number;
		id_str: string;
		name: string;
		map?: { summary_polyline?: string } | null;
		map_urls?: Record<string, string> | null;
	} | null;
	organizer: { id: number; name: string } | null;
	participant_count: number | null;
	upcoming_occurrences: string[];
}

/**
 * GET /api/strava/events — fetches all clubs and their group events,
 * returning upcoming and past events across all clubs.
 */
strava.get("/events", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Missing x-authentik-username header" }, 401);
	}

	let accessToken: string;
	try {
		accessToken = await getValidToken(userId);
	} catch (err) {
		if (
			err instanceof Error &&
			err.message === "Strava not connected for this user"
		) {
			return c.json({ error: "Strava not connected for this user" }, 401);
		}
		console.error("[strava] Token refresh/upstream error:", err);
		return c.json({ error: "Strava token refresh/upstream error" }, 502);
	}

	const clubsRes = await fetch(
		"https://www.strava.com/api/v3/athlete/clubs?per_page=100",
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);

	if (!clubsRes.ok) {
		return c.json({ error: `Strava API error: ${clubsRes.status}` }, 502);
	}

	const clubs = (await clubsRes.json()) as StravaClubResponse[];

	const allEvents: StravaClubEvent[] = [];

	const now = new Date();

	for (const club of clubs) {
		try {
			const eventsRes = await fetch(
				`https://www.strava.com/api/v3/clubs/${club.id}/group_events`,
				{ headers: { Authorization: `Bearer ${accessToken}` } },
			);

			if (!eventsRes.ok) continue;

			const events = (await eventsRes.json()) as StravaGroupEventResponse[];

			for (const e of events) {
				const hasUpcoming = e.upcoming_occurrences.some(
					(occ) => new Date(occ) >= now,
				);
				allEvents.push({
					id: e.id,
					clubId: club.id,
					clubName: club.name,
					title: e.title,
					sportType: e.sport_type,
					description: e.description,
					address: e.address,
					city: e.city,
					state: e.state,
					route: e.route
						? {
								id: e.route.id_str ?? String(e.route.id),
								name: e.route.name,
							}
						: null,
					organizer: e.organizer,
					participantCount: e.participant_count,
					upcomingOccurrences: e.upcoming_occurrences,
					isPast: !hasUpcoming,
				});
			}
		} catch (_err) {
			// skip clubs whose group_events endpoint fails
		}
	}

	// Sort: newest first (descending by primary date)
	allEvents.sort((a, b) => {
		const aDate = a.upcomingOccurrences[0]
			? new Date(a.upcomingOccurrences[0]).getTime()
			: 0;
		const bDate = b.upcomingOccurrences[0]
			? new Date(b.upcomingOccurrences[0]).getTime()
			: 0;
		return bDate - aDate;
	});

	return c.json({ events: allEvents });
});

/**
 * GET /api/strava/routes/:id/gpx — returns parsed route coordinates for map display.
 */
strava.get("/routes/:id/gpx", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Missing x-authentik-username header" }, 401);
	}
	const routeId = c.req.param("id");

	let accessToken: string;
	try {
		accessToken = await getValidToken(userId);
	} catch (err) {
		if (
			err instanceof Error &&
			err.message === "Strava not connected for this user"
		) {
			return c.json({ error: "Strava not connected for this user" }, 401);
		}
		console.error("[strava] Token refresh/upstream error:", err);
		return c.json({ error: "Strava token refresh/upstream error" }, 502);
	}

	const gpxRes = await fetch(
		`https://www.strava.com/api/v3/routes/${routeId}/export_gpx`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);

	if (!gpxRes.ok) {
		console.error(
			`[strava] Route ${routeId} GPX fetch failed: ${gpxRes.status}`,
		);
		return c.json(
			{ error: `Failed to fetch GPX for route ${routeId}: ${gpxRes.status}` },
			502,
		);
	}

	const gpx = await gpxRes.text();
	const coords: [number, number][] = [];
	const trkptRegex = /<trkpt\b[^>]*>/g;
	let match: RegExpExecArray | null;
	for (;;) {
		match = trkptRegex.exec(gpx);
		if (match === null) break;
		const tag = match[0];
		const latMatch = /lat="([^"]+)"/.exec(tag);
		const lonMatch = /lon="([^"]+)"/.exec(tag);
		if (latMatch && lonMatch) {
			coords.push([
				Number.parseFloat(latMatch[1]),
				Number.parseFloat(lonMatch[1]),
			]);
		}
	}

	return c.json({ coordinates: coords, gpx });
});

/**
 * GET /api/strava/routes/:id/gpx/download — returns raw GPX file for download.
 */
strava.get("/routes/:id/gpx/download", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Missing x-authentik-username header" }, 401);
	}
	const routeId = c.req.param("id");

	let accessToken: string;
	try {
		accessToken = await getValidToken(userId);
	} catch (err) {
		if (
			err instanceof Error &&
			err.message === "Strava not connected for this user"
		) {
			return c.json({ error: "Strava not connected for this user" }, 401);
		}
		console.error("[strava] Token refresh/upstream error:", err);
		return c.json({ error: "Strava token refresh/upstream error" }, 502);
	}

	const gpxRes = await fetch(
		`https://www.strava.com/api/v3/routes/${routeId}/export_gpx`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);

	if (!gpxRes.ok) {
		return c.json({ error: `Failed to fetch GPX: ${gpxRes.status}` }, 502);
	}

	const gpx = await gpxRes.text();

	return new Response(gpx, {
		headers: {
			"Content-Type": "application/gpx+xml",
			"Content-Disposition": `attachment; filename="route-${routeId}.gpx"`,
		},
	});
});

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * GET /api/strava/webhook — Strava subscription verification challenge.
 * Called by Strava when you register (or Strava re-validates) the webhook.
 * Must respond with {"hub.challenge": "<value>"} within 2 seconds.
 */
strava.get("/webhook", (c) => {
	const mode = c.req.query("hub.mode");
	const token = c.req.query("hub.verify_token");
	const challenge = c.req.query("hub.challenge");

	if (!env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
		console.error(
			"[strava webhook] STRAVA_WEBHOOK_VERIFY_TOKEN is not configured",
		);
		return c.json({ error: "Webhook not configured" }, 501);
	}

	if (mode !== "subscribe" || token !== env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
		console.warn(
			`[strava webhook] Verification failed: mode=${mode}, token mismatch=${token !== env.STRAVA_WEBHOOK_VERIFY_TOKEN}`,
		);
		return c.json({ error: "Forbidden" }, 403);
	}

	console.log("[strava webhook] Subscription verified by Strava");
	return c.json({ "hub.challenge": challenge });
});

/**
 * POST /api/strava/webhook — Strava event delivery.
 * Strava sends this when any connected athlete creates, updates, or deletes an activity.
 * We respond immediately with 200 and process the import in the background.
 */
strava.post("/webhook", async (c) => {
	const event = await c.req.json<StravaWebhookEvent>();

	// Acknowledge immediately — Strava requires a response within 2 seconds
	const response = c.json({}, 200);

	// Only handle activity creation events
	if (event.object_type !== "activity" || event.aspect_type !== "create") {
		return response;
	}

	// Look up which local user owns this athlete
	const tokenRow = getTokenByAthleteStmt.get(event.owner_id);
	if (!tokenRow) {
		console.log(
			`[strava webhook] No local user for athlete ${event.owner_id} — ignoring`,
		);
		return response;
	}

	// Process in background — don't block the response
	(async () => {
		try {
			const accessToken = await getValidToken(tokenRow.user_id);
			const result = await importSingleActivity(
				tokenRow.user_id,
				event.object_id,
				accessToken,
			);
			if (result) {
				console.log(
					`[strava webhook] Auto-${result} activity ${event.object_id} for user ${tokenRow.user_id}`,
				);
			} else {
				console.log(
					`[strava webhook] Activity ${event.object_id} skipped (not a ride)`,
				);
			}
		} catch (err) {
			console.error(
				`[strava webhook] Failed to import activity ${event.object_id}:`,
				err,
			);
		}
	})();

	return response;
});

/**
 * POST /api/strava/webhook/subscription — register the webhook with Strava.
 * Call this once from the settings page (or via curl) after deploying to a public URL.
 */
strava.post("/webhook/subscription", async (c) => {
	try {
		getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
		return c.json({ error: "Strava credentials not configured" }, 501);
	}
	if (!env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
		return c.json(
			{ error: "STRAVA_WEBHOOK_VERIFY_TOKEN is not configured" },
			501,
		);
	}
	if (!env.STRAVA_REDIRECT_URI) {
		return c.json({ error: "STRAVA_REDIRECT_URI is not configured" }, 501);
	}

	// Derive webhook callback URL from redirect URI (same origin, different path)
	const callbackUrl = env.STRAVA_REDIRECT_URI.replace(
		/\/callback$/,
		"/webhook",
	);

	const res = await fetch("https://www.strava.com/api/v3/push_subscriptions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: env.STRAVA_CLIENT_ID,
			client_secret: env.STRAVA_CLIENT_SECRET,
			callback_url: callbackUrl,
			verify_token: env.STRAVA_WEBHOOK_VERIFY_TOKEN,
		}),
	});

	const data = await res.json();

	if (!res.ok) {
		console.error("[strava webhook] Subscription registration failed:", data);
		return c.json(
			{
				error: (data as { message?: string }).message ?? "Registration failed",
			},
			502,
		);
	}

	console.log("[strava webhook] Subscription registered:", data);
	return c.json(data, 201);
});

/**
 * DELETE /api/strava/webhook/subscription — remove the active webhook subscription.
 */
strava.delete("/webhook/subscription", async (c) => {
	try {
		getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
		return c.json({ error: "Strava credentials not configured" }, 501);
	}

	// List subscriptions to find the ID
	const listRes = await fetch(
		`https://www.strava.com/api/v3/push_subscriptions?client_id=${env.STRAVA_CLIENT_ID}&client_secret=${env.STRAVA_CLIENT_SECRET}`,
	);
	if (!listRes.ok) {
		return c.json(
			{ error: `Failed to list subscriptions: ${listRes.status}` },
			502,
		);
	}

	const subscriptions = (await listRes.json()) as Array<{ id: number }>;
	if (subscriptions.length === 0) {
		return c.json({ error: "No active webhook subscription found" }, 404);
	}

	const subId = subscriptions[0].id;
	const delRes = await fetch(
		`https://www.strava.com/api/v3/push_subscriptions/${subId}?client_id=${env.STRAVA_CLIENT_ID}&client_secret=${env.STRAVA_CLIENT_SECRET}`,
		{ method: "DELETE" },
	);

	if (!delRes.ok && delRes.status !== 204) {
		return c.json(
			{ error: `Failed to delete subscription: ${delRes.status}` },
			502,
		);
	}

	console.log(`[strava webhook] Subscription ${subId} deleted`);
	return c.json({ ok: true, deletedId: subId });
});

export { strava };
