import { db } from "../db.js";

/**
 * The per-user notification topic. One topic per user now serves every
 * notification (waxed-chain reminders and Plan refresh), so the field is
 * generic. The legacy waxed-chain-scoped column is still read as a fallback
 * for rows written before the shared column existed.
 */

interface TopicRow {
	ntfy_topic: string;
	waxed_chain_ntfy_topic: string;
}

const getTopicStmt = db.prepare<TopicRow, [string]>(
	`SELECT ntfy_topic, waxed_chain_ntfy_topic
	   FROM user_settings WHERE user_id = ?`,
);

const upsertTopicStmt = db.prepare(
	`INSERT INTO user_settings (user_id, ntfy_topic) VALUES (?, ?)
	   ON CONFLICT(user_id) DO UPDATE SET ntfy_topic = excluded.ntfy_topic`,
);

/** The user's notification topic, or "" when none is configured. */
export function getNtfyTopic(userId: string): string {
	const row = getTopicStmt.get(userId);
	return row?.ntfy_topic || row?.waxed_chain_ntfy_topic || "";
}

export function updateNtfyTopic(userId: string, topic: string): void {
	upsertTopicStmt.run(userId, topic.trim());
}
