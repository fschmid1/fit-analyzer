import { describe, expect, test } from "bun:test";
import {
	normalizeWorkoutSteps,
	renderWorkoutSteps,
	totalWorkoutMinutes,
	type WorkoutStepItem,
} from "./workoutPlan.js";

describe("normalizeWorkoutSteps", () => {
	test("normalizes a simple warmup + interval + cooldown", () => {
		const result = normalizeWorkoutSteps([
			{
				kind: "warmup",
				durationMinutes: 10,
				target: { metric: "power", pct: 55 },
			},
			{ durationMinutes: 8, target: { metric: "power", pct: 105 } },
			{ kind: "cooldown", durationMinutes: 5 },
		]);
		expect("steps" in result).toBe(true);
		if (!("steps" in result)) return;
		expect(result.steps).toHaveLength(3);
		expect(result.steps[1]).toEqual({
			kind: "interval",
			durationMinutes: 8,
			target: { metric: "power", pct: 105, range: null },
			note: null,
		});
	});

	test("keeps a repeat block with its nested steps", () => {
		const result = normalizeWorkoutSteps([
			{
				repeat: 4,
				steps: [
					{ durationMinutes: 8, target: { metric: "power", pct: 105 } },
					{
						kind: "recovery",
						durationMinutes: 4,
						target: { metric: "power", pct: 55 },
					},
				],
			},
		]);
		expect(result).toEqual({
			steps: [
				{
					repeat: 4,
					steps: [
						{
							kind: "interval",
							durationMinutes: 8,
							target: { metric: "power", pct: 105, range: null },
							note: null,
						},
						{
							kind: "recovery",
							durationMinutes: 4,
							target: { metric: "power", pct: 55, range: null },
							note: null,
						},
					],
				},
			],
		});
	});

	test("rejects nested repeats", () => {
		const result = normalizeWorkoutSteps([
			{ repeat: 2, steps: [{ repeat: 2, steps: [{ durationMinutes: 5 }] }] },
		]);
		expect(result).toEqual({ error: "steps[0] repeat blocks cannot nest" });
	});

	test("rejects a repeat with no steps", () => {
		expect(normalizeWorkoutSteps([{ repeat: 3, steps: [] }])).toEqual({
			error: "steps[0] repeat block needs at least one step",
		});
	});

	test("rejects a bad duration, metric and range", () => {
		expect(normalizeWorkoutSteps([{ durationMinutes: 0 }])).toEqual({
			error: "steps[0].durationMinutes must be 1–600",
		});
		expect(
			normalizeWorkoutSteps([
				{ durationMinutes: 5, target: { metric: "watts", pct: 100 } },
			]),
		).toEqual({ error: "steps[0].target.metric must be power, hr or pace" });
		expect(
			normalizeWorkoutSteps([
				{
					durationMinutes: 5,
					target: { metric: "power", pct: 100, range: { low: 110, high: 95 } },
				},
			]),
		).toEqual({
			error: "steps[0].target.range must be {low, high} with 0 < low ≤ high",
		});
	});

	test("treats null as no steps", () => {
		expect(normalizeWorkoutSteps(null)).toEqual({ steps: [] });
	});
});

describe("totalWorkoutMinutes", () => {
	test("counts repeats by their repeat factor", () => {
		const steps: WorkoutStepItem[] = [
			{ kind: "warmup", durationMinutes: 10, target: null, note: null },
			{
				repeat: 4,
				steps: [
					{ kind: "interval", durationMinutes: 8, target: null, note: null },
					{ kind: "recovery", durationMinutes: 4, target: null, note: null },
				],
			},
		];
		expect(totalWorkoutMinutes(steps)).toBe(10 + 4 * 12);
	});
});

describe("renderWorkoutSteps", () => {
	test("renders a warmup, a repeated set and a cooldown", () => {
		const steps: WorkoutStepItem[] = [
			{ kind: "warmup", durationMinutes: 10, target: null, note: null },
			{
				repeat: 4,
				steps: [
					{
						kind: "interval",
						durationMinutes: 8,
						target: { metric: "power", pct: 105, range: null },
						note: null,
					},
					{
						kind: "recovery",
						durationMinutes: 4,
						target: { metric: "power", pct: 55, range: null },
						note: null,
					},
				],
			},
			{ kind: "cooldown", durationMinutes: 5, target: null, note: null },
		];
		expect(renderWorkoutSteps(steps)).toBe(
			[
				"- 10 min (warmup)",
				"- 4 × (8 min @ 105% FTP, 4 min @ 55% FTP (recovery))",
				"- 5 min (cooldown)",
			].join("\n"),
		);
	});

	test("renders a target range", () => {
		const steps: WorkoutStepItem[] = [
			{
				kind: "interval",
				durationMinutes: 20,
				target: { metric: "power", pct: 100, range: { low: 95, high: 105 } },
				note: null,
			},
		];
		expect(renderWorkoutSteps(steps)).toBe("- 20 min @ 95–105% FTP");
	});
});
