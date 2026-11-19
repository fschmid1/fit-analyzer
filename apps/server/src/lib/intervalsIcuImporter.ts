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
	isIntervalsIcuRide,
	isStravaSourced,
} from "./intervalsIcuImportAdapter.js";
import { intervalsIcuSessionFromActivity } from "./intervalsIcuSessionAdapter.js";
import { crossTrainingSessionRepo } from "./crossTrainingSessionRepo.js";
import { getTrainingTimezone } from "./trainingTimezone.js";
import { getNtfyTopic } from "./notificationSettings.js";
import { sendNtfy } from "./ntfy.js";

/**
 * IntervalsIcu activity import: a five-minute poll plus the opt-in 90-day
 * backfill, both through the same importer (ADR-0005).
 *
 * Rides become Activities, imported from raw per-second streams. Every other
 * completed activity becomes a summary-only Cross-training session for the
 * coach. Strava-sourced activities of either kind are skipped: intervals.icu
 * serves only a stub for them, and Strava's terms forbid re-downloading their
 * data through a third party. Import is idempotent: a ride already stored for
 * this user is never re-fetched, a session already stored is never rewritten,
 * and a ride that arrived earlier from Strava or a FIT upload gets the
 * intervals.icu id stamped onto its existing row (see activityImporter).
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const POLL_OVERLAP_DAYS = 3;
const BACKFILL_DAYS = 90;
const BACKFILL_CHUNK_DAYS = 14;
/** After this many consecutive failed polls the athlete is notified, once. */
const MAX_POLL_FAILURES = 3;

export interface IntervalsIcuSyncOutcome {
	/** Rides imported into activities. */
	imported: number;
	/** Rides refreshed in place. */
	updated: number;
	/** Non-ride sessions imported into cross_training_sessions. */
	sessionsImported: number;
	/** Non-ride sessions refreshed in place. */
	sessionsUpdated: number;
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
		sessionsImported: 0,
		sessionsUpdated: 0,
		skipped: 0,
		failed: 0,
		errors: [],
	};
	const activities = await listIntervalsIcuActivities(apiKey, oldest, newest);

	for (const activity of activities) {
		try {
			if (isStravaSourced(activity)) {
				outcome.skipped += 1;
				continue;
			}

			if (isIntervalsIcuRide(activity)) {
				if (isActivityImported(db, "intervals-icu", activity.id, userId)) {
					outcome.skipped += 1;
					continue;
				}
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
				continue;
			}

			// Every other completed activity is context, not a ride: keep the
			// summary intervals.icu reports and never fetch its streams.
			const result = intervalsIcuSessionFromActivity(activity);
			if ("skipped" in result) {
				outcome.skipped += 1;
				continue;
			}
			// Upsert unconditionally: it is cheap and lets a provider-side edit
			// (renamed session, corrected duration) refresh the stored summary.
			const status = crossTrainingSessionRepo.upsert({
				...result.session,
				userId,
			});
			if (status === "imported") outcome.sessionsImported += 1;
			else if (status === "updated") outcome.sessionsUpdated += 1;
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
			imported +=
				outcome.imported +
				outcome.updated +
				outcome.sessionsImported +
				outcome.sessionsUpdated;
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
					// The list loaded, but some activities did not: count the pass
					// as failed so a persistently broken one still notifies.
					await handlePollFailure(
						userId,
						`${outcome.failed} activity import(s) failed: ${outcome.errors[0] ?? "unknown error"}`,
					);
				} else {
					markIntervalsIcuPollSuccess(userId);
				}
				if (
					outcome.imported +
						outcome.updated +
						outcome.sessionsImported +
						outcome.sessionsUpdated +
						outcome.failed >
					0
				) {
					console.log(
						`[intervals-icu] Poll for ${userId}: ${outcome.imported} rides imported, ${outcome.updated} rides updated, ${outcome.sessionsImported} sessions imported, ${outcome.sessionsUpdated} sessions updated, ${outcome.failed} failed`,
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
