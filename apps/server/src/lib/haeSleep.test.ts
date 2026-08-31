import { describe, expect, it } from "bun:test";
import {
	combineSleepSessions,
	dedupeSleepSessions,
	mergeSleepData,
	parseSleepEntry,
	sleepNightDate,
	type HaeSleepEntry,
	type HaeSleepSession,
} from "./haeSleep.js";

function entry(overrides: Partial<HaeSleepEntry>): HaeSleepEntry {
	return { date: "2026-08-26 08:12:00 +0200", ...overrides };
}

function session(overrides: Partial<HaeSleepSession>): HaeSleepSession {
	return {
		durationMinutes: 240,
		inBedMinutes: null,
		stages: null,
		sleepStart: null,
		sleepEnd: null,
		...overrides,
	};
}

describe("parseSleepEntry", () => {
	it("prefers totalSleep, then asleep, then qty", () => {
		expect(
			parseSleepEntry(entry({ totalSleep: 8, asleep: 7, qty: 6 }))
				?.durationMinutes,
		).toBe(480);
		expect(parseSleepEntry(entry({ asleep: 7, qty: 6 }))?.durationMinutes).toBe(
			420,
		);
		expect(parseSleepEntry(entry({ qty: 6 }))?.durationMinutes).toBe(360);
	});

	it("returns null for zero or missing duration", () => {
		expect(parseSleepEntry(entry({}))).toBeNull();
		expect(parseSleepEntry(entry({ qty: 0 }))).toBeNull();
	});

	it("converts inBed hours to minutes", () => {
		expect(parseSleepEntry(entry({ qty: 7, inBed: 8 }))?.inBedMinutes).toBe(
			480,
		);
	});

	it("derives awake stage minutes from total minus stages", () => {
		const stages = parseSleepEntry(
			entry({ qty: 8, core: 4, deep: 1.5, rem: 2 }),
		)?.stages;
		expect(stages).toEqual({
			awakeMinutes: 30,
			lightMinutes: 240,
			deepMinutes: 90,
			remMinutes: 120,
		});
	});
});

describe("sleepNightDate", () => {
	it("attributes the night to the wake date", () => {
		expect(
			sleepNightDate(
				entry({
					date: "2026-08-25 23:10:00 +0200",
					sleepEnd: "2026-08-26 07:30:00 +0200",
				}),
			),
		).toBe("2026-08-26");
	});

	it("falls back to the record date when sleepEnd is missing", () => {
		expect(sleepNightDate(entry({ date: "2026-08-26 08:12:00 +0200" }))).toBe(
			"2026-08-26",
		);
	});
});

describe("combineSleepSessions", () => {
	it("sums a night split into multiple sessions", () => {
		// Apple Watch scenario: 8.5h night recorded as 4.2h + 4.3h
		const combined = combineSleepSessions([
			session({
				durationMinutes: 252,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 03:12:00 +0200",
			}),
			session({
				durationMinutes: 258,
				sleepStart: "2026-08-26 03:20:00 +0200",
				sleepEnd: "2026-08-26 07:38:00 +0200",
			}),
		]);
		expect(combined?.durationMinutes).toBe(510);
		expect(combined?.sleepStart).toBe("2026-08-25 23:00:00 +0200");
		expect(combined?.sleepEnd).toBe("2026-08-26 07:38:00 +0200");
	});

	it("sums stage minutes across sessions", () => {
		const combined = combineSleepSessions([
			session({
				durationMinutes: 240,
				stages: {
					awakeMinutes: 10,
					lightMinutes: 200,
					deepMinutes: 20,
					remMinutes: 10,
				},
			}),
			session({
				durationMinutes: 240,
				stages: {
					awakeMinutes: 5,
					lightMinutes: 210,
					deepMinutes: 15,
					remMinutes: 10,
				},
			}),
		]);
		expect(combined?.stages).toEqual({
			awakeMinutes: 15,
			lightMinutes: 410,
			deepMinutes: 35,
			remMinutes: 20,
		});
	});

	it("computes efficiency from combined in-bed time", () => {
		const combined = combineSleepSessions([
			session({ durationMinutes: 240, inBedMinutes: 250 }),
			session({ durationMinutes: 240, inBedMinutes: 250 }),
		]);
		expect(combined?.efficiencyPercent).toBe(96);
	});

	it("caps efficiency at 100", () => {
		const combined = combineSleepSessions([
			session({ durationMinutes: 480, inBedMinutes: 300 }),
		]);
		expect(combined?.efficiencyPercent).toBe(100);
	});

	it("keeps the night with no efficiency when in-bed time is absent", () => {
		const combined = combineSleepSessions([session({ durationMinutes: 480 })]);
		expect(combined?.efficiencyPercent).toBeNull();
	});

	it("returns null for an empty session list", () => {
		expect(combineSleepSessions([])).toBeNull();
	});
});

