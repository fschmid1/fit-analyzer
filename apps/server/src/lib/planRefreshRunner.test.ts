import { describe, expect, it } from "bun:test";
import type { UIToolCall } from "@fit-analyzer/shared";
import { evaluateRefreshOutcome } from "./planRefreshRunner.js";

const ADD = "add_workouts_to_calendar";

function syncCall(display: unknown, error?: string): UIToolCall {
	return {
		id: "t1",
		name: ADD,
		arguments: {},
		status: error ? "error" : "done",
		result: {
			id: "t1",
			name: ADD,
			content: "",
			display,
			error,
		},
	};
}

describe("evaluateRefreshOutcome", () => {
	it("succeeds when the sync wrote workouts", () => {
		const outcome = evaluateRefreshOutcome(
			[syncCall({ created: [{}, {}], updated: [{}], errors: [] })],
			"Week ahead: two rides.",
		);
		expect(outcome).toEqual({ ok: true, scheduledCount: 3 });
	});

	it("succeeds with scheduledCount 0 for an unchanged plan", () => {
		const outcome = evaluateRefreshOutcome(
			[syncCall({ created: [], updated: [], errors: [] })],
			"No changes needed.",
		);
		expect(outcome).toEqual({ ok: true, scheduledCount: 0 });
	});

	it("fails when the coach never called the sync tool", () => {
		const outcome = evaluateRefreshOutcome([], "Here is some advice.");
		expect(outcome.ok).toBe(false);
	});

	it("fails when per-event sync errors were swallowed into the display", () => {
		const outcome = evaluateRefreshOutcome(
			[
				syncCall({
					created: [{}],
					updated: [],
					errors: ["create failed for X"],
				}),
			],
			"Done.",
		);
		expect(outcome).toEqual({
			ok: false,
			error: "Calendar sync failed: create failed for X",
		});
	});

	it("fails when the tool call itself errored", () => {
		const outcome = evaluateRefreshOutcome(
			[syncCall(null, "Google Calendar not connected")],
			"Done.",
		);
		expect(outcome).toEqual({
			ok: false,
			error: "Google Calendar not connected",
		});
	});

	it("fails when the refresh produced no assistant text", () => {
		const outcome = evaluateRefreshOutcome(
			[syncCall({ created: [{}], updated: [], errors: [] })],
			"   ",
		);
		expect(outcome).toEqual({
			ok: false,
			error: "Plan refresh produced no message",
		});
	});
});
