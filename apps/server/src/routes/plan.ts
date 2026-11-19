import { Hono } from "hono";
import { getUserId } from "../lib/getUserId.js";
import {
	markManualRefreshError,
	markPlanRefreshed,
} from "../lib/planRefreshSettings.js";
import { duePlanWeek, duePlanWeekKey } from "../lib/planSchedule.js";
import { runPlanRefresh } from "../lib/planRefreshRunner.js";
import {
	primaryPlanTarget,
	getConnectedPlanTargets,
} from "../lib/planTargets.js";
import { readTrainingPlan } from "../lib/trainingPlan.js";
import { getTrainingTimezone } from "../lib/trainingTimezone.js";

/**
 * Plan routes, independent of any one target (ADR-0005): the plan is read back
 * from whichever target is primary. Connection setup lives in the target's own
 * routes (routes/google.ts, routes/intervalsIcu.ts).
 */

const plan = new Hono();

/** GET /api/plan — the forward plan projected from the primary target. */
plan.get("/", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	try {
		return c.json(await readTrainingPlan(userId));
	} catch (err) {
		return c.json(
			{
				error:
					err instanceof Error ? err.message : "Failed to read training plan",
			},
			502,
		);
	}
});

/**
 * POST /api/plan/refresh — run a Plan refresh on demand. Unlike the scheduled
 * refresh this runs regardless of the watermark (it is explicit), and it clears
 * any sticky error state on success.
 */
plan.post("/refresh", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const targets = getConnectedPlanTargets(userId);
	if (!primaryPlanTarget(targets)) {
		return c.json({ error: "No plan target is connected" }, 400);
	}
	const timezone = getTrainingTimezone(userId);
	if (!timezone) {
		return c.json({ error: "Training timezone is not set" }, 400);
	}

	const now = new Date();
	const weekStart = duePlanWeek(now, timezone);
	const weekKey = duePlanWeekKey(now, timezone);

	const result = await runPlanRefresh(userId, weekKey, weekStart);
	if (!result.ok) {
		// Manual refresh: record the error without consuming the scheduler's
		// capped retry budget for this week.
		markManualRefreshError(userId, result.error ?? "Plan refresh failed");
		return c.json({ error: result.error ?? "Plan refresh failed" }, 502);
	}

	markPlanRefreshed(userId, weekKey);
	return c.json({ ok: true, weekKey, plan: await readTrainingPlan(userId) });
});

export { plan };
