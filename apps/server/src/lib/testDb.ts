import { Database } from "bun:sqlite";

/**
 * Create an in-memory SQLite database with the trainer_chats, trainer_messages,
 * athlete_zones, and profile_changes schema. Used by repo tests so they never
 * touch disk.
 */
export function createTestDb(): Database {
	const database = new Database(":memory:");
	database.exec("PRAGMA foreign_keys = ON");
	database.exec(`
		CREATE TABLE trainer_chats (
			id TEXT PRIMARY KEY,
			activity_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL DEFAULT 'Thread 1',
			coach_model TEXT,
			context_tokens INTEGER,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE trainer_messages (
			id TEXT PRIMARY KEY,
			chat_id TEXT NOT NULL REFERENCES trainer_chats(id) ON DELETE CASCADE,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			tool_calls TEXT
		);
		CREATE INDEX idx_trainer_messages_chat_id
			ON trainer_messages(chat_id);
		CREATE INDEX idx_trainer_messages_chat_created
			ON trainer_messages(chat_id, created_at, id);
		CREATE TABLE athlete_zones (
			user_id TEXT PRIMARY KEY,
			power_zones_override TEXT,
			hr_zones_override TEXT,
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE profile_changes (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			source TEXT NOT NULL,
			changes TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE INDEX idx_profile_changes_user_created
			ON profile_changes(user_id, created_at DESC, id);
	`);
	return database;
}
