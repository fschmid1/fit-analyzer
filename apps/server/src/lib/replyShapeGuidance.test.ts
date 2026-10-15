import { describe, expect, it } from "bun:test";
import { COACH_VERBOSITIES } from "@fit-analyzer/shared";
import { buildReplyShapeGuidance } from "./replyShapeGuidance.js";

describe("buildReplyShapeGuidance", () => {
	it("carries the interpretation and silent-tools rules at every verbosity", () => {
		for (const verbosity of COACH_VERBOSITIES) {
			const guidance = buildReplyShapeGuidance(verbosity);
			expect(guidance).toContain("Do not restate a card's contents");
			expect(guidance).toContain("Call tools silently");
			expect(guidance).toContain("no paragraph longer than three sentences");
		}
	});

	it("keeps the heading on its own line so it cannot swallow the rules", () => {
		const [heading, firstRule] = buildReplyShapeGuidance("concise").split("\n");
		expect(heading).toBe("## How to reply");
		expect(firstRule).toContain("Structure every reply");
	});

	it("gives every verbosity a distinct shape", () => {
		const shapes = COACH_VERBOSITIES.map(buildReplyShapeGuidance);
		expect(new Set(shapes).size).toBe(COACH_VERBOSITIES.length);
	});

	it("caps Concise at four bullets and closes the door on extra sections", () => {
		const guidance = buildReplyShapeGuidance("concise");
		expect(guidance).toContain("at most four bullets");
		expect(guidance).toContain("no extra sections");
	});

	it("asks only Standard and Detailed for a next action line", () => {
		expect(buildReplyShapeGuidance("concise")).not.toContain("next action");
		expect(buildReplyShapeGuidance("standard")).toContain("next action");
		expect(buildReplyShapeGuidance("detailed")).toContain("next action");
	});
});
