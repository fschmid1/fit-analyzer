import { Hono } from "hono";
import { db } from "../db.js";
import { env } from "../env.js";
import type { ActivitySummary, StoredRecord, LapMarker } from "@fit-analyzer/shared";

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
  average_watts?: number;
  max_watts?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  kilojoules?: number;
}

interface StravaStream {
  type: string;
  data: number[];
}

interface StravaStreams {
  time?: StravaStream;
  watts?: StravaStream;
  heartrate?: StravaStream;
  cadence?: StravaStream;
  velocity_smooth?: StravaStream;
  grade_smooth?: StravaStream;
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
  object_type: string;   // "activity" | "athlete"
  aspect_type: string;   // "create" | "update" | "delete"
  object_id: number;     // activity ID
  owner_id: number;      // athlete ID
  subscription_id: number;
  event_time: number;
  updates?: Record<string, string>;
}

// ─── CSRF State Store ─────────────────────────────────────────────────────────

/** state UUID → expiry timestamp (ms) */
const pendingStates = new Map<string, number>();

/** Prune expired states to avoid unbounded growth */
function pruneStates() {
  const now = Date.now();
  for (const [key, exp] of pendingStates) {
    if (now > exp) pendingStates.delete(key);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
  const userId = c.req.header("x-authentik-username");
  if (!userId) throw new Error("Missing x-authentik-username header");
  return userId;
}

const getTokenStmt = db.prepare<StoredToken, [string]>(
  `SELECT user_id, access_token, refresh_token, expires_at, athlete_id, scope
   FROM strava_tokens WHERE user_id = ?`
);

const getTokenByAthleteStmt = db.prepare<StoredToken, [number]>(
  `SELECT user_id, access_token, refresh_token, expires_at, athlete_id, scope
   FROM strava_tokens WHERE athlete_id = ?`
);

const upsertTokenStmt = db.prepare(
  `INSERT OR REPLACE INTO strava_tokens
     (user_id, access_token, refresh_token, expires_at, athlete_id, scope, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
);

const updateTokenStmt = db.prepare(
  `UPDATE strava_tokens
   SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
   WHERE user_id = ?`
);

const checkStravaActivityStmt = db.prepare<{ id: string }, [string, string]>(
  `SELECT id FROM activities WHERE user_id = ? AND strava_activity_id = ?`
);

const insertActivityStmt = db.prepare(
  `INSERT INTO activities
     (id, date, summary, records, laps, intervals, user_id, strava_activity_id)
   VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`
);

/** Return a valid access token for the user, refreshing if within 60s of expiry. */
async function getValidToken(userId: string): Promise<string> {
  const token = getTokenStmt.get(userId);
  if (!token) throw new Error("Strava not connected for this user");

  if (Math.floor(Date.now() / 1000) >= token.expires_at - 60) {
    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = (await res.json()) as StravaTokenResponse;
    updateTokenStmt.run(data.access_token, data.refresh_token, data.expires_at, userId);
    return data.access_token;
  }

  return token.access_token;
}

/** Compute the best average power for a rolling time window (in seconds). */
function computePeakPower(
  timeArr: number[],
  wattsArr: number[],
  windowSecs: number
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

  return timeData.map((elapsed, i) => ({
    timestamp: new Date(startDate.getTime() + elapsed * 1000).toISOString(),
    elapsedSeconds: elapsed,
    power: wattsData[i] ?? null,
    heartRate: hrData[i] ?? null,
    cadence: cadData[i] ?? null,
    speed: velData[i] ?? null,
    gradient: gradeData[i] ?? null,
  }));
}

/** Build ActivitySummary from a Strava activity + streams data. */
function buildSummary(
  activity: StravaActivity,
  timeArr: number[],
  wattsArr: number[]
): ActivitySummary {
  return {
    date: activity.start_date.slice(0, 10),
    totalTimerTime: activity.moving_time,
    avgPower: activity.average_watts ?? null,
    maxPower: activity.max_watts ?? null,
    avgHeartRate: activity.average_heartrate ?? null,
    maxHeartRate: activity.max_heartrate ?? null,
    avgCadence: activity.average_cadence ?? null,
    totalWork: activity.kilojoules != null ? activity.kilojoules * 1000 : null,
    peak1minPower: computePeakPower(timeArr, wattsArr, 60),
    peak5minPower: computePeakPower(timeArr, wattsArr, 300),
  };
}

/** Build LapMarker[] from Strava laps, converting stream indices to elapsed seconds. */
function buildLaps(laps: StravaLap[], timeArr: number[]): LapMarker[] {
  return laps.map((lap) => ({
    startSeconds: timeArr[lap.start_index] ?? lap.start_index,
    endSeconds: timeArr[Math.min(lap.end_index, timeArr.length - 1)] ?? lap.end_index,
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
  accessToken: string
): Promise<boolean> {
  const stravaId = String(stravaActivityId);

  // Skip if already imported
  if (checkStravaActivityStmt.get(userId, stravaId)) return false;

  // Fetch full activity details
  const actRes = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!actRes.ok) throw new Error(`Failed to fetch activity ${stravaActivityId}: ${actRes.status}`);
  const activity = (await actRes.json()) as StravaActivity;

  // Only import rides
  if (!RIDE_TYPES.has(activity.type) && !RIDE_TYPES.has(activity.sport_type)) return false;

  // Fetch streams
  const streamsRes = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}/streams` +
      `?keys=time,watts,heartrate,cadence,velocity_smooth,grade_smooth&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const streams: StravaStreams = streamsRes.ok
    ? ((await streamsRes.json()) as StravaStreams)
    : {};

  if (!streamsRes.ok) {
    console.warn(`[strava] Streams unavailable for activity ${stravaActivityId}: ${streamsRes.status}`);
  }

  // Fetch laps
  const lapsRes = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaActivityId}/laps`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const rawLaps: StravaLap[] = lapsRes.ok ? ((await lapsRes.json()) as StravaLap[]) : [];

  const timeArr = streams.time?.data ?? [];
  const wattsArr = streams.watts?.data ?? [];
  const startDate = new Date(activity.start_date);

  const records = buildRecords(startDate, streams);
  const summary = buildSummary(activity, timeArr, wattsArr);
  const laps = buildLaps(rawLaps, timeArr);

  const id = crypto.randomUUID();
  insertActivityStmt.run(
    id,
    summary.date,
    JSON.stringify(summary),
    JSON.stringify(records),
    JSON.stringify(laps),
    userId,
    stravaId
  );

  console.log(`[strava] Imported activity ${stravaActivityId} (${activity.name}) → ${id}`);
  return true;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/strava/connect — redirect to Strava OAuth */
strava.get("/connect", (c) => {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return c.json({ error: "STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are not configured" }, 501);
  }
  if (!env.STRAVA_REDIRECT_URI) {
    return c.json({ error: "STRAVA_REDIRECT_URI is not configured" }, 501);
  }

  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  pruneStates();
  const state = crypto.randomUUID();
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: env.STRAVA_REDIRECT_URI,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });

  console.log(`[strava] Initiating OAuth for user ${userId}`);
  return c.redirect(`https://www.strava.com/oauth/authorize?${params.toString()}`);
});

