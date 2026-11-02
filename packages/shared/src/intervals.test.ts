import { describe, expect, it } from "bun:test";
import type { ActivityRecord } from "./types.js";
import { detectHeartRateIntervals, detectPowerIntervals } from "./intervals.js";

function makeRecords(
	power: number[],
	heartRate?: (number | null)[],
): ActivityRecord[] {
	const start = new Date("2026-10-15T10:00:00Z");
	return power.map((value, index) => ({
		timestamp: new Date(start.getTime() + index * 1000),
		elapsedSeconds: index,
		power: value,
		heartRate: heartRate?.[index] ?? 120,
		cadence: 90,
		speed: null,
		gradient: null,
		lat: null,
		lng: null,
	}));
}

function flat(value: number, seconds: number): number[] {
	return new Array(seconds).fill(value);
}

function repeat(block: number[], times: number): number[] {
	return Array.from({ length: times }, () => block).flat();
}

describe("detectPowerIntervals", () => {
	it("finds a hard effort inside a mostly-endurance ride", () => {
		// Regression: the old detector compared whole pedaling blocks to
		// the threshold, so a 4-minute 266 W effort inside a ~203 W ride
		// could never be found.
		const power = [
			...flat(150, 300),
			...repeat([...flat(266, 240), ...flat(150, 120)], 4),
			...flat(120, 300),
		];
		const intervals = detectPowerIntervals(makeRecords(power), 262, 60);

		expect(intervals).toHaveLength(4);
		expect(intervals.map((interval) => interval.startSeconds)).toEqual([
			300, 660, 1020, 1380,
		]);
		for (const interval of intervals) {
			expect(interval.duration).toBe(240);
			expect(interval.avgPower).toBe(266);
		}
	});

	it("finds 30/15 micro-intervals instead of averaging them away", () => {
		const power = [
			...flat(160, 120),
			...repeat([...flat(305, 30), ...flat(160, 15)], 12),
			...flat(160, 120),
		];
		const intervals = detectPowerIntervals(makeRecords(power), 280, 10);

		expect(intervals).toHaveLength(12);
		for (const interval of intervals) {
			expect(interval.duration).toBe(30);
			expect(interval.avgPower).toBe(305);
		}
	});

	it("bridges short coasting gaps instead of splitting one effort", () => {
		const power = [...flat(250, 60), 0, 0, ...flat(250, 60)];
		const intervals = detectPowerIntervals(makeRecords(power), 200, 30, 2);

		expect(intervals).toHaveLength(1);
		expect(intervals[0].duration).toBe(122);
	});

	it("keeps genuinely separate efforts apart", () => {
		const power = [...flat(250, 60), ...flat(0, 5), ...flat(250, 60)];
		const intervals = detectPowerIntervals(makeRecords(power), 200, 30, 2);

		expect(intervals).toHaveLength(2);
		expect(intervals[0].startSeconds).toBe(0);
		expect(intervals[1].startSeconds).toBe(65);
	});

	it("honours the minimum duration", () => {
		const power = [...flat(150, 20), ...flat(300, 5), ...flat(150, 20)];
		const records = makeRecords(power);

		expect(detectPowerIntervals(records, 250, 10)).toHaveLength(0);
		expect(detectPowerIntervals(records, 250, 5)).toHaveLength(1);
	});

	it("bridges brief dips inside one long effort", () => {
		// Real ERG efforts are not perfectly flat: this mirrors a 4-minute
		// block with a 3 s and a 5 s dip just below the threshold.
		const power = [
			...flat(150, 60),
			...flat(265, 120),
			...flat(250, 3),
			...flat(265, 100),
			...flat(230, 5),
			...flat(265, 20),
			...flat(150, 120),
		];
		const intervals = detectPowerIntervals(makeRecords(power), 260, 60);

		expect(intervals).toHaveLength(1);
		expect(intervals[0].duration).toBe(248);
	});

	it("returns nothing for empty records or invalid parameters", () => {
		expect(detectPowerIntervals([], 200, 10)).toEqual([]);
		expect(detectPowerIntervals(makeRecords(flat(250, 60)), 0, 10)).toEqual([]);
		expect(detectPowerIntervals(makeRecords(flat(250, 60)), 200, 0)).toEqual(
			[],
		);
	});
});

describe("detectHeartRateIntervals", () => {
	it("finds repeated blocks above the heart-rate threshold", () => {
		const heartRate = [
			...flat(120, 120),
			...repeat([...flat(182, 180), ...flat(125, 60)], 4),
			...flat(120, 120),
		];
		const records = makeRecords(flat(200, heartRate.length), heartRate);

		const intervals = detectHeartRateIntervals(records, 170, 60);

		expect(intervals).toHaveLength(4);
		for (const interval of intervals) {
			expect(interval.duration).toBe(180);
			expect(interval.avgHeartRate).toBe(182);
		}
	});
});
