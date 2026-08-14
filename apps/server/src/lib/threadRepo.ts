import type { TrainerThread } from "@fit-analyzer/shared";
import { APPROX_CHARS_PER_TOKEN } from "@fit-analyzer/shared";
import type { Database } from "bun:sqlite";
import { db } from "../db.js";

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface ThreadRow {
	id: string;
	name: string;
	activityId: string;
	coachModel: string | null;
	contextTokens: number | null;
	createdAt: string;
	updatedAt: string;
}

interface ThreadListRow {
	id: string;
	name: string;
	activityId: string;
	coachModel: string | null;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	contextTokens: number | null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type ThreadRepo = ReturnType<typeof createThreadRepo>;

/**
 * Create a thread repository bound to a specific SQLite database. Production
 * code uses the shared `db` singleton (see `threadRepo` below); tests pass
 * an in-memory database so they never touch disk.
 */
export function createThreadRepo(database: Database) {
	const listByActivityStmt = database.prepare(
		`SELECT c.id, c.name, c.activity_id as activityId, c.coach_model as coachModel,
	            c.created_at as createdAt, c.updated_at as updatedAt,
	            COUNT(m.id) as messageCount,
	            COALESCE(c.context_tokens, SUM(LENGTH(m.content)) / ${APPROX_CHARS_PER_TOKEN}, 0) as contextTokens
	      FROM trainer_chats c
	      LEFT JOIN trainer_messages m ON m.chat_id = c.id
	      WHERE c.user_id = ? AND c.activity_id = ?
	      GROUP BY c.id
	      ORDER BY c.created_at ASC`,
	);

	const getByIdStmt = database.prepare(
		`SELECT id, name, activity_id as activityId, coach_model as coachModel,
	            context_tokens as contextTokens, created_at as createdAt, updated_at as updatedAt
	      FROM trainer_chats
	      WHERE id = ? AND user_id = ?`,
	);

	const createStmt = database.prepare(
		`INSERT INTO trainer_chats (id, activity_id, user_id, name, coach_model, created_at, updated_at)
	      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
	);

	const renameStmt = database.prepare(
		`UPDATE trainer_chats SET name = ?, updated_at = datetime('now')
	      WHERE id = ? AND user_id = ?`,
	);

	const updateModelStmt = database.prepare(
		`UPDATE trainer_chats SET coach_model = ?, updated_at = datetime('now')
	      WHERE id = ? AND user_id = ?`,
	);

	const updateContextTokensStmt = database.prepare(
		`UPDATE trainer_chats SET context_tokens = ?, updated_at = datetime('now')
	      WHERE id = ? AND user_id = ?`,
	);

	const deleteStmt = database.prepare(
		"DELETE FROM trainer_chats WHERE id = ? AND user_id = ?",
	);

	const deleteMessagesStmt = database.prepare(
		"DELETE FROM trainer_messages WHERE chat_id = ?",
	);

	const touchStmt = database.prepare(
		`UPDATE trainer_chats SET updated_at = datetime('now') WHERE id = ?`,
	);

	function toThread(row: ThreadRow): TrainerThread {
		return {
			id: row.id,
			name: row.name,
			activityId: row.activityId,
			coachModel: row.coachModel,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			messageCount: 0,
			contextTokens: Math.ceil(row.contextTokens ?? 0),
		};
	}

	return {
		/** List all threads for a user+activity, with live message counts and context tokens. */
		listByActivity(userId: string, activityId: string): TrainerThread[] {
			return (
				listByActivityStmt.all(userId, activityId) as ThreadListRow[]
			).map((t) => ({
				id: t.id,
				name: t.name,
				activityId: t.activityId,
				coachModel: t.coachModel,
				createdAt: t.createdAt,
				updatedAt: t.updatedAt,
				messageCount: t.messageCount ?? 0,
				contextTokens: Math.ceil(t.contextTokens ?? 0),
			}));
		},

		/** Fetch a single thread, or `null` if it does not exist / belongs to another user. */
		getById(userId: string, threadId: string): TrainerThread | null {
			const row = getByIdStmt.get(threadId, userId) as ThreadRow | undefined;
			return row ? toThread(row) : null;
		},

		/** Create a new thread and return the persisted row. */
		create(
			userId: string,
			activityId: string,
			name: string,
			coachModel: string | null,
		): TrainerThread {
			const threadId = crypto.randomUUID();
			createStmt.run(threadId, activityId, userId, name, coachModel);
			const row = getByIdStmt.get(threadId, userId) as ThreadRow;
			return toThread(row);
		},

		/** Insert a thread with a caller-supplied id (used for forks and imports). */
		insertWithId(
			threadId: string,
			userId: string,
			activityId: string,
			name: string,
			coachModel: string | null,
		): void {
			createStmt.run(threadId, activityId, userId, name, coachModel);
		},

		/** Rename a thread. No-op if the thread does not exist. */
		rename(userId: string, threadId: string, name: string): void {
			renameStmt.run(name, threadId, userId);
		},

		/** Update the coach model for a thread. */
		updateModel(
			userId: string,
			threadId: string,
			coachModel: string | null,
		): void {
			updateModelStmt.run(coachModel, threadId, userId);
		},

		/** Persist the client-computed context-token count for a thread. */
		updateContextTokens(
			userId: string,
			threadId: string,
			tokens: number,
		): void {
			updateContextTokensStmt.run(tokens, threadId, userId);
		},

		/** Bump `updated_at` without changing other columns (used after imports). */
		touch(threadId: string): void {
			touchStmt.run(threadId);
		},

		/** Delete a thread and all of its messages, in a transaction. */
		delete(userId: string, threadId: string): void {
			database.transaction(() => {
				deleteMessagesStmt.run(threadId);
				deleteStmt.run(threadId, userId);
			})();
		},

		/**
		 * Run `fn` inside a single SQLite transaction. Exposed so callers
		 * can compose atomically across repos that share the same database
		 * (e.g. create a thread and seed its messages in one transaction).
		 */
		transaction<T>(fn: () => T): T {
			return database.transaction(fn)();
		},
	};
}

// ─── Default singleton instance ───────────────────────────────────────────────

/**
 * SQLite repository for trainer threads (`trainer_chats`), bound to the
 * shared `db` singleton. Owns all thread CRUD plus the message-delete side
 * of thread deletion so the route handler never prepares SQL. Methods are
 * keyed by `userId` so a thread can never leak across users.
 */
export const threadRepo = createThreadRepo(db);