/** GET /api/strava/callback — exchange code for tokens */
strava.get("/callback", async (c) => {
  const { code, state, error } = c.req.query();

  if (error || !code || !state) {
    console.warn(`[strava] OAuth denied or missing params: ${error ?? "no code/state"}`);
    return c.redirect("/settings?strava=error");
  }

  pruneStates();
  if (!pendingStates.has(state)) {
    console.warn("[strava] Invalid or expired state parameter");
    return c.redirect("/settings?strava=error");
  }
  pendingStates.delete(state);

  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.redirect("/settings?strava=error");
  }

  try {
    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      console.error(`[strava] Token exchange failed: ${res.status}`);
      return c.redirect("/settings?strava=error");
    }

    const data = (await res.json()) as StravaTokenResponse;

    upsertTokenStmt.run(
      userId,
      data.access_token,
      data.refresh_token,
      data.expires_at,
      data.athlete.id,
      data.scope ?? ""
    );

    console.log(`[strava] Connected athlete ${data.athlete.id} for user ${userId}`);
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

  return c.json({ connected: true, athleteId: token.athlete_id, scope: token.scope });
});

/** DELETE /api/strava/disconnect — remove stored tokens */
strava.delete("/disconnect", (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  db.prepare(`DELETE FROM strava_tokens WHERE user_id = ?`).run(userId);
  console.log(`[strava] Disconnected user ${userId}`);
  return c.json({ ok: true });
});

