import type { TrainerAttachmentRef } from "@fit-analyzer/shared";
import type { Database } from "bun:sqlite";
import { db } from "../db.js";

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface AttachmentRow {
	id: string;
	userId: string;
	kind: string;
	name: string;
	mediaType: string;
	bytes: number;
	width: number;
	height: number;
	data: Uint8Array;
	createdAt: string;
}

export interface AttachmentMeta {
	id: string;
	kind: string;
	name: string;
	mediaType: string;
	bytes: number;
	width: number;
	height: number;
	createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAttachmentRefs(raw: unknown): TrainerAttachmentRef[] | undefined {
	if (raw == null || raw === "") return undefined;
	if (typeof raw !== "string") return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return undefined;
		return parsed as TrainerAttachmentRef[];
	} catch {
		return undefined;
	}
}

export { parseAttachmentRefs };

export function serializeAttachmentRefs(
	refs: TrainerAttachmentRef[] | undefined,
): string | null {
	if (!refs || refs.length === 0) return null;
	return JSON.stringify(refs);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type AttachmentRepo = ReturnType<typeof createAttachmentRepo>;

/**
 * Create an attachment repository bound to a specific SQLite database.
 * Production code uses the shared `db` singleton (see `attachmentRepo` below);
 * tests pass an in-memory database so they never touch disk.
 *
 * Owns attachment storage (bytes + metadata), ref parsing, and the
 * unreferenced-blob GC that runs inside history-replace transactions
 * (see apps/server/CONTEXT.md — "Attachment GC").
 */
export function createAttachmentRepo(database: Database) {
	const insertStmt = database.prepare(
		`INSERT INTO trainer_attachments (id, user_id, kind, name, media_type, bytes, width, height, data)
	     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);

	const getByIdStmt = database.prepare(
		`SELECT id, user_id as userId, kind, name, media_type as mediaType,
	            bytes, width, height, data, created_at as createdAt
	     FROM trainer_attachments WHERE id = ? AND user_id = ?`,
	);

	const deleteByIdStmt = database.prepare(
		"DELETE FROM trainer_attachments WHERE id = ?",
	);

	const countByIdStmt = database.prepare(
		"SELECT COUNT(*) as c FROM trainer_attachments WHERE id = ?",
	);

	return {
		/** Store a new attachment (bytes + metadata). Returns the metadata row. */
		create(input: {
			id: string;
			userId: string;
			kind: string;
			name: string;
			mediaType: string;
			width: number;
			height: number;
			data: Uint8Array;
		}): AttachmentMeta {
			insertStmt.run(
				input.id,
				input.userId,
				input.kind,
				input.name,
				input.mediaType,
				input.data.byteLength,
				input.width,
				input.height,
				input.data,
			);
			return {
				id: input.id,
				kind: input.kind,
				name: input.name,
				mediaType: input.mediaType,
				bytes: input.data.byteLength,
				width: input.width,
				height: input.height,
				createdAt: new Date().toISOString(),
			};
		},

		/** Fetch one attachment owned by `userId`, or null if missing/foreign. */
		getById(id: string, userId: string): AttachmentRow | null {
			const row = getByIdStmt.get(id, userId) as AttachmentRow | undefined;
			return row ?? null;
		},

		/**
		 * Attachment GC (see apps/server/CONTEXT.md): delete attachment rows that
		 * no message references anymore. Scans all trainer_messages ref lists,
		 * so it must run in the same transaction as the history replace.
		 */
		deleteUnreferenced(): void {
			const allIds = database
				.prepare("SELECT id FROM trainer_attachments")
				.all() as Array<{ id: string }>;
			if (allIds.length === 0) return;

			const rows = database
				.prepare(
					"SELECT attachments FROM trainer_messages WHERE attachments IS NOT NULL AND attachments != ''",
				)
				.all() as Array<{ attachments: string }>;

			const referenced = new Set<string>();
			for (const row of rows) {
				const refs = parseAttachmentRefs(row.attachments);
				if (!refs) continue;
				for (const ref of refs) {
					if (ref && typeof ref.id === "string") referenced.add(ref.id);
				}
			}

			for (const { id } of allIds) {
				if (!referenced.has(id)) deleteByIdStmt.run(id);
			}
		},

		/** True when an attachment with this id exists (any owner). */
		exists(id: string): boolean {
			const { c } = countByIdStmt.get(id) as { c: number };
			return c > 0;
		},
	};
}

// ─── Default singleton instance ───────────────────────────────────────────────

/**
 * SQLite repository for trainer chat attachments (`trainer_attachments`),
 * bound to the shared `db` singleton.
 */
export const attachmentRepo = createAttachmentRepo(db);
