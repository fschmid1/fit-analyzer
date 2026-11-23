/**
 * The athlete's own standing instructions for the coach: a free-form prompt
 * extension appended to every coach system prompt. Shared so the settings
 * control and the server's prompt builder agree on the empty default and the
 * cap that keeps a pasted essay from crowding out the rest of the prompt.
 */

export const MAX_COACH_INSTRUCTIONS_LENGTH = 2000;

export const DEFAULT_COACH_INSTRUCTIONS = "";

/** Trim a stored/requested value to the form the prompt builder expects. */
export function normalizeCoachInstructions(value: unknown): string {
	return typeof value === "string" ? value.trim() : DEFAULT_COACH_INSTRUCTIONS;
}

export function isCoachInstructionsWithinLimit(value: string): boolean {
	return value.length <= MAX_COACH_INSTRUCTIONS_LENGTH;
}
