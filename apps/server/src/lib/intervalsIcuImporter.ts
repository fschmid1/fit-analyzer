import { db } from "../db.js";
import { importActivity, isActivityImported } from "./activityImporter.js";
import { listIntervalsIcuActivities } from "./intervalsIcuClient.js";
import {
	getIntervalsIcuConnection,
	listPollableIntervalsIcuUsers,
	markIntervalsIcuPollFailure,
	markIntervalsIcuPollSuccess,
	recordIntervalsIcuBackfillProgress,
	finishIntervalsIcuBackfill,
	startIntervalsIcuBackfill,
} from "./intervalsIcuConnection.js";
import {
	intervalsIcuActivityToPayload,
	isoLocalDate,
} from "./intervalsIcuImportAdapter.js";
import { getTrainingTimezone } from "./trainingTimezone.js";
import { getNtfyTopic } from "./notificationSettings.js";
import { sendNtfy } from "./ntfy.js";

/**
 * IntervalsIcu activity import: a five-minute poll plus the opt-in 90-day
 * backfill, both through the same importer (ADR-0005).
 *
 * Only rides are considered, and only rides intervals.icu can hand over as raw
 * seconds — Strava-sourced activities are skipped. Import is idempotent: a ride
 * already stored for this user is never re-fetched, and a ride that arrived
 * earlier from Strava or a FIT upload gets the intervals.icu id stamped onto its
 * existing row (see activityImporter).
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const POLL_OVERLAP_DAYS = 3;
const BACKFILL_DAYS = 90;
const BACKFILL_CHUNK_DAYS = 14;
/** After this many consecutive failed polls the athlete is notified, once. */
const MAX_POLL_FAILURES = 3;

export interface IntervalsIcuSyncOutcome {
	imported: number;
	updated: number;
	skipped: number;
	failed: number;
	errors: string[];
}

async function notifyPollFailures(
	userId: string,
	failures: number,
	message: string,
): Promise<void> {
	const topic = getNtfyTopic(userId);
	if (!topic) return;
	try {
		await sendNtfy(topic, {
			title: "intervals.icu import failing",
			body: `${failures} activity syncs in a row failed: ${message}`,
			tags: "warning,bicycle",
		});
	} catch (err) {
		console.error(`[intervals-icu] ntfy failed for ${userId}:`, err);
	}
}

/** Local ISO date `days` before `from` (negative days go forward). */
function shiftDate(from: Date, days: number): string {
	const d = new Date(from);
	d.setDate(d.getDate() + days);
	return isoLocalDate(d);
}

function isAuthError(message: string): boolean {
	return /\b401\b|\b403\b|unauthori[sz]ed|forbidden/i.test(message);
}

async function syncWindow(
	userId: string,
	apiKey: string,
	oldest: string,
	newest: string,
	timezone: string | null,
): Promise<IntervalsIcuSyncOutcome> {
	const outcome: IntervalsIcuSyncOutcome = {
		imported: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
		errors: [],
	};
	const activities = await listIntervalsIcuActivities(apiKey, oldest, newest);

	for (const activity of activities) {
		if (isActivityImported(db, "intervals-icu", activity.id, userId)) {
			outcome.skipped += 1;
			continue;
		}
		try {
			const result = await intervalsIcuActivityToPayload(
				userId,
				apiKey,
				activity,
				timezone,
			);
			if ("skipped" in result) {
				outcome.skipped += 1;
				continue;
			}
			const imported = await importActivity(db, result.payload);
			if (imported.status === "imported") outcome.imported += 1;
			else if (imported.status === "updated") outcome.updated += 1;
			else outcome.skipped += 1;
		} catch (err) {
			outcome.failed += 1;
			outcome.errors.push(`activity ${activity.id}: ${(err as Error).message}`);
		}
	}
	return outcome;
}

/**
 * One incremental sync for a user, covering a few days back so a ride that
 * landed late is still picked up. Returns the outcome; throws only when the
 * activity list itself cannot be fetched (the poller's failure path).
 */
