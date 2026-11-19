import { describe, expect, it } from "bun:test";
import {
	buildRecordsFromStreams,
	intervalsIcuActivityToPayload,
	isIntervalsIcuRide,
	isStravaSourced,
} from "./intervalsIcuImportAdapter.js";

const START = new Date("2026-10-01T06:00:00Z");

describe("intervals.icu activity filters", () => {
	it("accepts road, virtual and gravel rides", () => {
		expect(isIntervalsIcuRide({ id: "1", type: "Ride" })).toBe(true);
		expect(isIntervalsIcuRide({ id: "1", type: "VirtualRide" })).toBe(true);
		expect(isIntervalsIcuRide({ id: "1", type: "GravelRide" })).toBe(true);
	});

	it("rejects runs and strength work", () => {
		expect(isIntervalsIcuRide({ id: "1", type: "Run" })).toBe(false);
		expect(isIntervalsIcuRide({ id: "1", type: "WeightTraining" })).toBe(false);
		expect(isIntervalsIcuRide({ id: "1" })).toBe(false);
	});

	it("detects Strava-sourced activities by source or id", () => {
		expect(isStravaSourced({ id: "1", source: "STRAVA" })).toBe(true);
		expect(isStravaSourced({ id: "1", strava_id: "123" })).toBe(true);
		expect(isStravaSourced({ id: "1", source: "GARMIN_CONNECT" })).toBe(false);
	});
});

describe("buildRecordsFromStreams", () => {
	it("maps per-second streams to stored records", () => {
		const records = buildRecordsFromStreams(START, [
			{ type: "time", data: [0, 1, 2] },
			{ type: "watts", data: [200, 210, 220] },
			{ type: "heartrate", data: [140, 141, 142] },
			{ type: "cadence", data: [85, 86, 87] },
			{ type: "velocity_smooth", data: [7, 7.5, 8] },
			{ type: "grade_smooth", data: [0, 1, -1] },
			{
				type: "latlng",
				data: [
					[47.3, 8.5],
					[47.31, 8.51],
					[47.32, 8.52],
				],
			},
		]);

		expect(records).toHaveLength(3);
		expect(records[0]).toEqual({
			timestamp: "2026-10-01T06:00:00.000Z",
			elapsedSeconds: 0,
			power: 200,
			heartRate: 140,
			cadence: 85,
			speed: 25.2,
			gradient: 0,
			lat: 47.3,
			lng: 8.5,
		});
	});

	it("leaves missing streams null instead of throwing", () => {
		const records = buildRecordsFromStreams(START, [
			{ type: "time", data: [0, 1] },
			{ type: "watts", data: [200] },
		]);
		expect(records[0]?.power).toBe(200);
		expect(records[1]?.power).toBeNull();
		expect(records[1]?.heartRate).toBeNull();
		expect(records[1]?.lat).toBeNull();
	});

	it("returns no records without a time stream", () => {
		expect(
			buildRecordsFromStreams(START, [{ type: "watts", data: [200] }]),
		).toEqual([]);
	});
});

describe("intervalsIcuActivityToPayload", () => {
	it("stores records at the real UTC instant of the local start", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify([
					{ type: "time", data: [0, 1] },
					{ type: "watts", data: [200, 210] },
				]),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as unknown as typeof fetch;
		try {
			const result = await intervalsIcuActivityToPayload(
				"user-1",
				"key",
				{
					id: "i123",
					type: "Ride",
					start_date_local: "2026-10-01T08:00:00",
					moving_time: 2,
					distance: 10,
				},
				"Europe/Zurich",
			);
			if ("skipped" in result)
				throw new Error(`unexpected skip: ${result.skipped}`);
			// 08:00 in Zurich (CEST, +2) is 06:00Z.
			expect(result.payload.records[0]?.timestamp).toBe(
				"2026-10-01T06:00:00.000Z",
			);
			expect(result.payload.timezone).toBe("Europe/Zurich");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("skips Strava-sourced rides without fetching streams", async () => {
		const original = globalThis.fetch;
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("[]", { status: 200 });
		}) as unknown as typeof fetch;
		try {
			const result = await intervalsIcuActivityToPayload(
				"user-1",
				"key",
				{ id: "i1", type: "Ride", source: "STRAVA" },
				"Europe/Zurich",
			);
			expect(result).toEqual({ skipped: "strava-sourced" });
			expect(called).toBe(false);
		} finally {
			globalThis.fetch = original;
		}
	});
});
