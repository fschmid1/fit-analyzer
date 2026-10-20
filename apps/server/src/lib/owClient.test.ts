import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type * as OwClientModule from "./owClient.js";
import type { BodySummaryResponse, OwDailySnapshot } from "./owClient.js";

const DB_PATH = `/tmp/ow-client-test-${crypto.randomUUID()}.db`;

let ow: typeof OwClientModule;

beforeAll(async () => {
	// `db` reads its path from env at import time, so point it at a temp
	// database before loading the module graph.
	process.env.DB_PATH = DB_PATH;
	ow = await import("./owClient.js");
});

afterAll(() => {
	// Leave the tables in place: other test files may share the cached `db`
	// singleton. Unlinking the file is enough; the open handle keeps the
	// schema alive for the rest of the run.
	Bun.file(DB_PATH)
		.delete()
		.catch(() => {});
});

type SleepSnapshot = NonNullable<OwDailySnapshot["sleep"]>;

function sleep(
	avgHeartRateBpm: number | null,
	avgHrvSdnnMs: number | null,
): SleepSnapshot {
	return {
		durationMinutes: 480,
		efficiencyPercent: 90,
		stages: null,
		avgHeartRateBpm,
		avgHrvSdnnMs,
		avgRespiratoryRate: 14,
		avgSpo2Percent: 97,
	};
}

function bodySummary(
	overrides: {
		restingHeartRateBpm?: number | null;
		avgHrvSdnnMs?: number | null;
		weightKg?: number | null;
		bodyTemperatureC?: number | null;
		bodyTemperatureMeasuredAt?: string | null;
		bloodPressure?: {
			systolic: number | null;
			diastolic: number | null;
		} | null;
	} = {},
): BodySummaryResponse {
	const bp = overrides.bloodPressure;
	return {
		source: { provider: "apple", device: null },
		slow_changing: {
			weight_kg: overrides.weightKg ?? null,
			height_cm: null,
			body_fat_percent: null,
			muscle_mass_kg: null,
			bmi: null,
			age: null,
		},
		averaged: {
			period_days: 7,
			resting_heart_rate_bpm: overrides.restingHeartRateBpm ?? null,
			avg_hrv_sdnn_ms: overrides.avgHrvSdnnMs ?? null,
			avg_hrv_rmssd_ms: null,
			period_start: "2026-10-14T00:00:00Z",
			period_end: "2026-10-20T00:00:00Z",
		},
		latest: {
			body_temperature_celsius: overrides.bodyTemperatureC ?? null,
			body_temperature_measured_at: overrides.bodyTemperatureMeasuredAt ?? null,
			skin_temperature_celsius: null,
			skin_temperature_measured_at: null,
			blood_pressure: bp
				? {
						avg_systolic_mmhg: bp.systolic,
						avg_diastolic_mmhg: bp.diastolic,
						max_systolic_mmhg: null,
						max_diastolic_mmhg: null,
						min_systolic_mmhg: null,
						min_diastolic_mmhg: null,
						reading_count: 1,
					}
				: null,
			blood_pressure_measured_at: null,
		},
	};
}

