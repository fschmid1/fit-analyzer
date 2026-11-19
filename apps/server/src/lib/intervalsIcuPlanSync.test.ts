import { describe, expect, it } from "bun:test";
import type { PlannedWorkout } from "@fit-analyzer/shared";
import type { IntervalsIcuEvent } from "./intervalsIcuClient.js";
import {
	buildIcuDescription,
	buildIcuEvent,
	buildIcuWorkoutDoc,
	ICU_UID_PREFIX,
	icuDocToSteps,
	icuEventSyncKey,
	icuEventToPlanWorkout,
	mergeIcuPlan,
} from "./intervalsIcuPlanSync.js";
import { planSyncKey } from "./planSyncCore.js";

const TZ = "Europe/Zurich";
const NOW = new Date("2026-09-30T10:00:00Z"); // 12:00 Zurich
const NOW_MS = NOW.getTime();

function workout(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
	return {
		date: "2026-10-01",
		startTime: "17:00",
		durationMinutes: 60,
		focus: "Threshold intervals",
		description: "3x10 min",
		sport: "Ride",
		steps: [],
		...overrides,
	};
}

function event(overrides: Partial<IntervalsIcuEvent> = {}): IntervalsIcuEvent {
	const date = overrides.start_date_local?.slice(0, 10) ?? "2026-10-01";
	const time = overrides.start_date_local?.slice(11, 16) ?? "17:00";
	const focus = overrides.name ?? "Threshold intervals";
	return {
		id: 100,
		uid: `${ICU_UID_PREFIX}${date}T${time}|${focus.toLowerCase()}`,
		category: "WORKOUT",
		type: "Ride",
		start_date_local: `${date}T${time}:00`,
		name: focus,
		description: "",
		moving_time: 3600,
		updated: new Date(NOW_MS - 60_000).toISOString(),
		...overrides,
	};
}

describe("buildIcuWorkoutDoc", () => {
	it("maps neutral steps and repeat blocks to a native doc", () => {
		const doc = buildIcuWorkoutDoc([
			{
				kind: "warmup",
				durationMinutes: 12,
				target: { metric: "power", pct: 55, range: null },
				note: null,
			},
			{
				repeat: 5,
				steps: [
					{
						kind: "interval",
						durationMinutes: 4,
						target: {
							metric: "power",
							pct: 110,
							range: { low: 105, high: 115 },
						},
						note: null,
					},
					{
						kind: "recovery",
						durationMinutes: 2,
						target: { metric: "power", pct: 50, range: null },
						note: null,
					},
				],
			},
		]);

		expect(doc?.target).toBe("POWER");
		expect(doc?.steps).toEqual([
			{
				duration: 720,
				power: { units: "%ftp", value: 55 },
				text: "warmup",
			},
			{
				reps: 5,
				steps: [
					{
						duration: 240,
						power: { units: "%ftp", start: 105, end: 115 },
					},
					{
						duration: 120,
						power: { units: "%ftp", value: 50 },
						text: "recovery",
					},
				],
			},
		]);
	});

	it("uses the first target's metric for the doc", () => {
		const doc = buildIcuWorkoutDoc([
			{
				kind: "interval",
				durationMinutes: 20,
				target: { metric: "hr", pct: 85, range: null },
				note: null,
			},
		]);
		expect(doc?.target).toBe("HR");
	});

	it("returns undefined for an empty session", () => {
		expect(buildIcuWorkoutDoc([])).toBeUndefined();
	});
});

describe("icuDocToSteps", () => {
	it("round-trips the native doc back to neutral steps", () => {
		const doc = buildIcuWorkoutDoc([
			{
				kind: "warmup",
				durationMinutes: 12,
				target: { metric: "power", pct: 55, range: null },
				note: null,
			},
			{
				repeat: 5,
				steps: [
					{
						kind: "interval",
						durationMinutes: 4,
						target: {
							metric: "power",
							pct: 110,
							range: { low: 105, high: 115 },
						},
						note: null,
					},
				],
			},
		]);

		expect(icuDocToSteps(doc)).toEqual([
			{
				kind: "interval",
				durationMinutes: 12,
				target: { metric: "power", pct: 55, range: null },
				note: "warmup",
			},
			{
				repeat: 5,
				steps: [
					{
						kind: "interval",
						durationMinutes: 4,
						target: {
							metric: "power",
							pct: 110,
							range: { low: 105, high: 115 },
						},
						note: null,
					},
				],
			},
		]);
	});

	it("returns [] for an unknown shape", () => {
		expect(icuDocToSteps(null)).toEqual([]);
		expect(icuDocToSteps({ steps: "nope" })).toEqual([]);
	});
});

describe("buildIcuEvent", () => {
	it("derives the uid from the sync key and defaults the sport", () => {
		const ev = buildIcuEvent(workout({ startTime: null, sport: undefined }));
		expect(ev.uid).toBe(
			`${ICU_UID_PREFIX}2026-10-01T17:00|threshold intervals`,
		);
		expect(ev.external_id).toBe(ev.uid);
		expect(ev.type).toBe("Ride");
		expect(ev.start_date_local).toBe("2026-10-01T17:00:00");
		expect(ev.moving_time).toBe(3600);
	});

	it("carries a cross-training sport and omits the structured doc", () => {
		const ev = buildIcuEvent(
			workout({
				sport: "WeightTraining",
				focus: "Gym",
				steps: [
					{
						kind: "interval",
						durationMinutes: 10,
						target: { metric: "power", pct: 50, range: null },
						note: null,
					},
				],
			}),
		);
		expect(ev.type).toBe("WeightTraining");
		expect(ev.workout_doc).toBeUndefined();
		expect(ev.description).toContain("10 min");
	});
});

