import { describe, expect, it } from "bun:test";
import {
	buildMetricBySecondFromTimeSeries,
	peakPowerFromSeconds,
	peakPowerFromTimeSeries,
} from "./power.js";

describe("peakPowerFromSeconds", () => {
	describe("basic best-average", () => {
		it("returns the overall average when window covers the whole array", () => {
			const arr = [200, 200, 200, 200, 200];
			expect(peakPowerFromSeconds(arr, 4)).toBe(200);
		});

		it("finds the best sliding window of 2s", () => {
			// windows: [100,100]=100, [100,300]=200, [300,300]=300, [300,100]=200
			const arr = [100, 100, 300, 300, 100];
			expect(peakPowerFromSeconds(arr, 2)).toBe(300);
		});

		it("finds the best sliding window of 3s", () => {
			// windows: [100,100,300]=167, [100,300,300]=233, [300,300,100]=233
			const arr = [100, 100, 300, 300, 100];
			expect(peakPowerFromSeconds(arr, 3)).toBe(233);
		});

		it("handles a long flat effort", () => {
			const arr = new Array(120).fill(250);
			expect(peakPowerFromSeconds(arr, 60)).toBe(250);
		});
	});

	describe("zero and gap handling", () => {
		it("includes zeros in the average — coasting dilutes the window", () => {
			// windows: [400,0]=200, [0,0]=0, [0,0]=0
			const arr = [400, 0, 0, 0];
			expect(peakPowerFromSeconds(arr, 2)).toBe(200);
		});

		it("treats nulls the same as zeros", () => {
			// windows: [400,0]=200, [0,0]=0, [0,0]=0
			const arr: (number | null)[] = [400, null, null, null];
			expect(peakPowerFromSeconds(arr, 2)).toBe(200);
		});

		it("does not let zeros dilute a fully non-zero window", () => {
			// best 2s window is [300,300]=300; zeros elsewhere don't pull it down
			const arr = [0, 300, 300, 0, 0];
			expect(peakPowerFromSeconds(arr, 2)).toBe(300);
		});

		it("a mixed window averages over the full window length", () => {
			// [400, 0, 400] window 3 → (400+0+400)/3 = 267
			const arr = [400, 0, 400];
			expect(peakPowerFromSeconds(arr, 3)).toBe(267);
		});
	});

	describe("edge cases", () => {
		it("returns null for an empty array", () => {
			expect(peakPowerFromSeconds([], 60)).toBeNull();
		});

		it("returns null when window is larger than array", () => {
			expect(peakPowerFromSeconds([200, 200, 200, 200, 200], 60)).toBeNull();
		});

		it("returns null when all values are zero", () => {
			expect(peakPowerFromSeconds([0, 0, 0, 0, 0], 2)).toBeNull();
		});

		it("returns null when all values are null", () => {
			expect(peakPowerFromSeconds([null, null, null, null], 2)).toBeNull();
		});

		it("returns the value when array length equals window size", () => {
			// length 1, window 1 — exactly fits
			expect(peakPowerFromSeconds([350], 1)).toBe(350);
		});

		it("returns null when array is shorter than window", () => {
			expect(peakPowerFromSeconds([350], 2)).toBeNull();
		});

		it("returns the average when array length equals window size", () => {
			// length 3, window 3 — exactly fits: (100+200+300)/3 = 200
			expect(peakPowerFromSeconds([100, 200, 300], 3)).toBe(200);
		});
	});
});

