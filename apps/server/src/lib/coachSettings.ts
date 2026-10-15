import type { CoachModelSettings, CoachVerbosity } from "@fit-analyzer/shared";
import {
	AVAILABLE_MODELS,
	DEFAULT_COACH_VERBOSITY,
	isCoachVerbosity,
} from "@fit-analyzer/shared";
import { db } from "../db.js";
import { isOllamaModelKnown } from "./ollamaModelCache.js";

/**
 * The coach settings: which model plays the coach, and how verbose its replies
 * are (ADR-0004). Both live on the same `user_settings` row, so this module
 * owns that row for coach concerns and reads it once per lookup.
 *
 * Verbosity is per-user only — unlike the model, it has no per-thread override.
 */

const DEFAULT_COACH_MODEL = "moonshotai/kimi-k2.6";

interface UserSettingsRow {
	coach_model: string | null;
	coach_verbosity: string | null;
}

const getSettingsStmt = db.prepare<UserSettingsRow, [string]>(
	"SELECT coach_model, coach_verbosity FROM user_settings WHERE user_id = ?",
);

const upsertModelStmt = db.prepare(
	`INSERT INTO user_settings (user_id, coach_model) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET coach_model = excluded.coach_model`,
);

const upsertVerbosityStmt = db.prepare(
	`INSERT INTO user_settings (user_id, coach_verbosity) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET coach_verbosity = excluded.coach_verbosity`,
);

async function sanitizeCoachModel(
	value: string | null | undefined,
): Promise<string> {
	if (!value) return DEFAULT_COACH_MODEL;
	const id = value.trim();
	const known = AVAILABLE_MODELS.find((m) => m.id === id);
	if (known) return known.id;
	if (await isOllamaModelKnown(id)) return id;
	return DEFAULT_COACH_MODEL;
}

function sanitizeCoachVerbosity(value: unknown): CoachVerbosity {
	return isCoachVerbosity(value) ? value : DEFAULT_COACH_VERBOSITY;
}

export async function getCoachModelSettings(
	userId: string,
): Promise<CoachModelSettings> {
	const row = getSettingsStmt.get(userId) ?? null;
	return {
		coachModel: await sanitizeCoachModel(row?.coach_model),
	};
}

export function getCoachVerbositySettings(userId: string): CoachVerbosity {
	const row = getSettingsStmt.get(userId) ?? null;
	return sanitizeCoachVerbosity(row?.coach_verbosity);
}

export async function updateCoachModelSettings(
	userId: string,
	input: { coachModel: string },
): Promise<CoachModelSettings> {
	upsertModelStmt.run(userId, await sanitizeCoachModel(input.coachModel));
	return getCoachModelSettings(userId);
}

export function updateCoachVerbositySettings(
	userId: string,
	verbosity: unknown,
): CoachVerbosity {
	const next = sanitizeCoachVerbosity(verbosity);
	upsertVerbosityStmt.run(userId, next);
	return next;
}
