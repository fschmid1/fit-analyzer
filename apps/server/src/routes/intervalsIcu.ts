import { Hono } from "hono";
import type { Context } from "hono";
import type { ConnectIntervalsIcuBody } from "@fit-analyzer/shared";
import { getUserId } from "../lib/getUserId.js";
import { fetchIntervalsIcuAthlete } from "../lib/intervalsIcuClient.js";
import {
	deleteIntervalsIcuConnection,
	getIntervalsIcuStatus,
	markIntervalsIcuPollSuccess,
	saveIntervalsIcuConnection,
} from "../lib/intervalsIcuConnection.js";
import {
	startBackfillInBackground,
	syncIntervalsIcuActivities,
} from "../lib/intervalsIcuImporter.js";
import { clearPlanSyncMarks } from "../lib/planSyncMarks.js";
import { setTrainingTimezone } from "../lib/trainingTimezone.js";
import { isValidTimezone } from "../lib/wallClock.js";

/**
 * IntervalsIcu connection routes: a personal API key (v1; OAuth is a later,
 * additive path) plus the opt-in activity backfill. Domain logic lives in
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
	if (body.backfill) startBackfillInBackground(userId);

	console.log(
		`[intervals-icu] Connected user ${userId} to athlete ${athlete.id}${body.backfill ? " (backfill started)" : ""}`,
	);
	return c.json(getIntervalsIcuStatus(userId));
});

/** DELETE /api/intervals-icu/disconnect — forget the key; plan events survive. */
intervalsIcu.delete("/disconnect", (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	deleteIntervalsIcuConnection(userId);
	clearPlanSyncMarks(userId, "intervalsIcu");
	return c.json({ ok: true });
});

/** POST /api/intervals-icu/sync — "Sync now" for completed activities. */
intervalsIcu.post("/sync", async (c) => {
	const userId = userIdOrNull(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	try {
		const outcome = await syncIntervalsIcuActivities(userId, {
			days: 30,
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
