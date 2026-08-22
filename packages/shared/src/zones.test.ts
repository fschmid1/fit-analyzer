import {
	POWER_ZONE_BANDS,
	resolveZones,
	applyZoneOverrides,
	type ZoneRange,
} from "./zones.js";
import { describe, expect, it } from "bun:test";

describe("applyZoneOverrides", () => {
	const ftp = 250;
	const derived: ZoneRange[] = resolveZones(POWER_ZONE_BANDS, ftp);

	it("returns derived zones unchanged when no overrides", () => {
		const result = applyZoneOverrides(derived, null);
		expect(result.zones).toEqual(derived);
		expect(result.anyOverridden).toBe(false);
	});

	it("returns derived zones unchanged when overrides array is empty", () => {
		const result = applyZoneOverrides(derived, []);
		expect(result.zones).toEqual(derived);
		expect(result.anyOverridden).toBe(false);
	});

	it("applies overrides that match the band name", () => {
		const overrides = [
			{ name: "Z1 Recovery", lower: 0, upper: 100 },
			{ name: "Z2 Endurance", lower: 100, upper: 200 },
		];
		const result = applyZoneOverrides(derived, overrides);
		expect(result.anyOverridden).toBe(true);
		expect(result.zones[0]).toEqual({
			name: "Z1 Recovery",
			lower: 0,
			upper: 100,
		});
		expect(result.zones[1]).toEqual({
			name: "Z2 Endurance",
			lower: 100,
			upper: 200,
		});
		// Non-overridden zones stay derived
		expect(result.zones[2]).toEqual(derived[2]);
	});

	it("ignores overrides whose name does not match the band", () => {
		const overrides = [{ name: "Wrong Name", lower: 0, upper: 50 }];
		const result = applyZoneOverrides(derived, overrides);
		expect(result.anyOverridden).toBe(false);
		expect(result.zones).toEqual(derived);
	});

	it("handles sparse override arrays (gaps in the array)", () => {
		const overrides = [
			undefined,
			{ name: "Z2 Endurance", lower: 150, upper: 220 },
			undefined,
		];
		const result = applyZoneOverrides(
			derived,
			overrides as unknown as ZoneRange[],
		);
		expect(result.anyOverridden).toBe(true);
		expect(result.zones[0]).toEqual(derived[0]);
		expect(result.zones[1].lower).toBe(150);
		expect(result.zones[1].upper).toBe(220);
		expect(result.zones[2]).toEqual(derived[2]);
	});

	it("preserves Infinity for the top zone when not overridden", () => {
		const lastIndex = derived.length - 1;
		expect(derived[lastIndex].upper).toBe(Number.POSITIVE_INFINITY);

		const overrides = [{ name: "Z1 Recovery", lower: 0, upper: 100 }];
		const result = applyZoneOverrides(derived, overrides);
		expect(result.zones[lastIndex].upper).toBe(Number.POSITIVE_INFINITY);
	});

	it("accepts null upper as Infinity for the top zone override", () => {
		const lastIndex = derived.length - 1;
		const overrides: (ZoneRange | null)[] = [];
		for (let i = 0; i < derived.length; i++) {
			if (i === lastIndex) {
				overrides.push({
					name: "Z7 Sprint",
					lower: 400,
					upper: null as unknown as number,
				});
			} else {
				overrides.push(null);
			}
		}
		const result = applyZoneOverrides(derived, overrides);
		expect(result.anyOverridden).toBe(true);
		expect(result.zones[lastIndex].lower).toBe(400);
	});
});