/** POST /api/strava/sync — import recent ride activities */
strava.post("/sync", async (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const daysBack = Number(c.req.query("daysBack") ?? "30");
  if (isNaN(daysBack) || daysBack < 1 || daysBack > 365) {
    return c.json({ error: "daysBack must be between 1 and 365" }, 400);
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken(userId);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const after = Math.floor((Date.now() - daysBack * 86400 * 1000) / 1000);

  const listRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=100&after=${after}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    return c.json({ error: `Strava API error: ${listRes.status}` }, 502);
  }

  const allActivities = (await listRes.json()) as StravaActivity[];
  const rides = allActivities.filter(
    (a) => RIDE_TYPES.has(a.type) || RIDE_TYPES.has(a.sport_type)
  );

  let imported = 0;
  let skipped = 0;

  for (const activity of rides) {
    try {
      const wasImported = await importSingleActivity(userId, activity.id, accessToken);
      wasImported ? imported++ : skipped++;
    } catch (err) {
      console.error(`[strava] Failed to import activity ${activity.id}:`, err);
    }
  }

  return c.json({ imported, skipped });
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
    console.error("[strava webhook] STRAVA_WEBHOOK_VERIFY_TOKEN is not configured");
    return c.json({ error: "Webhook not configured" }, 501);
  }

  if (mode !== "subscribe" || token !== env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    console.warn(`[strava webhook] Verification failed: mode=${mode}, token mismatch=${token !== env.STRAVA_WEBHOOK_VERIFY_TOKEN}`);
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
    console.log(`[strava webhook] No local user for athlete ${event.owner_id} — ignoring`);
    return response;
  }

  // Process in background — don't block the response
  (async () => {
    try {
      const accessToken = await getValidToken(tokenRow.user_id);
      const imported = await importSingleActivity(tokenRow.user_id, event.object_id, accessToken);
      if (imported) {
        console.log(`[strava webhook] Auto-imported activity ${event.object_id} for user ${tokenRow.user_id}`);
      } else {
        console.log(`[strava webhook] Activity ${event.object_id} skipped (already exists or not a ride)`);
      }
    } catch (err) {
      console.error(`[strava webhook] Failed to import activity ${event.object_id}:`, err);
    }
  })();

  return response;
});

/**
 * POST /api/strava/webhook/subscription — register the webhook with Strava.
 * Call this once from the settings page (or via curl) after deploying to a public URL.
 */
strava.post("/webhook/subscription", async (c) => {
  try { getUserId(c); } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return c.json({ error: "Strava credentials not configured" }, 501);
  }
  if (!env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return c.json({ error: "STRAVA_WEBHOOK_VERIFY_TOKEN is not configured" }, 501);
  }
  if (!env.STRAVA_REDIRECT_URI) {
    return c.json({ error: "STRAVA_REDIRECT_URI is not configured" }, 501);
  }

  // Derive webhook callback URL from redirect URI (same origin, different path)
  const callbackUrl = env.STRAVA_REDIRECT_URI.replace(/\/callback$/, "/webhook");

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
    return c.json({ error: (data as { message?: string }).message ?? "Registration failed" }, 502);
  }

  console.log("[strava webhook] Subscription registered:", data);
  return c.json(data, 201);
});

/**
 * DELETE /api/strava/webhook/subscription — remove the active webhook subscription.
 */
strava.delete("/webhook/subscription", async (c) => {
  try { getUserId(c); } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    return c.json({ error: "Strava credentials not configured" }, 501);
  }

  // List subscriptions to find the ID
  const listRes = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions?client_id=${env.STRAVA_CLIENT_ID}&client_secret=${env.STRAVA_CLIENT_SECRET}`
  );
  if (!listRes.ok) {
    return c.json({ error: `Failed to list subscriptions: ${listRes.status}` }, 502);
  }

  const subscriptions = (await listRes.json()) as Array<{ id: number }>;
  if (subscriptions.length === 0) {
    return c.json({ error: "No active webhook subscription found" }, 404);
  }

  const subId = subscriptions[0].id;
  const delRes = await fetch(
    `https://www.strava.com/api/v3/push_subscriptions/${subId}?client_id=${env.STRAVA_CLIENT_ID}&client_secret=${env.STRAVA_CLIENT_SECRET}`,
    { method: "DELETE" }
  );

  if (!delRes.ok && delRes.status !== 204) {
    return c.json({ error: `Failed to delete subscription: ${delRes.status}` }, 502);
  }

  console.log(`[strava webhook] Subscription ${subId} deleted`);
  return c.json({ ok: true, deletedId: subId });
});

export { strava };
