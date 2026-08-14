import type {
	ActivitySummary,
	LapMarker,
	StoredRecord,
} from "@fit-analyzer/shared";
import type { Database } from "bun:sqlite";
import { handleNewActivityForWaxedChainReminder } from "./waxedChainReminders.js";
import { getAthleteProfile, updateAthleteProfile } from "./athleteProfile.js";
import { inferLocationFromActivities } from "./athleteStats.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Origin of an imported activity. Drives duplicate detection column. */
export type ActivitySource = "strava" | "wahoo" | "fit-upload";

/**
 * Normalized payload produced by an import adapter (Strava, Wahoo) or by the
 * FIT upload route. Pure data — no fetches, no I/O. The importer is the only
 * thing that touches SQLite or post-import side effects.
 */
export interface ImportPayload {
	source: ActivitySource;
	/** External activity id, unique per (userId, source). */
	sourceActivityId: string;
	records: StoredRecord[];
	summary: ActivitySummary;
	laps: LapMarker[];
	userId: string;
}

export type ImportStatus = "imported" | "updated" | "skipped";

export interface ImportResult {
	status: ImportStatus;
	/** Newly minted row id (for "imported" / "updated"), null for "skipped". */
	id: string | null;
}

// ─── Side-effect seam (overridable in tests) ──────────────────────────────────

export interface ImportSideEffects {
	/**
	 * Called after the row is committed. Mirrors the historical behavior of
	 * `handleNewActivityForWaxedChainReminder`. Failures are logged and do
	 * not change the returned status — the activity is already persisted.
	 */
	notifyWaxedChain: (userId: string, records: StoredRecord[]) => Promise<void>;
	/**
	 * Called after commit to opportunistically infer the athlete's home
	 * location from recent activities. Synchronous, best-effort.
	 */
	maybeUpdateAthleteLocation: (userId: string) => void;
}

const defaultSideEffects: ImportSideEffects = {
	notifyWaxedChain: handleNewActivityForWaxedChainReminder,
	maybeUpdateAthleteLocation: maybeUpdateAthleteLocationDefault,
};

/**
 * Update the athlete's inferred location from recent activities, but only if
 * they haven't set a location manually. Runs async and logs failures instead of
 * blocking the import path.
 *
 * Extracted verbatim from the Strava and Wahoo routes (where it was duplicated)
 * and given a single home here.
 */
function maybeUpdateAthleteLocationDefault(userId: string): void {
	const profile = getAthleteProfile(userId);
	if (profile.location) return;

	const inferred = inferLocationFromActivities(userId);
	if (!inferred) return;

	try {
		updateAthleteProfile(userId, { location: inferred });
		console.log(
			`[activityImporter] Inferred athlete location for user ${userId}: ${inferred}`,
		);
	} catch (err) {
		console.error(
			`[activityImporter] Failed to update inferred location for user ${userId}:`,
			err,
		);
	}
}

// ─── Duplicate-detection column mapping ───────────────────────────────────────

/** The activities-table column used for (userId, source) duplicate detection. */
const columnBySource: Record<ActivitySource, string | null> = {
	strava: "strava_activity_id",
	wahoo: "wahoo_activity_id",
	// FIT uploads have no external id — each upload is a fresh row, matching
	// the historical behavior of POST /api/activities.
	"fit-upload": null,
};

// ─── Prepared-statement cache ─────────────────────────────────────────────────

interface Statements {
	/** Per-source duplicate check. Null for sources without a dedup column. */
	checkExisting: Partial<
		Record<ActivitySource, ReturnType<Database["prepare"]>>
	>;
	/** Fetch the existing row's content for skip comparison. */
	fetchExisting: Partial<
		Record<ActivitySource, ReturnType<Database["prepare"]>>
	>;
	deleteExisting: Partial<
		Record<ActivitySource, ReturnType<Database["prepare"]>>
	>;
	insert: ReturnType<Database["prepare"]>;
}

const statementCache = new WeakMap<Database, Statements>();