describe("OW health context", () => {
	it("uses the latest daily RHR/HRV for current and the body 7-day average for trend", () => {
		const ctx = ow.computeHealthContext([
			{
				date: "2026-10-19",
				snap: {
					sleep: sleep(51, 84),
					dailyRestingHeartRateBpm: 49,
					dailyHrvSdnnMs: 80,
				},
			},
			{
				date: "2026-10-20",
				snap: {
					sleep: sleep(51, 84),
					dailyRestingHeartRateBpm: 48,
					dailyHrvSdnnMs: 70,
					restingHeartRateBpm: 51,
					avgHrvSdnnMs: 66,
				},
			},
		]);

		expect(ctx.rhr?.current).toBe(48);
		expect(ctx.rhr?.trend7d).toBe(51);
		expect(ctx.hrv?.current).toBe(70);
		expect(ctx.hrv?.trend7d).toBe(66);
	});

	it("falls back to the sleep average when the body summary has no value", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-20", snap: { sleep: sleep(51, 86) } },
		]);

		expect(ctx.rhr?.current).toBe(51);
		expect(ctx.hrv?.current).toBe(86);
	});

	it("keeps the last body-summary value when a newer sleep-only poll arrives", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-20", snap: { sleep: sleep(52, 90) } },
			{
				date: "2026-10-19",
				snap: {
					sleep: sleep(51, 84),
					restingHeartRateBpm: 48,
					avgHrvSdnnMs: 86,
				},
			},
		]);

		expect(ctx.rhr?.current).toBe(48);
		expect(ctx.hrv?.current).toBe(86);
	});

	it("keeps using the latest daily value when a newer sleep-only poll arrives", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-20", snap: { sleep: sleep(52, 90) } },
			{
				date: "2026-10-19",
				snap: {
					sleep: sleep(51, 84),
					dailyRestingHeartRateBpm: 48,
					dailyHrvSdnnMs: 70,
				},
			},
		]);

		expect(ctx.rhr?.current).toBe(48);
		expect(ctx.hrv?.current).toBe(70);
	});

	it("keeps daily values when the body summary explicitly reports no average", () => {
		const ctx = ow.computeHealthContext([
			{
				date: "2026-10-20",
				snap: {
					sleep: sleep(52, 90),
					dailyRestingHeartRateBpm: 48,
					dailyHrvSdnnMs: 70,
					restingHeartRateBpm: null,
					avgHrvSdnnMs: null,
				},
			},
		]);

		expect(ctx.rhr?.current).toBe(48);
		expect(ctx.rhr?.trend7d).toBe(48);
		expect(ctx.hrv?.current).toBe(70);
		expect(ctx.hrv?.trend7d).toBe(70);
	});

	it("does not resurrect an older body value after an explicit null", () => {
		const ctx = ow.computeHealthContext([
			{
				date: "2026-10-20",
				snap: {
					sleep: sleep(52, 90),
					restingHeartRateBpm: null,
					avgHrvSdnnMs: null,
				},
			},
			{
				date: "2026-10-19",
				snap: {
					sleep: sleep(51, 84),
					restingHeartRateBpm: 48,
					avgHrvSdnnMs: 86,
				},
			},
		]);

		expect(ctx.rhr?.current).toBe(52);
		expect(ctx.hrv?.current).toBe(90);
	});

	it("does not resurrect a body value when a newer date has no body fields", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-21", snap: { dailyRestingHeartRateBpm: 48 } },
			{
				date: "2026-10-20",
				snap: {
					sleep: sleep(52, 90),
					restingHeartRateBpm: null,
					avgHrvSdnnMs: null,
				},
			},
			{
				date: "2026-10-19",
				snap: { restingHeartRateBpm: 51, avgHrvSdnnMs: 66 },
			},
		]);

		expect(ctx.rhr?.current).toBe(48);
		expect(ctx.rhr?.trend7d).toBe(48);
		expect(ctx.hrv?.current).toBe(90);
	});

	it("derives RHR from the body summary even without a sleep snapshot", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-20", snap: { restingHeartRateBpm: 48 } },
		]);

		expect(ctx.rhr?.current).toBe(48);
		expect(ctx.sleep).toBeNull();
	});

	it("shows body temperature only while it is in the freshness window", () => {
		const now = Date.parse("2026-10-20T12:00:00Z");
		const fresh = ow.computeHealthContext(
			[
				{
					date: "2026-10-20",
					snap: {
						bodyTemperatureC: 36.6,
						bodyTemperatureMeasuredAt: "2026-10-20T10:00:00Z",
					},
				},
			],
			now,
		);
		const stale = ow.computeHealthContext(
			[
				{
					date: "2026-10-20",
					snap: {
						bodyTemperatureC: 36.6,
						bodyTemperatureMeasuredAt: "2026-10-20T06:00:00Z",
					},
				},
			],
			now,
		);

		expect(fresh.temperature?.current).toBe(36.6);
		expect(stale.temperature).toBeNull();
	});

	it("ignores a persisted temperature with no measurement time", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-20", snap: { bodyTemperatureC: 36.6 } },
		]);

		expect(ctx.temperature).toBeNull();
	});

	it("averages exactly the seven most recent dates", () => {
		const ctx = ow.computeHealthContext([
			{ date: "2026-10-13", snap: { sleep: sleep(100, 84) } },
			{ date: "2026-10-14", snap: { sleep: sleep(50, 84) } },
			{ date: "2026-10-15", snap: { sleep: sleep(50, 84) } },
			{ date: "2026-10-16", snap: { sleep: sleep(50, 84) } },
			{ date: "2026-10-17", snap: { sleep: sleep(50, 84) } },
			{ date: "2026-10-18", snap: { sleep: sleep(50, 84) } },
			{ date: "2026-10-19", snap: { sleep: sleep(50, 84) } },
			{ date: "2026-10-20", snap: { sleep: sleep(50, 84) } },
		]);

		expect(ctx.rhr?.current).toBe(50);
		expect(ctx.rhr?.trend7d).toBe(50);
	});
});

describe("OW daily vital aggregation", () => {
	it("averages each UTC day and ignores daily totals", () => {
		const samples = [
			{
				timestamp: "2026-10-20T06:00:00Z",
				type: "resting_heart_rate",
				value: 48,
			},
			{
				timestamp: "2026-10-20T18:00:00Z",
				type: "resting_heart_rate",
				value: 50,
			},
			{
				// 00:30+02:00 is 22:30Z on the 20th, matching OW's UTC grouping.
				timestamp: "2026-10-21T00:30:00+02:00",
				type: "resting_heart_rate",
				value: 52,
			},
			{
				timestamp: "2026-10-19T12:00:00Z",
				type: "resting_heart_rate",
				value: 60,
				is_daily_total: true,
			},
			{
				timestamp: "2026-10-19T12:00:00Z",
				type: "heart_rate_variability_sdnn",
				value: 80,
			},
			{
				timestamp: "2026-10-19T18:00:00Z",
				type: "heart_rate_variability_sdnn",
				value: 90,
			},
		];

		const rhr = ow.dailyMeans(samples, "resting_heart_rate");
		const hrv = ow.dailyMeans(samples, "heart_rate_variability_sdnn");

		expect(rhr.get("2026-10-20")).toBe(50);
		expect(rhr.get("2026-10-21")).toBeUndefined();
		expect(hrv.get("2026-10-19")).toBe(85);
	});
});

