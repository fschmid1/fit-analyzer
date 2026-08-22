import type { ZonesResponse, ZoneOverride } from "@fit-analyzer/shared";
import {
	POWER_ZONE_BANDS,
	HR_ZONE_BANDS,
	resolveZones,
	applyZoneOverrides,
} from "@fit-analyzer/shared";
import type { AthleteZonesRepo } from "./athleteZones.js";
import { computeAllTimeEstimates } from "./athleteStats.js";
import { db } from "../db.js";

const maxHrStmt = db.prepare(
	"SELECT MAX(CAST(json_extract(summary, '$.maxHeartRate') AS INTEGER)) as maxHr FROM activities WHERE user_id = ? AND json_extract(summary, '$.maxHeartRate') IS NOT NULL",
);

export function getUserEstimates(userId: string): {
	estimatedFtp: number | null;
	estimatedMaxHr: number | null;
} {
	const { estimatedFtp } = computeAllTimeEstimates(userId, null);
	const row = maxHrStmt.get(userId) as { maxHr: number | null } | undefined;
	return { estimatedFtp, estimatedMaxHr: row?.maxHr ?? null };
}

interface ProfileRef {
	ftp: number | null;
	maxHr: number | null;
}

/**
 * Build a ZonesResponse for a user: resolve reference values (profile or
 * estimate), derive default zones, then apply any per-user overrides.
 *
 * The optional `zonesRepo` lets tests inject an in-memory repo; production
 * callers omit it and use the shared singleton via `buildUserZones`.
 */
export function buildZonesResponse(
	profile: ProfileRef,
	estimates: { estimatedFtp: number | null; estimatedMaxHr: number | null },
	overrides: {
		powerZonesOverride: (ZoneOverride | null)[] | null;
		hrZonesOverride: (ZoneOverride | null)[] | null;
	} | null,
): ZonesResponse {
	const ftp = profile.ftp ?? estimates.estimatedFtp;
	const maxHr = profile.maxHr ?? estimates.estimatedMaxHr;

	if (
		ftp == null &&
		maxHr == null &&
		!overrides?.powerZonesOverride &&
		!overrides?.hrZonesOverride
	) {
		return {
			ftp: null,
			maxHr: null,
			source: "none",
			powerZones: [],
			hrZones: [],
			powerZonesOverridden: false,
			hrZonesOverridden: false,
		};
	}

	const source: ZonesResponse["source"] =
		profile.ftp != null || profile.maxHr != null ? "profile" : "estimated";

	const derivedPower = ftp != null ? resolveZones(POWER_ZONE_BANDS, ftp) : [];
	const derivedHr = maxHr != null ? resolveZones(HR_ZONE_BANDS, maxHr) : [];

	const power = applyZoneOverrides(
		derivedPower,
		overrides?.powerZonesOverride ?? null,
	);
	const hr = applyZoneOverrides(derivedHr, overrides?.hrZonesOverride ?? null);

	return {
		ftp,
		maxHr,
		source,
		powerZones: power.zones,
		hrZones: hr.zones,
		powerZonesOverridden: power.anyOverridden,
		hrZonesOverridden: hr.anyOverridden,
	};
}

/**
 * Resolve zones for a user, reading from the production `db` singleton.
 * Takes the zones repo as a parameter so tests can inject an in-memory one.
 */
export function buildUserZones(
	userId: string,
	profile: ProfileRef,
	zonesRepo: AthleteZonesRepo,
): ZonesResponse {
	const estimates = getUserEstimates(userId);
	const overrides = zonesRepo.get(userId);
	return buildZonesResponse(profile, estimates, overrides);
}
