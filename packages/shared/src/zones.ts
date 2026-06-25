/**
 * Training zone definitions shared between the server (zone analysis tool,
 * stats endpoint) and the web client (zones card rendering).
 *
 * Zones are expressed as ratios of FTP (power) and max HR (heart rate) so
 * they can be turned into absolute watt / bpm ranges once an athlete's
 * reference values are known.
 */

export interface ZoneBand {
	name: string;
	/** Inclusive lower bound as a ratio of the reference value. */
	min: number;
	/** Exclusive upper bound as a ratio of the reference value. */
	max: number;
}

export const POWER_ZONE_BANDS: readonly ZoneBand[] = [
	{ name: "Z1 Recovery", min: 0, max: 0.55 },
	{ name: "Z2 Endurance", min: 0.55, max: 0.75 },
	{ name: "Z3 Tempo", min: 0.75, max: 0.9 },
	{ name: "Z4 Threshold", min: 0.9, max: 1.05 },
	{ name: "Z5 VO2max", min: 1.05, max: 1.2 },
	{ name: "Z6 Anaerobic", min: 1.2, max: 1.5 },
	{ name: "Z7 Sprint", min: 1.5, max: Number.POSITIVE_INFINITY },
];

export const HR_ZONE_BANDS: readonly ZoneBand[] = [
	{ name: "Z1 Recovery", min: 0, max: 0.6 },
	{ name: "Z2 Endurance", min: 0.6, max: 0.7 },
	{ name: "Z3 Tempo", min: 0.7, max: 0.8 },
	{ name: "Z4 Threshold", min: 0.8, max: 0.9 },
	{ name: "Z5 VO2max", min: 0.9, max: 1.0 },
	{ name: "Z6 Anaerobic", min: 1.0, max: Number.POSITIVE_INFINITY },
];

/** A single zone resolved to absolute watt / bpm bounds. */
export interface ZoneRange {
	name: string;
	/** Inclusive lower bound in absolute units (W or bpm). */
	lower: number;
	/** Exclusive upper bound in absolute units (W or bpm). Infinity for the top zone. */
	upper: number;
}

export interface ZonesResponse {
	/** Functional Threshold Power used to derive power zones (W), or null if unavailable. */
	ftp: number | null;
	/** Maximum heart rate used to derive HR zones (bpm), or null if unavailable. */
	maxHr: number | null;
	/** Whether FTP/max HR came from the athlete profile or an estimate. */
	source: "profile" | "estimated" | "none";
	powerZones: ZoneRange[];
	hrZones: ZoneRange[];
}

/** Resolve a set of zone bands into absolute ranges given a reference value. */
export function resolveZones(
	bands: readonly ZoneBand[],
	reference: number,
): ZoneRange[] {
	return bands.map((b) => ({
		name: b.name,
		lower: Math.round(b.min * reference),
		upper:
			b.max === Number.POSITIVE_INFINITY
				? Number.POSITIVE_INFINITY
				: Math.round(b.max * reference),
	}));
}
