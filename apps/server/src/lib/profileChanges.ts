import type { Database } from "bun:sqlite";
import type {
	ProfileChangeEntry,
	ProfileChangeSource,
} from "@fit-analyzer/shared";
import { db } from "../db.js";

interface ProfileChangeRow {
	id: string;
	created_at: string;
	source: string;
	changes: string;
}

/**
 * A structured diff of a single update event. Each entry maps a field name
 * to its old and new value. Fields that did not change are omitted.
 */
export type ChangeDiff = Record<string, { old: unknown; new: unknown }>;

export type ProfileChangesRepo = ReturnType<typeof createProfileChangesRepo>;

/**
 * Build a structured diff between two profile snapshots. Each entry maps a
 * field name to its old and new value. Fields that did not change are omitted.
 */
export function buildProfileDiff(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
): ChangeDiff {
	const diff: ChangeDiff = {};
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const k of keys) {
		if (before[k] !== after[k]) {
			diff[k] = { old: before[k] ?? null, new: after[k] ?? null };
		}
	}
	return diff;
}

/**
 * Build a zone-override diff for a set_zones or reset_zones operation. Only
 * the sides that were actually touched are included in the diff.
 */
export function buildZoneDiff(
	before: { powerZonesOverride: unknown; hrZonesOverride: unknown },
	after: { powerZonesOverride: unknown; hrZonesOverride: unknown },
	hasPower: boolean,
	hasHr: boolean,
): ChangeDiff {
	const diff: ChangeDiff = {};
	if (hasPower) {
		diff.powerZones = {
			old: before.powerZonesOverride,
			new: after.powerZonesOverride,
		};
	}
	if (hasHr) {
		diff.hrZones = { old: before.hrZonesOverride, new: after.hrZonesOverride };
	}
	return diff;
}

/**
 * Create a profile-changelog repository bound to a specific SQLite database.
 * Production code uses the shared `db` singleton; tests pass an in-memory
 * database so they never touch disk.
 */
export function createProfileChangesRepo(database: Database) {
	const insertStmt = database.prepare(
		"INSERT INTO profile_changes (id, user_id, source, changes) VALUES (?, ?, ?, ?)",
	);
	const listStmt = database.prepare(
		"SELECT id, created_at, source, changes FROM profile_changes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
	);

	return {
		append(
			userId: string,
			source: ProfileChangeSource,
			diff: ChangeDiff,
		): void {
			if (!diff || Object.keys(diff).length === 0) return;
			insertStmt.run(crypto.randomUUID(), userId, source, JSON.stringify(diff));
		},
		list(userId: string, limit = 50): ProfileChangeEntry[] {
			const rows = listStmt.all(userId, limit) as ProfileChangeRow[];
			return rows.map((r) => {
				let changes: ChangeDiff = {};
				try {
					const parsed = JSON.parse(r.changes);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						changes = parsed as ChangeDiff;
					}
				} catch {
					/* ignore malformed */
				}
				return {
					id: r.id,
					createdAt: r.created_at,
					source: r.source as ProfileChangeSource,
					changes,
				};
			});
		},
	};
}

export const profileChangesRepo = createProfileChangesRepo(db);
