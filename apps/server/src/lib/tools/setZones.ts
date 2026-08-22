import type { ToolDefinition, ZoneOverride } from "@fit-analyzer/shared";
import {
	formatZoneRange,
	isZoneOverride,
	normalizeZoneOverride,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { getAthleteProfile } from "../athleteProfile.js";
import { athleteZonesRepo } from "../athleteZones.js";
import { profileChangesRepo, buildZoneDiff } from "../profileChanges.js";
import { buildUserZones } from "../zonesService.js";

/**
 * Coerce raw tool args into a sparse override array. Null/undefined entries
 * mean "no override for this index — keep derived" and are stored as null.
 * Invalid entries (wrong shape) cause the whole call to fail. `null` upper
 * is normalized to Infinity.
 */
function coerceZones(raw: unknown): (ZoneOverride | null)[] | null {
	if (!Array.isArray(raw)) return null;
	const result: (ZoneOverride | null)[] = [];
	for (const entry of raw) {
		if (entry == null) {
			result.push(null);
			continue;
		}
		if (!isZoneOverride(entry)) return null;
		result.push(normalizeZoneOverride(entry));
	}
	return result;
}

export const setZonesDefinition: ToolDefinition = {
	name: "set_zones",
	description:
		"Set custom power and/or heart-rate zone overrides for the athlete. Each zone is an absolute range {name, lower, upper}. Pass an array aligned to the standard zone order (Z1, Z2, …, top). Omit a side to leave it unchanged. Use reset_zones to return to derived defaults. Always ask for confirmation before setting zones.",
	parameters: {
		type: "object",
		properties: {
			powerZones: {
				type: "array",
				description:
					"Custom power zones (absolute watts) as {name, lower, upper} aligned to the standard 7-zone order. Omit to leave power zones unchanged.",
				items: {
					type: "object",
					description: "A single power zone: {name, lower, upper}",
					properties: {
						name: { type: "string", description: "Zone name" },
						lower: {
							type: "number",
							description: "Inclusive lower bound in watts",
						},
						upper: {
							type: "number",
							description: "Exclusive upper bound in watts",
						},
					},
				},
			},
			hrZones: {
				type: "array",
				description:
					"Custom heart-rate zones (absolute bpm) as {name, lower, upper} aligned to the standard 6-zone order. Omit to leave HR zones unchanged.",
				items: {
					type: "object",
					description: "A single heart-rate zone: {name, lower, upper}",
					properties: {
						name: { type: "string", description: "Zone name" },
						lower: {
							type: "number",
							description: "Inclusive lower bound in bpm",
						},
						upper: {
							type: "number",
							description: "Exclusive upper bound in bpm",
						},
					},
				},
			},
		},
		required: [],
	},
};

export const setZonesHandler: ToolHandler = async (args, context) => {
	const userId = context.userId;

	const hasPower = args.powerZones !== undefined;
	const hasHr = args.hrZones !== undefined;

	if (!hasPower && !hasHr) {
		return {
			id: "",
			name: "set_zones",
			content: "",
			display: null,
			error: "Provide powerZones and/or hrZones to update.",
		};
	}

	const before = athleteZonesRepo.get(userId);
	const nextPower = hasPower
		? coerceZones(args.powerZones)
		: before.powerZonesOverride;
	const nextHr = hasHr ? coerceZones(args.hrZones) : before.hrZonesOverride;

	if (hasPower && nextPower == null) {
		return {
			id: "",
			name: "set_zones",
			content: "",
			display: null,
			error:
				"powerZones must be an array of {name, lower, upper} objects aligned to the standard zone order.",
		};
	}
	if (hasHr && nextHr == null) {
		return {
			id: "",
			name: "set_zones",
			content: "",
			display: null,
			error:
				"hrZones must be an array of {name, lower, upper} objects aligned to the standard zone order.",
		};
	}

	const after = athleteZonesRepo.upsert(userId, nextPower, nextHr);
	const diff = buildZoneDiff(before, after, hasPower, hasHr);
	profileChangesRepo.append(userId, "set_zones", diff);

	const profile = getAthleteProfile(userId);
	const zones = buildUserZones(userId, profile, athleteZonesRepo);

	const lines: string[] = ["Custom zones saved:"];
	if (hasPower) {
		lines.push("Power zones:");
		for (const z of zones.powerZones) {
			lines.push(`  ${z.name}: ${formatZoneRange(z, "W")}`);
		}
	}
	if (hasHr) {
		lines.push("Heart rate zones:");
		for (const z of zones.hrZones) {
			lines.push(`  ${z.name}: ${formatZoneRange(z, " bpm")}`);
		}
	}

	return {
		id: "",
		name: "set_zones",
		content: lines.join("\n"),
		display: {
			powerZones: zones.powerZones,
			hrZones: zones.hrZones,
			powerZonesOverridden: zones.powerZonesOverridden,
			hrZonesOverridden: zones.hrZonesOverridden,
		},
	};
};

export const resetZonesDefinition: ToolDefinition = {
	name: "reset_zones",
	description:
		"Clear all custom zone overrides and return to derived defaults (computed from FTP and max HR). Use this when the athlete wants to discard hand-set zones.",
	parameters: {
		type: "object",
		properties: {},
		required: [],
	},
};

export const resetZonesHandler: ToolHandler = async (_args, context) => {
	const userId = context.userId;
	const before = athleteZonesRepo.get(userId);
	athleteZonesRepo.reset(userId);

	const hasPower = before.powerZonesOverride != null;
	const hasHr = before.hrZonesOverride != null;
	const diff = buildZoneDiff(
		before,
		{ powerZonesOverride: null, hrZonesOverride: null },
		hasPower,
		hasHr,
	);
	profileChangesRepo.append(userId, "reset_zones", diff);

	const profile = getAthleteProfile(userId);
	const zones = buildUserZones(userId, profile, athleteZonesRepo);

	const lines: string[] = ["Custom zones cleared — back to derived defaults."];
	if (zones.powerZones.length > 0) {
		lines.push("Power zones:");
		for (const z of zones.powerZones) {
			lines.push(`  ${z.name}: ${formatZoneRange(z, "W")}`);
		}
	}
	if (zones.hrZones.length > 0) {
		lines.push("Heart rate zones:");
		for (const z of zones.hrZones) {
			lines.push(`  ${z.name}: ${formatZoneRange(z, " bpm")}`);
		}
	}

	return {
		id: "",
		name: "reset_zones",
		content: lines.join("\n"),
		display: {
			powerZones: zones.powerZones,
			hrZones: zones.hrZones,
			powerZonesOverridden: false,
			hrZonesOverridden: false,
		},
	};
};
