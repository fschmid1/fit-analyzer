import type {
	TrainerAttachmentRef,
	TrainerMessage,
	UIToolCall,
} from "@fit-analyzer/shared";
import type { Database } from "bun:sqlite";
import { db } from "../db.js";
import {
	createAttachmentRepo,
	parseAttachmentRefs,
	serializeAttachmentRefs,
} from "./attachmentRepo.js";

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface MessageRow {
	id: string;
	role: string;
	content: string;
	createdAt: string;
	toolCalls: unknown;
	attachments: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseToolCalls(raw: unknown): UIToolCall[] | undefined {
	if (raw == null || raw === "") return undefined;
	if (typeof raw !== "string") return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return undefined;
		return parsed as UIToolCall[];
	} catch {
		return undefined;
	}
}

export function serializeToolCalls(
	toolCalls: UIToolCall[] | undefined,
): string | null {
	if (!toolCalls || toolCalls.length === 0) return null;
	return JSON.stringify(toolCalls);
}

export { serializeAttachmentRefs };

function rowToTrainerMessage(row: MessageRow): TrainerMessage {
	const msg: TrainerMessage = {
		id: row.id,
		role: row.role as "user" | "assistant",
		content: row.content,
		createdAt: row.createdAt,
	};
	const toolCalls = parseToolCalls(row.toolCalls);
	if (toolCalls && toolCalls.length > 0) {
		msg.toolCalls = toolCalls;
	}
	const attachments = parseAttachmentRefs(row.attachments);
	if (attachments && attachments.length > 0) {
		msg.attachments = attachments;
	}
	return msg;
}

// ─── Pagination result ────────────────────────────────────────────────────────

