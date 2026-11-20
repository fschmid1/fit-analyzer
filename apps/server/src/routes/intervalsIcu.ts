import { Hono } from "hono";
import type { Context } from "hono";
import type {
	ConnectIntervalsIcuBody,
	StartIntervalsIcuBackfillBody,
} from "@fit-analyzer/shared";
import { getUserId } from "../lib/getUserId.js";
import { fetchIntervalsIcuAthlete } from "../lib/intervalsIcuClient.js";
import {
	deleteIntervalsIcuConnection,
	getIntervalsIcuConnection,
	getIntervalsIcuStatus,
	markIntervalsIcuPollSuccess,
	saveIntervalsIcuConnection,
} from "../lib/intervalsIcuConnection.js";
import {
	MAX_BACKFILL_DAYS,
	cancelIntervalsIcuBackfill,
	startBackfillInBackground,
	syncIntervalsIcuActivities,
} from "../lib/intervalsIcuImporter.js";
import { clearPlanSyncMarks } from "../lib/planSyncMarks.js";
import { setTrainingTimezone } from "../lib/trainingTimezone.js";
import { isValidTimezone } from "../lib/wallClock.js";

/**
 * IntervalsIcu connection routes: a personal API key (v1; OAuth is a later,
 * additive path) plus the opt-in history import. Domain logic lives in
 * lib/intervalsIcu{Connection,Client,Importer}.ts.
 */

const intervalsIcu = new Hono();

function userIdOrNull(c: Context): string | null {
	try {
		return getUserId(c);
	} catch {
		return null;
	}
}

/** GET /api/intervals-icu/status — connection + backfill progress. */
intervalsIcu.get("/status", (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	return c.json(getIntervalsIcuStatus(userId));
});

/** POST /api/intervals-icu/connect — verify + store a personal API key. */
intervalsIcu.post("/connect", async (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = await c.req.json<ConnectIntervalsIcuBody>().catch(() => null);
	const apiKey = body?.apiKey?.trim() ?? "";
	if (!apiKey) return c.json({ error: "apiKey is required" }, 400);
	if (!body?.timezone || !isValidTimezone(body.timezone)) {
		return c.json({ error: "Missing or invalid timezone" }, 400);
	}
	const backfillDays =
		typeof body.backfillDays === "number" ? body.backfillDays : null;
	if (
		backfillDays != null &&
		(!Number.isInteger(backfillDays) ||
			backfillDays < 0 ||
			backfillDays > MAX_BACKFILL_DAYS)
	) {
		return c.json(
			{ error: `backfillDays must be an integer 0–${MAX_BACKFILL_DAYS}` },
			400,
		);
	}

	let athlete: { id: string; name: string | null };
	try {
		athlete = await fetchIntervalsIcuAthlete(apiKey);
	} catch (err) {
		return c.json(
			{
				error: `intervals.icu rejected the key: ${(err as Error).message}`,
			},
			400,
		);
	}

	saveIntervalsIcuConnection(userId, {
		apiKey,
		athleteId: athlete.id,
		athleteName: athlete.name,
	});
	setTrainingTimezone(userId, body.timezone);
	const importStarted =
		backfillDays != null && backfillDays > 0
			? startBackfillInBackground(userId, backfillDays)
			: false;

	console.log(
		`[intervals-icu] Connected user ${userId} to athlete ${athlete.id}${
			importStarted ? ` (history import started: ${backfillDays} days)` : ""
		}`,
	);
	return c.json(getIntervalsIcuStatus(userId));
});

/**
 * POST /api/intervals-icu/backfill — import a chosen history window in the
 * background. Unlike /sync this is not bounded to the recent overlap window,
 * so the request returns immediately and progress is read from /status.
 */
intervalsIcu.post("/backfill", async (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = await c.req
		.json<StartIntervalsIcuBackfillBody>()
		.catch(() => null);
	const days = body?.days;
	if (
		typeof days !== "number" ||
		!Number.isInteger(days) ||
		days < 1 ||
		days > MAX_BACKFILL_DAYS
	) {
		return c.json(
			{ error: `days must be an integer 1–${MAX_BACKFILL_DAYS}` },
			400,
		);
	}

	const connection = getIntervalsIcuConnection(userId);
	if (!connection?.api_key) {
		return c.json({ error: "intervals.icu is not connected" }, 400);
	}
	if (!startBackfillInBackground(userId, days)) {
		return c.json({ error: "A history import is already running" }, 409);
	}
	return c.json(getIntervalsIcuStatus(userId));
});

/** DELETE /api/intervals-icu/disconnect — forget the key; plan events survive. */
intervalsIcu.delete("/disconnect", (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	cancelIntervalsIcuBackfill(userId);
	deleteIntervalsIcuConnection(userId);
	clearPlanSyncMarks(userId, "intervalsIcu");
	return c.json({ ok: true });
});

/** POST /api/intervals-icu/sync — "Sync now" for completed activities. */
intervalsIcu.post("/sync", async (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		// The quick action covers the recent overlap only. Longer history goes
		// through /backfill so the request never blocks on stream fetches.
		const outcome = await syncIntervalsIcuActivities(userId, {
			days: 90,
		});
		// A clean manual pass is a healthy connection: it resets the streak and
		// stamps last-sync, exactly like a clean poll.
		if (outcome.failed === 0) markIntervalsIcuPollSuccess(userId);
		return c.json({ ok: true, ...outcome });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "Sync failed" },
			502,
		);
	}
});

export { intervalsIcu };
