import {
	listDueRefreshes,
	markPlanRefreshError,
	markPlanRefreshed,
	planRefreshAttempts,
} from "./planRefreshSettings.js";
import { runPlanRefresh } from "./planRefreshRunner.js";
import { sendNtfy } from "./ntfy.js";
import { getNtfyTopic } from "./notificationSettings.js";

/**
 * The weekly Plan refresh scheduler (ADR-0003). An hourly tick — sub-daily so
 * every timezone and DST transition is handled — runs each opted-in user's
 * refresh when their local clock has crossed Sunday 18:00 and the Refresh
 * watermark is behind. Missed runs self-heal because the due check compares
 * watermarks rather than timers, so a tick after downtime catches up.
 *
 * Retries are capped per due week: on exhaustion the user gets one failure
 * notification and the scheduler stops hammering until the week advances.
 */

const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MAX_ATTEMPTS_PER_WEEK = 3;

let running = false;

async function notify(
	userId: string,
	title: string,
	body: string,
	tags: string,
) {
	const topic = getNtfyTopic(userId);
	if (!topic) return;
	try {
		await sendNtfy(topic, { title, body, tags });
	} catch (err) {
		console.error(`[plan-refresh] ntfy failed for ${userId}:`, err);
	}
}

/** Run one scheduler pass. Exported for tests and the startup catch-up. */
export async function runPlanRefreshTick(now = new Date()): Promise<void> {
	if (running) return;
	running = true;
	try {
		const due = listDueRefreshes(now);
		for (const entry of due) {
			const attempts = planRefreshAttempts(entry.userId, entry.weekKey);
			if (attempts >= MAX_ATTEMPTS_PER_WEEK) continue;

			const result = await runPlanRefresh(
				entry.userId,
				entry.weekKey,
				entry.weekStart,
			);

			if (result.ok) {
				markPlanRefreshed(entry.userId, entry.weekKey);
				// Ping only when the sync actually wrote something — an unchanged
				// plan is a valid, silent outcome (no "new plan" to announce).
				if (result.scheduledCount > 0) {
					await notify(
						entry.userId,
						"New training plan",
						`Your plan for ${entry.weekKey} is ready.`,
						"calendar,bike",
					);
				}
				continue;
			}

			const nextAttempts = markPlanRefreshError(
				entry.userId,
				result.error ?? "Plan refresh failed",
				entry.weekKey,
			);
			console.error(
				`[plan-refresh] Refresh failed for ${entry.userId} (attempt ${nextAttempts}): ${result.error}`,
			);
			if (nextAttempts >= MAX_ATTEMPTS_PER_WEEK) {
				await notify(
					entry.userId,
					"Training plan refresh failed",
					`Could not update your plan for ${entry.weekKey}: ${result.error}`,
					"warning,calendar",
				);
			}
		}
	} finally {
		running = false;
	}
}

/** Register the hourly tick. Returns a disposer so tests can stop it. */
export function startPlanRefreshScheduler(): () => void {
	const timer = setInterval(() => {
		// A tick must never become an unhandled rejection — a throw in the due
		// check or watermark write is logged and retried on the next tick.
		void runPlanRefreshTick().catch((err) => {
			console.error("[plan-refresh] Tick failed:", err);
		});
	}, TICK_INTERVAL_MS);
	// Don't hold the event loop open on the interval alone.
	timer.unref?.();
	console.log("[plan-refresh] Scheduler registered (hourly tick)");
	return () => clearInterval(timer);
}