describe("buildMetricBySecondFromTimeSeries", () => {
	it("returns an empty array for empty input", () => {
		expect(buildMetricBySecondFromTimeSeries([], [])).toEqual([]);
	});

	it("carries forward values across unsampled seconds", () => {
		// samples at t=0 (100), t=5 (200), t=10 (300)
		const timeArr = [0, 5, 10];
		const wattsArr = [100, 200, 300];
		expect(buildMetricBySecondFromTimeSeries(timeArr, wattsArr)).toEqual([
			100,
			100,
			100,
			100,
			100, // s 0-4
			200,
			200,
			200,
			200,
			200, // s 5-9
			300, // s 10
		]);
	});

	it("leaves seconds before the first sample as null", () => {
		// first sample at t=2; s 0-1 stay null, then carry-forward begins
		const timeArr = [2, 4];
		const wattsArr = [150, 250];
		expect(buildMetricBySecondFromTimeSeries(timeArr, wattsArr)).toEqual([
			null,
			null, // s 0-1 (before first sample)
			150,
			150, // s 2-3 (carry-forward from t=2)
			250, // s 4 (new sample at t=4)
		]);
	});

	it("seeds leading seconds from a t=0 sample", () => {
		// first sample at t=0 seeds the whole leading span
		const timeArr = [0, 5, 10];
		const wattsArr = [100, 200, 300];
		expect(buildMetricBySecondFromTimeSeries(timeArr, wattsArr)).toEqual([
			100,
			100,
			100,
			100,
			100, // s 0-4
			200,
			200,
			200,
			200,
			200, // s 5-9
			300, // s 10
		]);
	});
});

describe("peakPowerFromTimeSeries", () => {
	it("returns null for empty input", () => {
		expect(peakPowerFromTimeSeries([], [], 60)).toBeNull();
	});

	it("returns null when the time span is shorter than the window", () => {
		// spans 30s; 60s window can't fit
		const timeArr = Array.from({ length: 31 }, (_, i) => i);
		const wattsArr = new Array(31).fill(250);
		expect(peakPowerFromTimeSeries(timeArr, wattsArr, 60)).toBeNull();
	});

	it("matches peakPowerFromSeconds on an equivalent per-second array", () => {
		// 1Hz time series over 120s of constant 250W
		const timeArr = Array.from({ length: 121 }, (_, i) => i);
		const wattsArr = new Array(121).fill(250);
		const perSecond = buildMetricBySecondFromTimeSeries(timeArr, wattsArr);
		expect(peakPowerFromTimeSeries(timeArr, wattsArr, 60)).toBe(
			peakPowerFromSeconds(perSecond, 60),
		);
	});

	describe("equivalence with peakPowerFromSeconds", () => {
		it("variable-rate resample gives the same peak as the per-second source", () => {
			// Build a per-second array, then convert it to a time series and
			// compare the two peak computations — they must agree.
			const perSecond = [
				100,
				100,
				100,
				100,
				100, // warmup
				300,
				300,
				300,
				300,
				300, // 5s surge
				150,
				150,
				150,
				150,
				150, // cooldown
			];
			const timeArr = perSecond.map((_, i) => i);
			const wattsArr = perSecond.slice();
			expect(peakPowerFromTimeSeries(timeArr, wattsArr, 5)).toBe(
				peakPowerFromSeconds(perSecond, 5),
			);
		});

		it("sparse variable-rate stream agrees with its dense resample", () => {
			// Samples only every 5s; carry-forward fills the gaps.
			const timeArr = [0, 5, 10, 15];
			const wattsArr = [100, 400, 400, 100];
			const perSecond = buildMetricBySecondFromTimeSeries(timeArr, wattsArr);
			expect(peakPowerFromTimeSeries(timeArr, wattsArr, 5)).toBe(
				peakPowerFromSeconds(perSecond, 5),
			);
		});
	});

	describe("zero handling parity with peakPowerFromSeconds", () => {
		it("treats zeros in the stream the same as zeros in a per-second array", () => {
			const timeArr = [0, 1, 2, 3];
			const wattsArr = [400, 0, 0, 0];
			const perSecond = buildMetricBySecondFromTimeSeries(timeArr, wattsArr);
			expect(peakPowerFromTimeSeries(timeArr, wattsArr, 2)).toBe(
				peakPowerFromSeconds(perSecond, 2),
			);
			// and that value is the zero-inclusive 200, not 400
			expect(peakPowerFromTimeSeries(timeArr, wattsArr, 2)).toBe(200);
		});
	});
});
