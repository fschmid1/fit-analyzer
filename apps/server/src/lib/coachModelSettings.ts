import type { CoachModelSettings } from "@fit-analyzer/shared";
import { AVAILABLE_MODELS } from "@fit-analyzer/shared";
import { db } from "../db.js";
import { isOllamaModelKnown } from "./ollamaModelCache.js";

const DEFAULT_COACH_MODEL = "moonshotai/kimi-k2.6";

interface UserSettingsRow {
	coach_model: string;
}

const getSettingsStmt = db.prepare<UserSettingsRow, [string]>(
	"SELECT coach_model FROM user_settings WHERE user_id = ?",
);

const upsertSettingsStmt = db.prepare(
	`INSERT INTO user_settings (user_id, coach_model) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET coach_model = excluded.coach_model`,
);

async function sanitizeCoachModel(value: string | null | undefined): Promise<string> {
	if (!value) return DEFAULT_COACH_MODEL;
	const id = value.trim();
	const known = AVAILABLE_MODELS.find((m) => m.id === id);
	if (known) return known.id;
	if (await isOllamaModelKnown(id)) return id;
	return DEFAULT_COACH_MODEL;
}

export async function getCoachModelSettings(userId: string): Promise<CoachModelSettings> {
	const row = getSettingsStmt.get(userId) ?? null;
	return {
		coachModel: await sanitizeCoachModel(row?.coach_model),
	};
}

export async function updateCoachModelSettings(
	userId: string,
	input: { coachModel: string },
): Promise<CoachModelSettings> {
	upsertSettingsStmt.run(userId, await sanitizeCoachModel(input.coachModel));
	return getCoachModelSettings(userId);
}