describe("OW body summary mapping", () => {
	it("maps the API's averaged blood-pressure fields", () => {
		const body = ow.mapBodySummary(
			bodySummary({ bloodPressure: { systolic: 118, diastolic: 76 } }),
		);

		expect(body.bloodPressure).toEqual({ systolic: 118, diastolic: 76 });
	});

	it("drops an incomplete blood-pressure reading", () => {
		const body = ow.mapBodySummary(
			bodySummary({ bloodPressure: { systolic: 118, diastolic: null } }),
		);

		expect(body.bloodPressure).toBeNull();
	});
});

describe("OW snapshot persistence", () => {
	it("stores body-summary RHR/HRV with the latest snapshot and serves them in history", () => {
		ow.persistOwSnapshots(
			"u1",
			[
				{
					date: "2026-10-20",
					duration_minutes: 480,
					avg_heart_rate_bpm: 51,
					avg_hrv_sdnn_ms: 84,
				},
			],
			bodySummary({ restingHeartRateBpm: 48, avgHrvSdnnMs: 86 }),
		);

		const history = ow.getOwHistory("u1", "2026-10-14", "2026-10-21");
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({
			date: "2026-10-20",
			rhr: 48,
			hrv: 86,
			sleepDurationMinutes: 480,
		});
	});

	it("stores daily RHR/HRV on their own dates", () => {
		ow.persistOwSnapshots(
			"u5",
			[
				{
					date: "2026-10-20",
					duration_minutes: 480,
					avg_heart_rate_bpm: 55,
					avg_hrv_sdnn_ms: 84,
				},
			],
			bodySummary({ restingHeartRateBpm: 51, avgHrvSdnnMs: 66 }),
			{
				rhr: new Map([
					["2026-10-19", 49],
					["2026-10-20", 48],
				]),
				hrv: new Map([
					["2026-10-19", 80],
					["2026-10-20", 70],
				]),
			},
		);

		const history = ow.getOwHistory("u5", "2026-10-14", "2026-10-21");
		expect(history.find((entry) => entry.date === "2026-10-19")).toMatchObject({
			rhr: 49,
			hrv: 80,
		});
		expect(history.find((entry) => entry.date === "2026-10-20")).toMatchObject({
			rhr: 48,
			hrv: 70,
			sleepDurationMinutes: 480,
		});
	});

	it("clears a body-summary value the next summary no longer reports", () => {
		const sleepRecord = {
			date: "2026-10-20",
			duration_minutes: 480,
			avg_heart_rate_bpm: 51,
			avg_hrv_sdnn_ms: 84,
		};
		ow.persistOwSnapshots(
			"u3",
			[sleepRecord],
			bodySummary({ restingHeartRateBpm: 48, avgHrvSdnnMs: 86 }),
		);
		ow.persistOwSnapshots("u3", [sleepRecord], bodySummary());

		const history = ow.getOwHistory("u3", "2026-10-14", "2026-10-21");
		expect(history[0]).toMatchObject({ rhr: 51, hrv: 84 });
	});

	it("keeps the body-summary values when a later sleep-only poll merges in", () => {
		const sleepRecord = {
			date: "2026-10-20",
			duration_minutes: 480,
			avg_heart_rate_bpm: 51,
			avg_hrv_sdnn_ms: 84,
		};
		ow.persistOwSnapshots(
			"u2",
			[sleepRecord],
			bodySummary({ restingHeartRateBpm: 48, avgHrvSdnnMs: 86 }),
		);
		ow.persistOwSnapshots("u2", [sleepRecord], null);

		const history = ow.getOwHistory("u2", "2026-10-14", "2026-10-21");
		expect(history[0]).toMatchObject({ rhr: 48, hrv: 86 });
	});

	it("stores body temperature on its measurement date and serves it in history", () => {
		ow.persistOwSnapshots(
			"u4",
			[
				{
					date: "2026-10-19",
					duration_minutes: 480,
					avg_heart_rate_bpm: 51,
					avg_hrv_sdnn_ms: 84,
				},
			],
			bodySummary({
				bodyTemperatureC: 36.6,
				bodyTemperatureMeasuredAt: "2026-10-20T07:30:00Z",
			}),
		);

		const history = ow.getOwHistory("u4", "2026-10-14", "2026-10-21");
		expect(history.find((entry) => entry.date === "2026-10-19")).toMatchObject({
			temperature: null,
		});
		expect(history.find((entry) => entry.date === "2026-10-20")).toMatchObject({
			temperature: 36.6,
		});
	});
});
