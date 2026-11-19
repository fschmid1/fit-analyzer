import { db } from "../db.js";

/**
 * The athlete's training timezone: one IANA zone, owned by the athlete rather
 * than by a plan target (ADR-0005). It places planned workouts, defines the
 * Plan week, and drives the weekly refresh schedule regardless of which target
 * is connected.
 *
 * Google's captured `google_tokens.tz` predates this column and remains the
 * fallback; setTrainingTimezone keeps both in step so older read paths cannot
 * disagree while they are migrated.
 */

export function getTrainingTimezone(userId: string): string | null {
	const row = db
		.prepare<{ timezone: string | null }, [string]>(
			"SELECT training_timezone as timezone FROM user_settings WHERE user_id = ?",
		)
		.get(userId);
	if (row?.timezone) return row.timezone;
	const google = db
		.prepare<{ tz: string | null }, [string]>(
			"SELECT tz FROM google_tokens WHERE user_id = ?",
		)
		.get(userId);
	return google?.tz ?? null;
}

export function setTrainingTimezone(userId: string, timezone: string): void {
	db.prepare(
		`INSERT INTO user_settings (user_id, training_timezone) VALUES (?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET training_timezone = excluded.training_timezone`,
	).run(userId, timezone);
	// Keep the legacy Google column in step while read paths still use it.
	db.prepare(
		"UPDATE google_tokens SET tz = ?, updated_at = datetime('now') WHERE user_id = ?",
	).run(timezone, userId);
}
