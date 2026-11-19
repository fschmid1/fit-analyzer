import { describe, expect, it } from "bun:test";
import {
	isValidTimezone,
	wallClockMinute,
	wallClockMs,
	wallClockToInstant,
} from "./wallClock.js";

const ZURICH = "Europe/Zurich";

describe("wallClockMinute", () => {
	it("renders the local wall clock", () => {
		expect(wallClockMinute(new Date("2026-08-29T10:00:00Z"), ZURICH)).toBe(
			"2026-08-29T12:00",
		);
		expect(wallClockMinute(new Date("2026-08-29T10:00:00Z"), "UTC")).toBe(
			"2026-08-29T10:00",
		);
	});
});

describe("wallClockToInstant", () => {
	it("turns a local start into the real UTC instant (summer)", () => {
		expect(
			wallClockToInstant("2026-08-29T12:00:00", ZURICH)?.toISOString(),
		).toBe("2026-08-29T10:00:00.000Z");
	});

	it("handles winter offset", () => {
		expect(wallClockToInstant("2026-01-15T12:00", ZURICH)?.toISOString()).toBe(
			"2026-01-15T11:00:00.000Z",
		);
	});

	it("round-trips with wallClockMs", () => {
		const local = "2026-10-01T08:30:00";
		const instant = wallClockToInstant(local, ZURICH);
		expect(instant).not.toBeNull();
		expect(wallClockMs(instant as Date, ZURICH)).toBe(Date.parse(`${local}Z`));
	});

	it("returns null for an unparseable string", () => {
		expect(wallClockToInstant("not-a-date", ZURICH)).toBeNull();
	});
});

describe("isValidTimezone", () => {
	it("accepts IANA zones and rejects nonsense", () => {
		expect(isValidTimezone(ZURICH)).toBe(true);
		expect(isValidTimezone("UTC")).toBe(true);
		expect(isValidTimezone("Mars/Olympus")).toBe(false);
	});
});
