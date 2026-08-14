import { Database } from "bun:sqlite";

/**
 * Create an in-memory SQLite database with the trainer_chats and
 * trainer_messages schema. Used by repo tests so they never touch disk.
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
	`);
	return database;
}
