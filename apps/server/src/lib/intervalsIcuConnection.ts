import type {
	IntervalsIcuBackfill,
	IntervalsIcuStatus,
} from "@fit-analyzer/shared";
import { db } from "../db.js";

/**
 * IntervalsIcu connection: the per-user personal API key plus the opt-in
 * history import (backfill) progress.
 *
 * v1 authenticates with a personal API key (HTTP Basic, username `API_KEY`),
 * which intervals.icu explicitly blesses for an athlete's own data. OAuth is
 * the later path for a public app; the client seam does not change, only the
 * credential this module returns. The key is never sent back to the browser.
 */

export interface IntervalsIcuConnectionRow {
	user_id: string;
	api_key: string;
	athlete_id: string | null;
	athlete_name: string | null;
	key_valid: number | null;
	backfill_status: string;
	backfill_imported: number;
	backfill_failed: number;
	backfill_days: number | null;
	backfill_started_at: string | null;
	backfill_finished_at: string | null;
	backfill_error: string | null;
	last_sync_at: string | null;
	last_poll_error: string | null;
	poll_failures: number;
}

const getRowStmt = db.prepare<IntervalsIcuConnectionRow, [string]>(
	`SELECT user_id, api_key, athlete_id, athlete_name, key_valid,
	        backfill_status, backfill_imported, backfill_failed, backfill_days,
	        backfill_started_at, backfill_finished_at, backfill_error,
	        last_sync_at, last_poll_error, poll_failures
	   FROM intervals_icu_connections WHERE user_id = ?`,
);

const upsertStmt = db.prepare(
	`INSERT INTO intervals_icu_connections (user_id, api_key, athlete_id, athlete_name, key_valid, updated_at)
	 VALUES (?, ?, ?, ?, 1, datetime('now'))
	 ON CONFLICT(user_id) DO UPDATE SET
	   api_key = excluded.api_key,
	   athlete_id = COALESCE(excluded.athlete_id, intervals_icu_connections.athlete_id),
	   athlete_name = COALESCE(excluded.athlete_name, intervals_icu_connections.athlete_name),
	   key_valid = 1,
	   poll_failures = 0,
	   last_poll_error = NULL,
	   updated_at = excluded.updated_at`,
);

const setKeyValidStmt = db.prepare(
	"UPDATE intervals_icu_connections SET key_valid = ?, updated_at = datetime('now') WHERE user_id = ?",
);

const deleteStmt = db.prepare(
	"DELETE FROM intervals_icu_connections WHERE user_id = ?",
);

const startBackfillStmt = db.prepare(
	`UPDATE intervals_icu_connections
	    SET backfill_status = 'running', backfill_days = ?,
	        backfill_imported = 0, backfill_failed = 0,
	        backfill_started_at = datetime('now'), backfill_finished_at = NULL,
	        backfill_error = NULL
	  WHERE user_id = ?`,
);

const progressBackfillStmt = db.prepare(
	`UPDATE intervals_icu_connections
	    SET backfill_imported = ?, backfill_failed = ?
	  WHERE user_id = ?`,
);

const finishBackfillStmt = db.prepare(
	`UPDATE intervals_icu_connections
	    SET backfill_status = ?, backfill_finished_at = datetime('now'), backfill_error = ?
	  WHERE user_id = ?`,
);

export function getIntervalsIcuConnection(
	userId: string,
): IntervalsIcuConnectionRow | null {
	return getRowStmt.get(userId) ?? null;
}

/** Persist a key that just verified; records the athlete it belongs to. */
export function saveIntervalsIcuConnection(
	userId: string,
	input: {
		apiKey: string;
		athleteId: string | null;
		athleteName: string | null;
	},
): void {
	upsertStmt.run(userId, input.apiKey, input.athleteId, input.athleteName);
}

/** Remember whether the stored key last worked, for the settings card. */
export function setIntervalsIcuKeyValid(userId: string, valid: boolean): void {
	setKeyValidStmt.run(valid ? 1 : 0, userId);
}