export interface MessagePage {
	/** Ascending messages (oldest → newest) ready for chat rendering. */
	messages: TrainerMessage[];
	/** Cursor for the next (older) page; `null` when no more history exists. */
	nextCursor: string | null;
	/** True when there are older messages available beyond `messages`. */
	hasMore: boolean;
	/** Total number of messages persisted for the thread. */
	total: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type MessageRepo = ReturnType<typeof createMessageRepo>;

/**
 * Create a message repository bound to a specific SQLite database.
 * Production code uses the shared `db` singleton (see `messageRepo` below);
 * tests pass an in-memory database so they never touch disk.
 */
export function createMessageRepo(database: Database) {
	const getAllStmt = database.prepare(
		`SELECT id, role, content, created_at as createdAt, tool_calls as toolCalls, attachments
	      FROM trainer_messages
	      WHERE chat_id = ?
	      ORDER BY created_at ASC, id ASC`,
	);

	const getPageStmt = database.prepare(
		`SELECT id, role, content, created_at as createdAt, tool_calls as toolCalls, attachments
	      FROM trainer_messages
	      WHERE chat_id = ?
	        AND (created_at < ? OR (created_at = ? AND id < ?))
	      ORDER BY created_at DESC, id DESC
	      LIMIT ?`,
	);

	const getLatestStmt = database.prepare(
		`SELECT id, role, content, created_at as createdAt, tool_calls as toolCalls, attachments
	      FROM trainer_messages
	      WHERE chat_id = ?
	      ORDER BY created_at DESC, id DESC
	      LIMIT ?`,
	);

	const countStmt = database.prepare(
		"SELECT COUNT(*) as c FROM trainer_messages WHERE chat_id = ?",
	);

	const deleteAllStmt = database.prepare(
		"DELETE FROM trainer_messages WHERE chat_id = ?",
	);

	const insertStmt = database.prepare(
		`INSERT INTO trainer_messages (id, chat_id, role, content, created_at, tool_calls, attachments)
	      VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);

	// Bump the parent thread's updated_at inside the replace transaction.
	// Kept here (rather than calling threadRepo.touch) so the replace stays a
	// single self-contained transaction without cross-repo coupling.
	const touchThreadStmt = database.prepare(
		`UPDATE trainer_chats SET updated_at = datetime('now') WHERE id = ?`,
	);

	return {
		/** All messages for a thread, ascending (oldest → newest). */
		getAll(threadId: string): TrainerMessage[] {
			return (getAllStmt.all(threadId) as MessageRow[]).map(
				rowToTrainerMessage,
			);
		},

		/**
		 * One page of messages, newest-first internally then flipped to
		 * ascending for rendering. Accepts an optional `cursor` of the form
		 * `createdAt|id` returned from a previous page.
		 */
		getPage(
			threadId: string,
			cursor: string | null,
			limit: number,
		): MessagePage {
			let page: MessageRow[];
			if (cursor) {
				const sep = cursor.indexOf("|");
				const cursorCreatedAt = sep === -1 ? cursor : cursor.slice(0, sep);
				const cursorId = sep === -1 ? "" : cursor.slice(sep + 1);
				// SQLite returns UTC ISO strings; keep as-is for the comparison.
				page = getPageStmt.all(
					threadId,
					cursorCreatedAt,
					cursorCreatedAt,
					cursorId,
					limit + 1,
				) as MessageRow[];
			} else {
				page = getLatestStmt.all(threadId, limit + 1) as MessageRow[];
			}

			const hasMore = page.length > limit;
			const trimmed = hasMore ? page.slice(0, limit) : page;
			// We pulled most-recent-first; flip back to ascending so the chat
			// renders oldest → newest.
			const messages = trimmed.reverse().map(rowToTrainerMessage);

			let nextCursor: string | null = null;
			if (hasMore) {
				const oldest = trimmed[0];
				nextCursor = `${oldest.createdAt}|${oldest.id}`;
			}

			const { c: total } = countStmt.get(threadId) as { c: number };

			return { messages, nextCursor, hasMore, total };
		},

		/**
		 * Replace all messages for a thread with `messages` in a single
		 * transaction: deletes existing rows, bumps the thread's `updated_at`,
		 * inserts the new rows, then runs attachment GC so blobs whose last
		 * reference disappeared are removed in the same commit.
		 */
		replaceAll(threadId: string, messages: TrainerMessage[]): void {
			const attachments = createAttachmentRepo(database);
			database.transaction(() => {
				deleteAllStmt.run(threadId);
				touchThreadStmt.run(threadId);
				for (const m of messages) {
					insertStmt.run(
						m.id,
						threadId,
						m.role,
						m.content,
						m.createdAt,
						serializeToolCalls(m.toolCalls),
						serializeAttachmentRefs(m.attachments),
					);
				}
				attachments.deleteUnreferenced();
			})();
		},

		/**
		 * Insert many messages for a thread in a single transaction. Used by
		 * compaction forks and imports where the thread row is created
		 * separately by the caller. Does not run GC: the fork shares blob
		 * rows with the source thread by reference.
		 */
		insertMany(threadId: string, messages: TrainerMessage[]): void {
			database.transaction(() => {
				for (const m of messages) {
					insertStmt.run(
						m.id,
						threadId,
						m.role,
						m.content,
						m.createdAt,
						serializeToolCalls(m.toolCalls),
						serializeAttachmentRefs(m.attachments),
					);
				}
			})();
		},

		/** Delete all messages for a thread (e.g. before a full replace). */
		deleteAll(threadId: string): void {
			deleteAllStmt.run(threadId);
		},

		/** Count messages for a thread. */
		count(threadId: string): number {
			const { c } = countStmt.get(threadId) as { c: number };
			return c;
		},
	};
}

// ─── Default singleton instance ───────────────────────────────────────────────

/**
 * SQLite repository for trainer messages (`trainer_messages`), bound to the
 * shared `db` singleton. Owns all message reads, pagination, and
 * full-replace writes. The route handler deals only in `TrainerMessage`
 * objects and cursor strings.
 */
export const messageRepo = createMessageRepo(db);