describe("mergeIcuPlan", () => {
	it("creates a new workout", () => {
		const { actions, result } = mergeIcuPlan([workout()], [], [], TZ, NOW_MS, {
			respectEdits: true,
		});
		expect(actions).toHaveLength(1);
		expect(actions[0]?.kind).toBe("upsert");
		expect(result.created).toHaveLength(1);
		expect(result.deleted).toBe(0);
	});

	it("never schedules a workout that already started", () => {
		const { actions, result } = mergeIcuPlan(
			[workout({ date: "2026-09-30", startTime: "10:00" })],
			[],
			[],
			TZ,
			NOW_MS,
			{ respectEdits: true },
		);
		expect(actions).toHaveLength(0);
		expect(result.notScheduled).toHaveLength(1);
	});

	it("deletes our future events that left the plan", () => {
		const existing = event({ start_date_local: "2026-10-05T17:00:00", id: 7 });
		const { actions, result } = mergeIcuPlan([], [existing], [], TZ, NOW_MS, {
			respectEdits: true,
		});
		expect(actions).toEqual([
			{
				kind: "delete",
				key: planSyncKey(workout({ date: "2026-10-05" })),
				row: {
					date: "2026-10-05",
					startTime: "17:00",
					focus: "Threshold intervals",
				},
				event: existing,
			},
		]);
		expect(result.deleted).toBe(1);
	});

	it("never touches events without our uid prefix", () => {
		const race = event({
			uid: "race-123",
			category: "RACE_A",
			start_date_local: "2026-10-05T17:00:00",
		});
		const { actions, result } = mergeIcuPlan([], [race], [], TZ, NOW_MS, {
			respectEdits: true,
		});
		expect(actions).toHaveLength(0);
		expect(result.deleted).toBe(0);
	});

	it("skips an athlete edit on the primary target", () => {
		const existing = event({
			updated: new Date(NOW_MS - 60 * 60_000).toISOString(),
		});
		const { actions, result } = mergeIcuPlan(
			[workout()],
			[existing],
			[
				{
					syncKey: planSyncKey(workout()),
					writtenAt: NOW_MS - 120 * 60_000,
				},
			],
			TZ,
			NOW_MS,
			{ respectEdits: true },
		);
		expect(actions).toHaveLength(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.overwritten).toHaveLength(0);
	});

	it("overwrites an athlete edit on a projection and reports it", () => {
		const existing = event({
			updated: new Date(NOW_MS - 60 * 60_000).toISOString(),
		});
		const { actions, result } = mergeIcuPlan(
			[workout()],
			[existing],
			[
				{
					syncKey: planSyncKey(workout()),
					writtenAt: NOW_MS - 120 * 60_000,
				},
			],
			TZ,
			NOW_MS,
			{ respectEdits: false },
		);
		expect(actions).toHaveLength(1);
		expect(result.overwritten).toHaveLength(1);
	});

	it("treats our own write as unchanged", () => {
		const w = workout();
		const existing = event({
			description: "3x10 min",
			updated: new Date(NOW_MS - 30_000).toISOString(),
		});
		const { actions } = mergeIcuPlan(
			[w],
			[existing],
			[
				{
					syncKey: planSyncKey(w),
					writtenAt: NOW_MS - 60_000,
				},
			],
			TZ,
			NOW_MS,
			{ respectEdits: true },
		);
		expect(actions).toHaveLength(0);
	});
});

describe("icuEventSyncKey", () => {
	it("returns null for someone else's event", () => {
		expect(icuEventSyncKey(event({ uid: "someone-else" }))).toBeNull();
	});

	it("returns null for a non-workout category", () => {
		expect(icuEventSyncKey(event({ category: "NOTE" }))).toBeNull();
	});
});

describe("icuEventToPlanWorkout", () => {
	it("projects a future event with its structured steps", () => {
		const w = workout({
			steps: [
				{
					kind: "interval",
					durationMinutes: 20,
					target: { metric: "power", pct: 90, range: null },
					note: null,
				},
			],
		});
		const planned = icuEventToPlanWorkout(
			event({ workout_doc: buildIcuWorkoutDoc(w.steps ?? []) }),
			TZ,
			NOW,
		);
		expect(planned?.target).toBe("intervalsIcu");
		expect(planned?.steps).toHaveLength(1);
		expect(planned?.steps[0]).toEqual({
			kind: "interval",
			durationMinutes: 20,
			target: { metric: "power", pct: 90, range: null },
			note: null,
		});
	});

	it("reads the prose back without the rendered structure", () => {
		const w = workout({
			description: "3x10 min",
			steps: [
				{
					kind: "interval",
					durationMinutes: 10,
					target: { metric: "power", pct: 100, range: null },
					note: null,
				},
			],
		});
		const planned = icuEventToPlanWorkout(
			event({
				description: buildIcuDescription(w),
				workout_doc: buildIcuWorkoutDoc(w.steps ?? []),
			}),
			TZ,
			NOW,
		);
		expect(planned?.description).toBe("3x10 min");
		expect(planned?.steps).toHaveLength(1);
	});

	it("drops events that already started", () => {
		expect(
			icuEventToPlanWorkout(
				event({ start_date_local: "2026-09-30T10:00:00" }),
				TZ,
				NOW,
			),
		).toBeNull();
	});
});
