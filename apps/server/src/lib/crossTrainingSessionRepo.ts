import type { Database } from "bun:sqlite";
import type { CrossTrainingSession } from "@fit-analyzer/shared";
import { db } from "../db.js";

/**
 * Completed non-ride training sessions (strength, run, swim, …) pulled from
 * intervals.icu as summaries. Kept apart from `activities` on purpose: an
 * Activity is a ride analysed from per-second records, while a session is
 * context — duration, heart rate, training load — for the coach and history.
 *
 * Upserts are idempotent by (user, source, source activity id), so the poller
 * and the backfill can re-see the same session without duplicating it.
 */

export interface CrossTrainingSessionInput {
	userId: string;
	/** YYYY-MM-DD in the athlete's training timezone. */
	date: string;
	startTime: string | null;
	/** intervals.icu activity type, e.g. "WeightTraining". */
	sport: string;
	name: string;
	durationSeconds: number;
	elapsedSeconds: number | null;
	distanceKm: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	trainingLoad: number | null;
	kgLifted: number | null;
	description: string | null;
	tags: string[];
	source: "intervals-icu";
	sourceActivityId: string;
}

export type CrossTrainingSessionUpsertStatus =
	| "imported"
	| "updated"
	| "skipped";

interface SessionRow {
	id: string;
	user_id: string;
	date: string;
	start_time: string | null;
	sport: string;
	name: string;
	duration_seconds: number;
	elapsed_seconds: number | null;
	distance_meters: number | null;
	avg_heart_rate: number | null;
	max_heart_rate: number | null;
	training_load: number | null;
	kg_lifted: number | null;
	description: string | null;
	tags: string;
	source: string;
	source_activity_id: string;
	created_at: string;
}

const SELECT_COLUMNS = `
  id, user_id, date, start_time, sport, name, duration_seconds,
  elapsed_seconds, distance_meters, avg_heart_rate, max_heart_rate,
  training_load, kg_lifted, description, tags, source, source_activity_id,
  created_at
`;

function parseTags(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((tag): tag is string => typeof tag === "string")
			: [];
	} catch {
		return [];
	}
}

function rowToSession(row: SessionRow): CrossTrainingSession {
	return {
		id: row.id,
		date: row.date,
		startTime: row.start_time,
		sport: row.sport,
		name: row.name,
		durationSeconds: row.duration_seconds,
		elapsedSeconds: row.elapsed_seconds,
		distanceKm:
			row.distance_meters != null
				? Math.round((row.distance_meters / 1000) * 10) / 10
				: null,
		avgHeartRate: row.avg_heart_rate,
		maxHeartRate: row.max_heart_rate,
		trainingLoad: row.training_load,
		kgLifted: row.kg_lifted,
		description: row.description,
		tags: parseTags(row.tags),
		source: row.source,
		createdAt: row.created_at,
	};
}

/** Fields that make two imports of one session the same session. */
function sameSession(
	row: SessionRow,
	input: CrossTrainingSessionInput,
): boolean {
	return (
		row.date === input.date &&
		row.start_time === input.startTime &&
		row.sport === input.sport &&
		row.name === input.name &&
		row.duration_seconds === input.durationSeconds &&
		row.elapsed_seconds === input.elapsedSeconds &&
		row.distance_meters ===
			(input.distanceKm != null ? input.distanceKm * 1000 : null) &&
		row.avg_heart_rate === input.avgHeartRate &&
		row.max_heart_rate === input.maxHeartRate &&
		row.training_load === input.trainingLoad &&
		row.kg_lifted === input.kgLifted &&
		row.description === input.description &&
		row.tags === JSON.stringify(input.tags)
	);
}

