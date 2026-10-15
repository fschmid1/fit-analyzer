/**
 * The athlete's chosen level of detail for every coach reply (ADR-0004).
 * Shared vocabulary so the server's prompt builder and the web settings
 * control cannot disagree about what the modes are called.
 */

export type CoachVerbosity = "concise" | "standard" | "detailed";

export const COACH_VERBOSITIES = ["concise", "standard", "detailed"] as const;

export const DEFAULT_COACH_VERBOSITY: CoachVerbosity = "concise";

export const COACH_VERBOSITY_LABELS: Record<CoachVerbosity, string> = {
	concise: "Concise",
	standard: "Standard",
	detailed: "Detailed",
};

export const COACH_VERBOSITY_BLURBS: Record<CoachVerbosity, string> = {
	concise: "A lead sentence and up to four one-line bullets. Nothing else.",
	standard:
		"A lead sentence, up to six bullets with a short rationale, and one next action.",
	detailed:
		"Standard's structure with room for longer bullets and extra sections.",
};

export function isCoachVerbosity(value: unknown): value is CoachVerbosity {
	return (
		typeof value === "string" &&
		(COACH_VERBOSITIES as readonly string[]).includes(value)
	);
}
