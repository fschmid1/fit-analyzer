import { describe, expect, it } from "bun:test";
import {
	DEFAULT_COACH_INSTRUCTIONS,
	MAX_COACH_INSTRUCTIONS_LENGTH,
	isCoachInstructionsWithinLimit,
	normalizeCoachInstructions,
} from "./coachInstructions.js";

describe("normalizeCoachInstructions", () => {
	it("trims the athlete's text and keeps its body", () => {
		expect(normalizeCoachInstructions("  Be blunt.\n")).toBe("Be blunt.");
	});

	it("treats missing and non-string values as no instructions", () => {
		expect(normalizeCoachInstructions(undefined)).toBe(
			DEFAULT_COACH_INSTRUCTIONS,
		);
		expect(normalizeCoachInstructions(null)).toBe(DEFAULT_COACH_INSTRUCTIONS);
		expect(normalizeCoachInstructions(42)).toBe(DEFAULT_COACH_INSTRUCTIONS);
	});
});

describe("isCoachInstructionsWithinLimit", () => {
	it("accepts the cap itself and rejects one character more", () => {
		expect(
			isCoachInstructionsWithinLimit("a".repeat(MAX_COACH_INSTRUCTIONS_LENGTH)),
		).toBe(true);
		expect(
			isCoachInstructionsWithinLimit(
				"a".repeat(MAX_COACH_INSTRUCTIONS_LENGTH + 1),
			),
		).toBe(false);
	});
});