export function createCrossTrainingSessionRepo(database: Database) {
	const findBySourceStmt = database.prepare<
		SessionRow,
		[string, string, string]
	>(
		`SELECT ${SELECT_COLUMNS} FROM cross_training_sessions
     WHERE user_id = ? AND source = ? AND source_activity_id = ?`,
	);

	const insertStmt = database.prepare(
		`INSERT INTO cross_training_sessions
       (id, user_id, date, start_time, sport, name, duration_seconds,
        elapsed_seconds, distance_meters, avg_heart_rate, max_heart_rate,
        training_load, kg_lifted, description, tags, source, source_activity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, source, source_activity_id) DO UPDATE SET
       date = excluded.date,
       start_time = excluded.start_time,
       sport = excluded.sport,
       name = excluded.name,
       duration_seconds = excluded.duration_seconds,
       elapsed_seconds = excluded.elapsed_seconds,
       distance_meters = excluded.distance_meters,
       avg_heart_rate = excluded.avg_heart_rate,
       max_heart_rate = excluded.max_heart_rate,
       training_load = excluded.training_load,
       kg_lifted = excluded.kg_lifted,
       description = excluded.description,
       tags = excluded.tags`,
	);

	const listStmt = database.prepare<SessionRow, [string, number]>(
		`SELECT ${SELECT_COLUMNS} FROM cross_training_sessions
     WHERE user_id = ?
     ORDER BY date DESC, start_time DESC, created_at DESC
     LIMIT ?`,
	);

	const recentStmt = database.prepare<SessionRow, [string, string, number]>(
		`SELECT ${SELECT_COLUMNS} FROM cross_training_sessions
     WHERE user_id = ? AND date >= ?
     ORDER BY date DESC, start_time DESC, created_at DESC
     LIMIT ?`,
	);

	const loadByDateStmt = database.prepare<
		{ date: string; training_load: number | null },
		[string, string, string]
	>(
		`SELECT date, training_load FROM cross_training_sessions
     WHERE user_id = ? AND date >= ? AND date <= ?`,
	);

	return {
		/** True when this source activity is already stored for the user. */
		exists(userId: string, source: string, sourceActivityId: string): boolean {
			return findBySourceStmt.get(userId, source, sourceActivityId) != null;
		},

		/** Insert or refresh one session. Unchanged rows are left alone. */
		upsert(input: CrossTrainingSessionInput): CrossTrainingSessionUpsertStatus {
			const existing = findBySourceStmt.get(
				input.userId,
				input.source,
				input.sourceActivityId,
			);
			if (existing && sameSession(existing, input)) return "skipped";

			insertStmt.run(
				crypto.randomUUID(),
				input.userId,
				input.date,
				input.startTime,
				input.sport,
				input.name,
				input.durationSeconds,
				input.elapsedSeconds,
				input.distanceKm != null ? input.distanceKm * 1000 : null,
				input.avgHeartRate,
				input.maxHeartRate,
				input.trainingLoad,
				input.kgLifted,
				input.description,
				JSON.stringify(input.tags),
				input.source,
				input.sourceActivityId,
			);
			return existing ? "updated" : "imported";
		},

		/** The athlete's sessions, newest first. */
		list(userId: string, limit = 200): CrossTrainingSession[] {
			return listStmt.all(userId, limit).map(rowToSession);
		},

		/** Sessions on or after `sinceDate` (YYYY-MM-DD), newest first. */
		recent(
			userId: string,
			sinceDate: string,
			limit = 50,
		): CrossTrainingSession[] {
			return recentStmt.all(userId, sinceDate, limit).map(rowToSession);
		},

		/** Per-day training load rows for a date window, for load modelling. */
		loadByDate(
			userId: string,
			startDate: string,
			endDate: string,
		): { date: string; trainingLoad: number | null }[] {
			return loadByDateStmt
				.all(userId, startDate, endDate)
				.map((row) => ({ date: row.date, trainingLoad: row.training_load }));
		},
	};
}

export type CrossTrainingSessionRepo = ReturnType<
	typeof createCrossTrainingSessionRepo
>;

export const crossTrainingSessionRepo = createCrossTrainingSessionRepo(db);