describe("dedupeSleepSessions", () => {
	it("drops re-delivered sessions with the same sleep window", () => {
		const deduped = dedupeSleepSessions([
			session({
				durationMinutes: 240,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 03:00:00 +0200",
			}),
			session({
				durationMinutes: 245,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 03:00:00 +0200",
			}),
			session({
				durationMinutes: 240,
				sleepStart: "2026-08-26 03:10:00 +0200",
				sleepEnd: "2026-08-26 07:10:00 +0200",
			}),
		]);
		expect(deduped).toHaveLength(2);
		// Later entry wins (corrected data)
		expect(deduped[0]?.durationMinutes).toBe(245);
	});

	it("dedupes timestamp-less sessions by duration and stages", () => {
		const deduped = dedupeSleepSessions([
			session({
				durationMinutes: 240,
				stages: {
					awakeMinutes: 10,
					lightMinutes: 200,
					deepMinutes: 20,
					remMinutes: 10,
				},
			}),
			session({
				durationMinutes: 240,
				stages: {
					awakeMinutes: 10,
					lightMinutes: 200,
					deepMinutes: 20,
					remMinutes: 10,
				},
			}),
			session({ durationMinutes: 120 }),
		]);
		expect(deduped).toHaveLength(2);
	});

	it("drops nested truncated re-deliveries of a cumulative window", () => {
		// HAE background syncs deliver progressively truncated cumulative
		// windows (same wake-time end, start creeping later). The longest
		// window subsumes the rest — only it survives.
		const deduped = dedupeSleepSessions([
			session({
				durationMinutes: 493,
				stages: {
					awakeMinutes: 0,
					lightMinutes: 299,
					deepMinutes: 68,
					remMinutes: 126,
				},
				sleepStart: "2026-08-30 00:14:04 +0200",
				sleepEnd: "2026-08-30 09:08:41 +0200",
			}),
			session({
				durationMinutes: 343,
				sleepStart: "2026-08-30 03:09:07 +0200",
				sleepEnd: "2026-08-30 09:08:41 +0200",
			}),
			session({
				durationMinutes: 237,
				sleepStart: "2026-08-30 05:05:29 +0200",
				sleepEnd: "2026-08-30 09:08:41 +0200",
			}),
		]);
		expect(deduped).toHaveLength(1);
		expect(deduped[0]?.durationMinutes).toBe(493);
	});

	it("keeps genuinely adjacent split-night segments (not nested)", () => {
		const deduped = dedupeSleepSessions([
			session({
				durationMinutes: 252,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 03:12:00 +0200",
			}),
			session({
				durationMinutes: 258,
				sleepStart: "2026-08-26 03:20:00 +0200",
				sleepEnd: "2026-08-26 07:38:00 +0200",
			}),
		]);
		expect(deduped).toHaveLength(2);
	});

	it("sums split segments but drops their nested subsets", () => {
		const combined = combineSleepSessions([
			session({
				durationMinutes: 390,
				sleepStart: "2026-08-27 22:54:07 +0200",
				sleepEnd: "2026-08-28 06:56:00 +0200",
			}),
			session({
				durationMinutes: 355,
				sleepStart: "2026-08-28 01:01:25 +0200",
				sleepEnd: "2026-08-28 06:56:00 +0200",
			}),
			session({
				durationMinutes: 180,
				sleepStart: "2026-08-26 03:20:00 +0200",
				sleepEnd: "2026-08-26 07:38:00 +0200",
			}),
			session({
				durationMinutes: 76,
				sleepStart: "2026-08-28 05:34:57 +0200",
				sleepEnd: "2026-08-28 06:56:00 +0200",
			}),
		]);
		expect(combined?.durationMinutes).toBe(390 + 180);
	});
});

describe("mergeSleepData", () => {
	it("accumulates sessions across webhook payloads", () => {
		const stored = combineSleepSessions([
			session({
				durationMinutes: 252,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 03:12:00 +0200",
			}),
		]);
		const incoming = combineSleepSessions([
			session({
				durationMinutes: 258,
				sleepStart: "2026-08-26 03:20:00 +0200",
				sleepEnd: "2026-08-26 07:38:00 +0200",
			}),
		]);
		const merged = mergeSleepData(stored, incoming);
		expect(merged?.durationMinutes).toBe(510);
		expect(merged?.sessions).toHaveLength(2);
	});

	it("dedupes the same session delivered twice", () => {
		const first = combineSleepSessions([
			session({
				durationMinutes: 480,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 07:00:00 +0200",
			}),
		]);
		const merged = mergeSleepData(first, first);
		expect(merged?.durationMinutes).toBe(480);
		expect(merged?.sessions).toHaveLength(1);
	});

	it("lets an aggregated payload without sessions replace the stored night", () => {
		const stored = combineSleepSessions([
			session({
				durationMinutes: 252,
				sleepStart: "2026-08-25 23:00:00 +0200",
				sleepEnd: "2026-08-26 03:12:00 +0200",
			}),
		]);
		const merged = mergeSleepData(stored, {
			durationMinutes: 480,
			efficiencyPercent: null,
			stages: null,
			sleepStart: null,
			sleepEnd: null,
		});
		expect(merged?.durationMinutes).toBe(480);
		expect(merged?.sessions).toBeUndefined();
	});

	it("keeps stored sleep when incoming is null", () => {
		const stored = combineSleepSessions([session({ durationMinutes: 480 })]);
		expect(mergeSleepData(stored, null)).toBe(stored);
		expect(mergeSleepData(null, null)).toBeNull();
	});
});