export async function syncIntervalsIcuActivities(
	userId: string,
	options: { days?: number; now?: Date } = {},
): Promise<IntervalsIcuSyncOutcome> {
	const connection = getIntervalsIcuConnection(userId);
	if (!connection?.api_key) throw new Error("intervals.icu is not connected");
	const now = options.now ?? new Date();
	const oldest = shiftDate(now, -(options.days ?? POLL_OVERLAP_DAYS));
	const newest = shiftDate(now, 1);
	const timezone = getTrainingTimezone(userId);
	return syncWindow(userId, connection.api_key, oldest, newest, timezone);
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

const backfillRunning = new Set<string>();

/** Start the opt-in 90-day backfill as a background job, once per user. */
export function startBackfillInBackground(userId: string): void {
	if (backfillRunning.has(userId)) return;
	backfillRunning.add(userId);
	startIntervalsIcuBackfill(userId);
	void runBackfill(userId)
		.catch((err) => {
			console.error(`[intervals-icu] Backfill failed for ${userId}:`, err);
			finishIntervalsIcuBackfill(userId, (err as Error).message);
		})
		.finally(() => backfillRunning.delete(userId));
}

async function runBackfill(userId: string): Promise<void> {
	const connection = getIntervalsIcuConnection(userId);
	if (!connection?.api_key) throw new Error("intervals.icu is not connected");
	const timezone = getTrainingTimezone(userId);
	const now = new Date();

	let imported = 0;
	let failed = 0;
	const errors: string[] = [];

	for (let offset = BACKFILL_DAYS; offset > 0; offset -= BACKFILL_CHUNK_DAYS) {
		const chunkStart = Math.max(0, offset - BACKFILL_CHUNK_DAYS);
		const oldest = shiftDate(now, -offset);
		const newest = shiftDate(now, -chunkStart);
		try {
			const outcome = await syncWindow(
				userId,
				connection.api_key,
				oldest,
				newest,
				timezone,
			);
			imported += outcome.imported + outcome.updated;
			failed += outcome.failed;
			errors.push(...outcome.errors);
			recordIntervalsIcuBackfillProgress(userId, imported, failed);
		} catch (err) {
			failed += 1;
			errors.push((err as Error).message);
			recordIntervalsIcuBackfillProgress(userId, imported, failed);
		}
	}

	console.log(
		`[intervals-icu] Backfill for ${userId}: ${imported} imported, ${failed} failed`,
	);
	finishIntervalsIcuBackfill(
		userId,
		failed > 0 ? `${failed} activity(ies) failed: ${errors[0] ?? ""}` : null,
	);
}

// ─── Poller ───────────────────────────────────────────────────────────────────

const syncing = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/**
 * Record one failed poll. A `401`/`403` (or an auth word) means the key is no
 * longer usable: it is flagged so the poller stops, and the Settings banner is
 * the notification — no ntfy flood. Any other failure notifies exactly at the
 * threshold, once per streak.
 */
async function handlePollFailure(
	userId: string,
	message: string,
): Promise<void> {
	console.error(`[intervals-icu] Poll failed for ${userId}: ${message}`);
	const prior = getIntervalsIcuConnection(userId)?.poll_failures ?? 0;
	const failures = prior + 1;
	const revoked = isAuthError(message);
	markIntervalsIcuPollFailure(userId, message, revoked);
	if (failures === MAX_POLL_FAILURES && !revoked) {
		await notifyPollFailures(userId, failures, message);
	}
}

/** Run one poller pass over every connected, usable key. */
export async function runIntervalsIcuPollerTick(): Promise<void> {
	if (ticking) return;
	ticking = true;
	try {
		for (const { userId } of listPollableIntervalsIcuUsers()) {
			if (syncing.has(userId) || backfillRunning.has(userId)) continue;
			syncing.add(userId);
			try {
				const outcome = await syncIntervalsIcuActivities(userId);
				if (outcome.failed > 0) {
					// The list loaded, but some rides did not: count the pass as
					// failed so a persistently broken ride still notifies.
					await handlePollFailure(
						userId,
						`${outcome.failed} activity import(s) failed: ${outcome.errors[0] ?? "unknown error"}`,
					);
				} else {
					markIntervalsIcuPollSuccess(userId);
				}
				if (outcome.imported + outcome.updated + outcome.failed > 0) {
					console.log(
						`[intervals-icu] Poll for ${userId}: ${outcome.imported} imported, ${outcome.updated} updated, ${outcome.failed} failed`,
					);
				}
			} catch (err) {
				await handlePollFailure(
					userId,
					err instanceof Error ? err.message : String(err),
				);
			} finally {
				syncing.delete(userId);
			}
		}
	} finally {
		ticking = false;
	}
}

/** Start the five-minute activity poller (idempotent). */
export function startIntervalsIcuPoller(): void {
	if (timer) return;
	timer = setInterval(() => {
		void runIntervalsIcuPollerTick().catch((err) => {
			console.error("[intervals-icu] Poller tick failed:", err);
		});
	}, POLL_INTERVAL_MS);
	// Run once shortly after startup so a restart does not wait five minutes.
	void runIntervalsIcuPollerTick().catch((err) => {
		console.error("[intervals-icu] Startup poll failed:", err);
	});
}
