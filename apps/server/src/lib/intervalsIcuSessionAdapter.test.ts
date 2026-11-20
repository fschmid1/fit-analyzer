import { describe, expect, it } from "bun:test";
import { intervalsIcuSessionFromActivity } from "./intervalsIcuSessionAdapter.js";

describe("intervals.icu cross-training filter", () => {
	it("maps a strength session to a summary", () => {
		const result = intervalsIcuSessionFromActivity({
			id: "i42",
			type: "WeightTraining",
			start_date_local: "2026-11-18T18:30:00",
			name: "Gym",
			moving_time: 3300,
			elapsed_time: 3600,
			average_heartrate: 111.6,
			max_heartrate: 148.2,
			icu_training_load: 41.8,
			kg_lifted: 3250.4,
		});
		if ("skipped" in result) throw new Error("expected a session");
		expect(result.session).toEqual({
			date: "2026-11-18",
			startTime: "18:30",
			sport: "WeightTraining",
			name: "Gym",
			durationSeconds: 3300,
			elapsedSeconds: 3600,
			distanceKm: null,
			avgHeartRate: 112,
			maxHeartRate: 148,
			trainingLoad: 41.8,
			kgLifted: 3250.4,
			description: null,
			tags: [],
			source: "intervals-icu",
			sourceActivityId: "i42",
		});
	});

	it("falls back to the sport label when the name is missing", () => {
		const result = intervalsIcuSessionFromActivity({
			id: "i43",
			type: "Run",
			start_date_local: "2026-11-17T07:00:00",
			moving_time: 1800,
			distance: 5200,
		});
		if ("skipped" in result) throw new Error("expected a session");
		expect(result.session.name).toBe("Run");
		expect(result.session.distanceKm).toBe(5.2);
		expect(result.session.startTime).toBe("07:00");
	});

	it("keeps the athlete's notes and tags", () => {
		const result = intervalsIcuSessionFromActivity({
			id: "i44",
			type: "WeightTraining",
			start_date_local: "2026-11-16T18:00:00",
			name: "Leg day",
			description: "  Squats 5x5 @ 100kg\nRDL 3x8  ",
			tags: ["legs", " squat ", ""],
		});
		if ("skipped" in result) throw new Error("expected a session");
		expect(result.session.description).toBe("Squats 5x5 @ 100kg\nRDL 3x8");
		expect(result.session.tags).toEqual(["legs", "squat"]);
	});

	it("skips rides, Strava relays and activities without a date", () => {
		expect(
			intervalsIcuSessionFromActivity({
				id: "1",
				type: "Ride",
				start_date_local: "2026-11-18T18:30:00",
			}),
		).toEqual({ skipped: "ride" });
		expect(
			intervalsIcuSessionFromActivity({
				id: "2",
				type: "WeightTraining",
				source: "STRAVA",
				start_date_local: "2026-11-18T18:30:00",
			}),
		).toEqual({ skipped: "strava-sourced" });
		expect(
			intervalsIcuSessionFromActivity({ id: "3", type: "WeightTraining" }),
		).toEqual({ skipped: "no-date" });
		expect(
			intervalsIcuSessionFromActivity({
				id: "4",
				start_date_local: "2026-11-18T18:30:00",
			}),
		).toEqual({ skipped: "no-type" });
	});
});
