import type { Database } from "bun:sqlite";
import type { ZoneOverride } from "@fit-analyzer/shared";
import { isZoneOverride } from "@fit-analyzer/shared";
import { db } from "../db.js";

interface ZoneOverrideRow {
	power_zones_override: string | null;
	hr_zones_override: string | null;
}

function parseOverrides(raw: string | null): (ZoneOverride | null)[] | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed.map((entry) =>
			entry == null ? null : isZoneOverride(entry) ? entry : null,
		);
	} catch {
		return null;
	}
}

export interface AthleteZones {
	powerZonesOverride: (ZoneOverride | null)[] | null;
	hrZonesOverride: (ZoneOverride | null)[] | null;
}

export type AthleteZonesRepo = ReturnType<typeof createAthleteZonesRepo>;

/**
 * Create an athlete-zone-override repository bound to a specific SQLite
 * database. Production code uses the shared `db` singleton; tests pass an
 * in-memory database so they never touch disk.
 */
export function createAthleteZonesRepo(database: Database) {
	const getStmt = database.prepare(
		"SELECT power_zones_override, hr_zones_override FROM athlete_zones WHERE user_id = ?",
	);
	const upsertStmt = database.prepare(
		"INSERT INTO athlete_zones (user_id, power_zones_override, hr_zones_override, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET power_zones_override = excluded.power_zones_override, hr_zones_override = excluded.hr_zones_override, updated_at = datetime('now')",
	);
	const deleteStmt = database.prepare(
		"DELETE FROM athlete_zones WHERE user_id = ?",
	);

	return {
		get(userId: string): AthleteZones {
			const row = getStmt.get(userId) as ZoneOverrideRow | undefined;
			return {
				powerZonesOverride: parseOverrides(row?.power_zones_override ?? null),
				hrZonesOverride: parseOverrides(row?.hr_zones_override ?? null),
			};
		},
		upsert(
			userId: string,
			power: (ZoneOverride | null)[] | null,
			hr: (ZoneOverride | null)[] | null,
		): AthleteZones {
			upsertStmt.run(
				userId,
				power ? JSON.stringify(power) : null,
				hr ? JSON.stringify(hr) : null,
			);
			return this.get(userId);
		},
		reset(userId: string): void {
			deleteStmt.run(userId);
		},
	};
}

export const athleteZonesRepo = createAthleteZonesRepo(db);
