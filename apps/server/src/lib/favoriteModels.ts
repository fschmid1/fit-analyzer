import { db } from "../db.js";

interface UserSettingsRow {
	favorite_models: string;
}

const getStmt = db.prepare<UserSettingsRow, [string]>(
	"SELECT favorite_models FROM user_settings WHERE user_id = ?",
);

const upsertStmt = db.prepare(
	`INSERT INTO user_settings (user_id, favorite_models) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET favorite_models = excluded.favorite_models`,
);

function parseFavorites(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
			return parsed;
		}
		return [];
	} catch {
		return [];
	}
}

export function getFavoriteModels(userId: string): string[] {
	const row = getStmt.get(userId) ?? null;
	return parseFavorites(row?.favorite_models);
}

export function updateFavoriteModels(
	userId: string,
	modelIds: string[],
): string[] {
	upsertStmt.run(userId, JSON.stringify(modelIds));
	return modelIds;
}
