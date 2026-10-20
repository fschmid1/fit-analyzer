import { describe, expect, it } from "bun:test";
import { healthHistoryDateRange, recentDateWindow } from "./healthDates.js";

describe("healthHistoryDateRange", () => {
	it("covers today and the previous six days for a 7-day window", () => {
		const range = healthHistoryDateRange(7, new Date("2026-10-20T12:00:00Z"));

		expect(range).toEqual({
			startDate: "2026-10-14",
			endDate: "2026-10-21",
		});
	});

	it("keeps tomorrow as the upper bound for timezone spillover", () => {
		const range = healthHistoryDateRange(1, new Date("2026-10-20T23:30:00Z"));

		expect(range).toEqual({
			startDate: "2026-10-20",
			endDate: "2026-10-21",
		});
	});
});

describe("recentDateWindow", () => {
	it("trims an extra fetched day from the derived 7-day window", () => {
		const rows = [
			{ date: "2026-10-13", value: 1 },
			{ date: "2026-10-14", value: 2 },
			{ date: "2026-10-15", value: 3 },
			{ date: "2026-10-16", value: 4 },
			{ date: "2026-10-17", value: 5 },
			{ date: "2026-10-18", value: 6 },
			{ date: "2026-10-19", value: 7 },
			{ date: "2026-10-20", value: 8 },
		];

		expect(recentDateWindow(rows, 7).map((row) => row.date)).toEqual([
			"2026-10-14",
			"2026-10-15",
			"2026-10-16",
			"2026-10-17",
			"2026-10-18",
			"2026-10-19",
			"2026-10-20",
		]);
	});

	it("anchors the window to the newest row rather than the server date", () => {
		const rows = [
			{ date: "2026-10-13", value: 1 },
			{ date: "2026-10-20", value: 8 },
		];

		expect(recentDateWindow(rows, 7).map((row) => row.date)).toEqual([
			"2026-10-20",
		]);
	});
});
