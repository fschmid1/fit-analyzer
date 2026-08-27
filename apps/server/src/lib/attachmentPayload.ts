import type { ModelMessage } from "@tanstack/ai";
import type { Database } from "bun:sqlite";

// Pattern matches "/api/trainer/attachments/<uuid>" regardless of host —
// the client sends relative URLs, so anchor on the pathname.
const ATTACHMENT_URL_RE = /^\/api\/trainer\/attachments\/([0-9a-fA-F-]{36})$/;

function attachmentIdFromSource(
	source: { type: string; value: string } | undefined,
): string | null {
	if (!source || source.type !== "url" || !source.value) return null;
	try {
		const url = new URL(source.value, "http://local.invalid");
		const match = ATTACHMENT_URL_RE.exec(url.pathname);
		return match ? match[1] : null;
	} catch {
		const match = ATTACHMENT_URL_RE.exec(source.value);
		return match ? match[1] : null;
	}
}

function hasImageParts(messages: ModelMessage[]): boolean {
	for (const m of messages) {
		if (!Array.isArray(m.content)) continue;
		for (const part of m.content) {
			if (part.type === "image") return true;
		}
	}
	return false;
}

/**
 * Strip image parts from messages whose content is an array. Used when the
 * model is known text-only: the user still sees the images (persisted refs
 * + chip), but the provider never receives them.
 */
export function stripImageParts(messages: ModelMessage[]): ModelMessage[] {
	return messages.map((m) => {
		if (!Array.isArray(m.content)) return m;
		const next = m.content.filter((part) => part.type !== "image");
		if (next.length === m.content.length) return m;
		return { ...m, content: next };
	});
}

/**
 * Resolve `/api/trainer/attachments/:id` URL sources into inline base64 data
 * sources so providers actually receive the bytes (they can't reach the
 * auth-gated attachment endpoint). Foreign/missing attachments are dropped.
 */
export function hydrateAttachmentSources(
	messages: ModelMessage[],
	database: Database,
	userId: string,
): ModelMessage[] {
	if (!hasImageParts(messages)) return messages;

	const getStmt = database.prepare(
		"SELECT data, media_type FROM trainer_attachments WHERE id = ? AND user_id = ?",
	);

	const resolved = messages.map((m): ModelMessage => {
		if (!Array.isArray(m.content)) return m;

		let changed = false;
		const nextParts: unknown[] = [];
		for (const part of m.content) {
			if (part.type !== "image") {
				nextParts.push(part);
				continue;
			}
			const imagePart = part as {
				type: string;
				source?: { type: string; value: string; mimeType?: string };
			};
			const id = attachmentIdFromSource(imagePart.source);
			if (!id) {
				// Already a data source or an external URL — leave as-is.
				nextParts.push(part);
				continue;
			}
			const row = getStmt.get(id, userId) as
				| { data: Uint8Array; media_type: string }
				| undefined;
			if (!row) {
				changed = true;
				continue;
			}
			changed = true;
			const base64 = Buffer.from(row.data).toString("base64");
			nextParts.push({
				...part,
				source: {
					type: "data" as const,
					value: base64,
					mimeType: row.media_type,
				},
			});
		}

		if (!changed) return m;
		return { ...m, content: nextParts as ModelMessage["content"] };
	});

	return resolved;
}
