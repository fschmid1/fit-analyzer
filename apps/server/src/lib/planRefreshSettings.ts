import type {
	PlanRefreshSettings,
	PlanRefreshStatus,
} from "@fit-analyzer/shared";
import { planWeekFor } from "@fit-analyzer/shared";
import { db } from "../db.js";
import { duePlanWeek, isRefreshDue } from "./planSchedule.js";

/**
 * Persistence + scheduling state for the weekly Plan refresh (ADR-0003).
 *
 * The Refresh watermark (`plan_refresh_week`/`_at`) is the only plan-adjacent
 * state the app keeps: it records when a refresh happened, never what the plan
 * contains — the training calendar remains the plan. Candidate users are those
 * with a Google Calendar connection AND the opt-in flag; there is no user
 * registry table, so `google_tokens` is the authoritative candidate source.
 */

/** A user due for a scheduled Plan refresh, with the week to refresh. */
export interface DueRefresh {
	userId: string;
	weekKey: string;
	/** Monday (YYYY-MM-DD) of the Plan week to write. */
	weekStart: string;
}

interface RefreshRow {
	plan_refresh_enabled: number;
	plan_refresh_week: string | null;
	plan_refresh_at: string | null;
	plan_refresh_status: string | null;
	plan_refresh_error: string | null;
	plan_refresh_attempts: number;
	plan_refresh_attempt_week: string | null;
}

const getRowStmt = db.prepare<RefreshRow, [string]>(
	`SELECT plan_refresh_enabled, plan_refresh_week, plan_refresh_at,
	        plan_refresh_status, plan_refresh_error, plan_refresh_attempts,
	        plan_refresh_attempt_week
	   FROM user_settings WHERE user_id = ?`,
);

const getCandidateStmt = db.prepare<{ user_id: string; tz: string }, []>(
	`SELECT g.user_id as user_id, g.tz as tz
	   FROM google_tokens g
	   JOIN user_settings s ON s.user_id = g.user_id
	  WHERE g.calendar_id IS NOT NULL
	    AND g.tz IS NOT NULL
	    AND s.plan_refresh_enabled = 1`,
);

const upsertEnabledStmt = db.prepare(
	`INSERT INTO user_settings (user_id, plan_refresh_enabled) VALUES (?, ?)
	   ON CONFLICT(user_id) DO UPDATE SET plan_refresh_enabled = excluded.plan_refresh_enabled`,
);

const markSuccessStmt = db.prepare(
	`INSERT INTO user_settings (user_id, plan_refresh_week, plan_refresh_at, plan_refresh_status, plan_refresh_error, plan_refresh_attempts, plan_refresh_attempt_week)
	   VALUES (?, ?, ?, 'success', NULL, 0, NULL)
	   ON CONFLICT(user_id) DO UPDATE SET
	     plan_refresh_week = excluded.plan_refresh_week,
	     plan_refresh_at = excluded.plan_refresh_at,
	     plan_refresh_status = 'success',
	     plan_refresh_error = NULL,
	     plan_refresh_attempts = 0,
	     plan_refresh_attempt_week = NULL`,
);

const markErrorStmt = db.prepare(
	`INSERT INTO user_settings (user_id, plan_refresh_status, plan_refresh_error, plan_refresh_attempts, plan_refresh_attempt_week)
	   VALUES (?, 'error', ?, ?, ?)
	   ON CONFLICT(user_id) DO UPDATE SET
	     plan_refresh_status = 'error',
	     plan_refresh_error = excluded.plan_refresh_error,
	     plan_refresh_attempts = excluded.plan_refresh_attempts,
	     plan_refresh_attempt_week = excluded.plan_refresh_attempt_week`,
);

function toPublic(row: RefreshRow | null): PlanRefreshSettings {
	const status = row?.plan_refresh_status;
	return {
		enabled: Boolean(row?.plan_refresh_enabled ?? 0),
		refreshedWeek: row?.plan_refresh_week ?? null,
		refreshedAt: row?.plan_refresh_at ?? null,
		lastStatus:
			status === "success" || status === "error"
				? (status as PlanRefreshStatus)
				: "never",
		lastError: row?.plan_refresh_error ?? null,
	};
}

export function getPlanRefreshSettings(userId: string): PlanRefreshSettings {
	return toPublic(getRowStmt.get(userId) ?? null);
}

export function updatePlanRefreshEnabled(
	userId: string,
	enabled: boolean,
): PlanRefreshSettings {
	upsertEnabledStmt.run(userId, enabled ? 1 : 0);
	return getPlanRefreshSettings(userId);
}

/**
 * Plan weeks are due on Sunday from 18:00 in the user's training timezone: on
 * Sunday evening the upcoming Mon–Sun Plan week should already be populated.
 * Before Sunday 18:00, the due week is the *current* week; after it, the
 * *next* week.
 */
export {
	duePlanWeek,
	duePlanWeekKey,
	planRefreshToday,
} from "./planSchedule.js";

/**
 * All users with a connected Training calendar, the weekly refresh enabled, and
 * a due week newer than their watermark. Each entry carries the week to write.
 */
export function listDueRefreshes(now: Date): DueRefresh[] {
	return getCandidateStmt.all().flatMap((row) => {
		const weekStart = duePlanWeek(now, row.tz);
		const targetWeek = planWeekFor(weekStart);
		const watermark = getRowStmt.get(row.user_id)?.plan_refresh_week ?? null;
		if (!isRefreshDue(watermark, targetWeek.key)) return [];
		return [{ userId: row.user_id, weekKey: targetWeek.key, weekStart }];
	});
}

/** Record a successful Plan refresh: advance the Refresh watermark. */
export function markPlanRefreshed(userId: string, weekKey: string): void {
	markSuccessStmt.run(userId, weekKey, new Date().toISOString());
}

/** Record a failed Plan refresh; the watermark intentionally stays put. */
export function markPlanRefreshError(
	userId: string,
	error: string,
	weekKey: string,
): number {
	const row = getRowStmt.get(userId);
	const priorAttempts =
		row?.plan_refresh_attempt_week === weekKey
			? (row?.plan_refresh_attempts ?? 0)
			: 0;
	const attempts = priorAttempts + 1;
	markErrorStmt.run(userId, error, attempts, weekKey);
	return attempts;
}

/**
 * Record a manual-refresh failure without touching the retry budget. An
 * explicit "refresh now" is not a scheduled attempt, so it must not consume the
 * scheduler's capped retries (markPlanRefreshed resets the budget on success).
 */
export function markManualRefreshError(userId: string, error: string): void {
	const row = getRowStmt.get(userId);
	markErrorStmt.run(
		userId,
		error,
		row?.plan_refresh_attempts ?? 0,
		row?.plan_refresh_attempt_week ?? null,
	);
}

/** Attempts already made against the current due week (0 when not tracked). */
export function planRefreshAttempts(userId: string, weekKey: string): number {
	const row = getRowStmt.get(userId);
	return row?.plan_refresh_attempt_week === weekKey
		? (row?.plan_refresh_attempts ?? 0)
		: 0;
}
