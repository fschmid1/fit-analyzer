import { describe, expect, it } from "bun:test";
import {
	addDays,
	isoWeekKey,
	mondayIndex,
	mondayOf,
	planWeekFor,
} from "./planWeek.js";

describe("mondayIndex", () => {
	it("maps Monday to 0 and Sunday to 6", () => {
		expect(mondayIndex("2026-09-28")).toBe(0); // Monday
		expect(mondayIndex("2026-10-04")).toBe(6); // Sunday
	});
});

describe("mondayOf", () => {
	it("returns the same day for a Monday", () => {
		expect(mondayOf("2026-09-28")).toBe("2026-09-28");
	});

	it("walks back from a Sunday within the same week", () => {
		expect(mondayOf("2026-10-04")).toBe("2026-09-28");
	});
});

describe("addDays", () => {
	it("crosses month boundaries", () => {
		expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
	});
});

describe("isoWeekKey", () => {
	it("keys a mid-year week", () => {
		expect(isoWeekKey("2026-09-28")).toBe("2026-W40");
	});

	it("keeps the key stable across the whole Mon–Sun week", () => {
		const monday = isoWeekKey("2026-09-28");
		for (let d = 1; d <= 6; d++) {
			expect(isoWeekKey(addDays("2026-09-28", d))).toBe(monday);
		}
	});

	it("assigns early January days to the previous ISO week-year", () => {
		// 2027-01-01 is a Friday; its ISO week is 2026-W53.
		expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
	});
});

describe("planWeekFor", () => {
	it("returns the Mon–Sun bounds and key", () => {
		expect(planWeekFor("2026-09-30")).toEqual({
			key: "2026-W40",
			start: "2026-09-28",
			end: "2026-10-04",
		});
	});
});