function getStatements(db: Database): Statements {
	let cached = statementCache.get(db);
	if (cached) return cached;

	cached = {
		checkExisting: {
			strava: db.prepare<{ id: string }, [string, string]>(
				"SELECT id FROM activities WHERE user_id = ? AND strava_activity_id = ?",
			),
			wahoo: db.prepare<{ id: string }, [string, string]>(
				"SELECT id FROM activities WHERE user_id = ? AND wahoo_activity_id = ?",
			),
		},
		fetchExisting: {
			strava: db.prepare<
				{ id: string; summary: string; records: string; laps: string },
				[string, string]
			>(
				"SELECT id, summary, records, laps FROM activities WHERE user_id = ? AND strava_activity_id = ?",
			),
			wahoo: db.prepare<
				{ id: string; summary: string; records: string; laps: string },
				[string, string]
			>(
				"SELECT id, summary, records, laps FROM activities WHERE user_id = ? AND wahoo_activity_id = ?",
			),
		},
		deleteExisting: {
			strava: db.prepare(
				"DELETE FROM activities WHERE user_id = ? AND strava_activity_id = ?",
			),
			wahoo: db.prepare(
				"DELETE FROM activities WHERE user_id = ? AND wahoo_activity_id = ?",
			),
		},
		insert: db.prepare(
			`INSERT INTO activities
          (id, date, summary, records, laps, intervals, user_id,
           strava_activity_id, wahoo_activity_id)
         VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
		),
	};
	statementCache.set(db, cached);
	return cached;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export interface ImportOptions {
	/** Override the side-effect seam (tests inject fakes here). */
	sideEffects?: Partial<ImportSideEffects>;
}

/**
 * Persist an activity row, replacing any existing row that shares the same
 * (userId, source, sourceActivityId) triple. Delete-then-insert is wrapped in
 * a single SQLite transaction so a crash between the two cannot lose data.
 *
 * For `fit-upload` source there is no dedup column — each call inserts a fresh
 * row, matching the historical behavior of POST /api/activities.
 *
 * After commit, fires the post-import side effects (waxed-chain reminder,
 * athlete location inference). Those are best-effort: failures are logged and
 * do not change the returned status.
 */
export async function importActivity(
	db: Database,
	payload: ImportPayload,
	options: ImportOptions = {},
): Promise<ImportResult> {
	const sideEffects: ImportSideEffects = {
		...defaultSideEffects,
		...options.sideEffects,
	};

	const stmts = getStatements(db);
	const { source, sourceActivityId, userId, records, summary, laps } = payload;
	const dedupColumn = columnBySource[source];

	const fetchStmt = dedupColumn ? stmts.fetchExisting[source] : undefined;
	const deleteStmt = dedupColumn ? stmts.deleteExisting[source] : undefined;

	const existing = fetchStmt
		? (fetchStmt.get(userId, sourceActivityId) as {
				id: string;
				summary: string;
				records: string;
				laps: string;
			} | null)
		: null;

	// Idempotent re-import: if the existing row's content is byte-identical to
	// the new payload, skip the delete+insert entirely. Avoids unnecessary row
	// churn (and side-effect re-firing) when a webhook fires twice for the
	// same activity.
	const summaryJson = JSON.stringify(summary);
	const recordsJson = JSON.stringify(records);
	const lapsJson = JSON.stringify(laps);
	if (
		existing &&
		existing.summary === summaryJson &&
		existing.records === recordsJson &&
		existing.laps === lapsJson
	) {
		console.log(
			`[activityImporter] Skipped unchanged ${source} activity ${sourceActivityId} → ${existing.id}`,
		);
		// Side effects are NOT re-fired on a skip — the activity isn't new.
		return { status: "skipped", id: existing.id };
	}

	const id = crypto.randomUUID();
	const stravaId = source === "strava" ? sourceActivityId : null;
	const wahooId = source === "wahoo" ? sourceActivityId : null;

	const tx = db.transaction(() => {
		if (existing && deleteStmt) {
			deleteStmt.run(userId, sourceActivityId);
		}
		stmts.insert.run(
			id,
			summary.date,
			summaryJson,
			recordsJson,
			lapsJson,
			userId,
			stravaId,
			wahooId,
		);
	});
	tx();

	const status: ImportStatus = existing ? "updated" : "imported";

	console.log(
		`[activityImporter] ${existing ? "Re-imported" : "Imported"} ${source} activity ${sourceActivityId} → ${id}`,
	);

	// Best-effort post-import side effects.
	try {
		await sideEffects.notifyWaxedChain(userId, records);
	} catch (err) {
		console.error(
			`[activityImporter] notifyWaxedChain failed for user ${userId}:`,
			err,
		);
	}
	try {
		sideEffects.maybeUpdateAthleteLocation(userId);
	} catch (err) {
		console.error(
			`[activityImporter] maybeUpdateAthleteLocation failed for user ${userId}:`,
			err,
		);
	}

	return { status, id };
}
