import { db } from "../db.js";

export const MAX_COMPARE_THREADS = 4;

export interface CompareSettings {
	compareThreadIds: string[];
	compareEnabled: boolean;
}

const getRowStmt = db.prepare<
	{
		compare_thread_ids: string | null;
		compare_enabled: number | null;
	},
	[string]
>(
	"SELECT compare_thread_ids, compare_enabled FROM user_settings WHERE user_id = ?",
);

const upsertCompareThreadIdsStmt = db.prepare(
	`INSERT INTO user_settings (user_id, compare_thread_ids) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET compare_thread_ids = excluded.compare_thread_ids`,
);

const upsertCompareEnabledStmt = db.prepare(
	`INSERT INTO user_settings (user_id, compare_enabled) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET compare_enabled = excluded.compare_enabled`,
);

function parseThreadIds(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((v): v is string => typeof v === "string");
	} catch {
		return [];
	}
}

function clampAndUnique(ids: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of ids) {
		if (typeof id !== "string") continue;
		if (seen.has(id)) continue;
		seen.add(id);
		result.push(id);
		if (result.length >= MAX_COMPARE_THREADS) break;
	}
	return result;
}

function userOwnsThread(userId: string, threadId: string): boolean {
	const row = db
		.prepare<{ id: string }, [string, string]>(
			"SELECT id FROM trainer_chats WHERE id = ? AND user_id = ?",
		)
		.get(threadId, userId);
	return !!row;
}

export function getCompareSettings(userId: string): CompareSettings {
	const row = getRowStmt.get(userId) ?? null;
	const requested = parseThreadIds(row?.compare_thread_ids);
	const owned = requested.filter((id) => userOwnsThread(userId, id));
	return {
		compareThreadIds: clampAndUnique(owned),
		compareEnabled: !!row?.compare_enabled,
	};
}

export function updateCompareThreadIds(
	userId: string,
	ids: string[],
): CompareSettings {
	const sanitized = clampAndUnique(
		Array.isArray(ids)
			? ids.filter((v): v is string => typeof v === "string")
			: [],
	).filter((id) => userOwnsThread(userId, id));
	upsertCompareThreadIdsStmt.run(userId, JSON.stringify(sanitized));
	return getCompareSettings(userId);
}

export function updateCompareEnabled(
	userId: string,
	enabled: boolean,
): CompareSettings {
	upsertCompareEnabledStmt.run(userId, enabled ? 1 : 0);
	return getCompareSettings(userId);
}
