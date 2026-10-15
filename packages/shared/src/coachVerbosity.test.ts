import { describe, expect, it } from "bun:test";
import {
	COACH_VERBOSITIES,
	COACH_VERBOSITY_BLURBS,
	COACH_VERBOSITY_LABELS,
	DEFAULT_COACH_VERBOSITY,
	isCoachVerbosity,
} from "./coachVerbosity.js";

describe("isCoachVerbosity", () => {
	it("accepts every declared mode", () => {
		for (const verbosity of COACH_VERBOSITIES) {
			expect(isCoachVerbosity(verbosity)).toBe(true);
		}
	});

	it("rejects anything else the settings row might hold", () => {
		expect(isCoachVerbosity("verbose")).toBe(false);
		expect(isCoachVerbosity("")).toBe(false);
		expect(isCoachVerbosity(null)).toBe(false);
		expect(isCoachVerbosity(undefined)).toBe(false);
		expect(isCoachVerbosity(3)).toBe(false);
	});
});

describe("coach verbosity vocabulary", () => {
	it("covers every mode with a label and a blurb", () => {
		for (const verbosity of COACH_VERBOSITIES) {
			expect(COACH_VERBOSITY_LABELS[verbosity]).toBeTruthy();
			expect(COACH_VERBOSITY_BLURBS[verbosity]).toBeTruthy();
		}
	});

	it("defaults to the mode the shape contract treats as tersest", () => {
		expect(DEFAULT_COACH_VERBOSITY).toBe("concise");
	});
});
