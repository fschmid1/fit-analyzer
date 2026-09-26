import { describe, expect, it } from "bun:test";
import { duePlanWeek, duePlanWeekKey, isRefreshDue } from "./planSchedule.js";

const TZ = "Europe/Zurich";

// Zurich is UTC+2 in summer (CEST) and UTC+1 in winter (CET).
describe("duePlanWeek", () => {
	it("targets the current week mid-week", () => {
		// Wednesday 2026-09-30 10:00 UTC = 12:00 Zurich.
		const now = new Date("2026-09-30T10:00:00Z");
		expect(duePlanWeek(now, TZ)).toBe("2026-09-28");
		expect(duePlanWeekKey(now, TZ)).toBe("2026-W40");
	});

	it("still targets the current week on Sunday before 18:00 local", () => {
		// Sunday 2026-10-04 13:00 UTC = 15:00 Zurich.
		const now = new Date("2026-10-04T13:00:00Z");
		expect(duePlanWeek(now, TZ)).toBe("2026-09-28");
	});

	it("targets the next week from Sunday 18:00 local", () => {
		// Sunday 2026-10-04 16:00 UTC = 18:00 Zurich (CEST).
		const now = new Date("2026-10-04T16:00:00Z");
		expect(duePlanWeek(now, TZ)).toBe("2026-10-05");
		expect(duePlanWeekKey(now, TZ)).toBe("2026-W41");
	});

	it("targets the next week on Monday (the new week is current)", () => {
		// Monday 2026-10-05 08:00 UTC = 10:00 Zurich.
		const now = new Date("2026-10-05T08:00:00Z");
		expect(duePlanWeek(now, TZ)).toBe("2026-10-05");
	});

	it("respects the timezone when deciding the local date", () => {
		// Sunday 2026-10-04 22:30 UTC = Monday 2026-10-05 00:30 in Zurich,
		// but still Sunday 15:30 in Los Angeles — different due weeks.
		const now = new Date("2026-10-04T22:30:00Z");
		expect(duePlanWeek(now, TZ)).toBe("2026-10-05");
		expect(duePlanWeek(now, "America/Los_Angeles")).toBe("2026-09-28");
	});
});

describe("isRefreshDue", () => {
	it("is due when there is no watermark", () => {
		expect(isRefreshDue(null, "2026-W40")).toBe(true);
	});

	it("is not due when the watermark already covers the target week", () => {
		expect(isRefreshDue("2026-W40", "2026-W40")).toBe(false);
	});

	it("is due when the watermark is behind (missed runs self-heal)", () => {
		expect(isRefreshDue("2026-W39", "2026-W40")).toBe(true);
	});

	it("compares week-year boundaries correctly", () => {
		expect(isRefreshDue("2025-W52", "2026-W01")).toBe(true);
		expect(isRefreshDue("2026-W01", "2026-W01")).toBe(false);
	});
});