/** Forget the key. Planned workouts left on intervals.icu survive (ADR-0005). */
export function deleteIntervalsIcuConnection(userId: string): void {
	deleteStmt.run(userId);
}

function toBackfill(
	row: IntervalsIcuConnectionRow | null,
): IntervalsIcuBackfill {
	const status = row?.backfill_status;
	return {
		status:
			status === "running" || status === "done" || status === "error"
				? status
				: "idle",
		imported: row?.backfill_imported ?? 0,
		failed: row?.backfill_failed ?? 0,
		days: row?.backfill_days ?? null,
		startedAt: row?.backfill_started_at ?? null,
		finishedAt: row?.backfill_finished_at ?? null,
		error: row?.backfill_error ?? null,
	};
}

export function getIntervalsIcuStatus(userId: string): IntervalsIcuStatus {
	const row = getRowStmt.get(userId) ?? null;
	return {
		connected: Boolean(row?.api_key),
		athleteId: row?.athlete_id ?? null,
		athleteName: row?.athlete_name ?? null,
		keyValid: row?.key_valid == null ? null : Boolean(row.key_valid),
		backfill: toBackfill(row),
		lastSyncAt: row?.last_sync_at ?? null,
	};
}

/** Users the activity poller should visit: connected, last key still works. */
export function listPollableIntervalsIcuUsers(): {
	userId: string;
	apiKey: string;
}[] {
	const rows = db
		.prepare<{ user_id: string; api_key: string }, []>(
			"SELECT user_id, api_key FROM intervals_icu_connections WHERE api_key IS NOT NULL AND key_valid IS NOT 0",
		)
		.all();
	return rows.map((r) => ({ userId: r.user_id, apiKey: r.api_key }));
}

/** Record a clean poll: the poller has caught up, failures reset. */
export function markIntervalsIcuPollSuccess(userId: string): void {
	db.prepare(
		`UPDATE intervals_icu_connections
		    SET last_sync_at = datetime('now'), last_poll_error = NULL,
		        poll_failures = 0, key_valid = 1, updated_at = datetime('now')
		  WHERE user_id = ?`,
	).run(userId);
}

/**
 * Record a failed poll. A revoked/expired key stops the poller (key_valid = 0)
 * instead of hammering intervals.icu every five minutes.
 */
export function markIntervalsIcuPollFailure(
	userId: string,
	error: string,
	revoked: boolean,
): void {
	db.prepare(
		`UPDATE intervals_icu_connections
		    SET last_poll_error = ?, poll_failures = poll_failures + 1,
		        key_valid = CASE WHEN ? THEN 0 ELSE key_valid END,
		        updated_at = datetime('now')
		  WHERE user_id = ?`,
	).run(error, revoked ? 1 : 0, userId);
}

export function startIntervalsIcuBackfill(userId: string, days: number): void {
	startBackfillStmt.run(days, userId);
}

/**
 * Mark any backfill left "running" by a previous process as interrupted. The
 * job itself is in-memory, so a restart cannot resume it; without this the
 * Settings card would show an import running forever.
 */
export function resetInterruptedBackfills(): void {
	db.prepare(
		`UPDATE intervals_icu_connections
		    SET backfill_status = 'error',
		        backfill_error = 'Interrupted by a server restart',
		        backfill_finished_at = datetime('now')
		  WHERE backfill_status = 'running'`,
	).run();
}

export function recordIntervalsIcuBackfillProgress(
	userId: string,
	imported: number,
	failed: number,
): void {
	progressBackfillStmt.run(imported, failed, userId);
}

/** Close the backfill run: `done` on a clean pass, `error` when it stopped. */
export function finishIntervalsIcuBackfill(
	userId: string,
	error: string | null,
): void {
	finishBackfillStmt.run(error ? "error" : "done", error, userId);
}

/** HTTP Basic credential for the API: username `API_KEY`, password the key. */
export function intervalsIcuAuthHeader(apiKey: string): string {
	return `Basic ${btoa(`API_KEY:${apiKey}`)}`;
}
