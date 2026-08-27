import type { TrainerAttachment } from "@fit-analyzer/shared";
import { Hono } from "hono";
import { attachmentRepo } from "../lib/attachmentRepo.js";
import { getUserId } from "../lib/getUserId.js";

// Hard server-side backstop for attachment uploads. Clients pre-process
// images (~1600px JPEG ≈ a few hundred KB), so anything near this cap is
// either a mis-picked video or an abusive payload — reject, don't store.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
]);

const attachments = new Hono();

attachments.post("/", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized — missing x-authentik-username header" },
			401,
		);
	}

	const body = await c.req.parseBody();
	const file = body.file;

	if (!file || typeof file === "string") {
		return c.json({ error: "No file uploaded" }, 400);
	}

	const mediaType = file.type;
	if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
		return c.json(
			{ error: `Unsupported media type: ${mediaType || "unknown"}` },
			415,
		);
	}
	if (file.size > MAX_ATTACHMENT_BYTES) {
		return c.json({ error: "File too large (max 10MB)" }, 413);
	}

	let width = 0;
	let height = 0;
	const rawWidth = body.width;
	const rawHeight = body.height;
	if (typeof rawWidth === "string" && typeof rawHeight === "string") {
		const w = Number.parseInt(rawWidth, 10);
		const h = Number.parseInt(rawHeight, 10);
		if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
			width = Math.min(w, 100_000);
			height = Math.min(h, 100_000);
		}
	}

	const data = new Uint8Array(await file.arrayBuffer());

	// When the client couldn't decode dimensions (rare: undecodable image that
	// still passed the media-type check), extract them server-side.
	if (width === 0 || height === 0) {
		const dims = probeImageDimensions(data);
		width = dims.width;
		height = dims.height;
	}
	if (width === 0 || height === 0) {
		return c.json({ error: "Could not determine image dimensions" }, 400);
	}

	const id = crypto.randomUUID();
	const stored = attachmentRepo.create({
		id,
		userId,
		kind: "image",
		name: file.name || "image",
		mediaType,
		width,
		height,
		data,
	});

	const ref: TrainerAttachment = {
		id: stored.id,
		kind: "image",
		name: stored.name,
		bytes: stored.bytes,
		width: stored.width,
		height: stored.height,
		mediaType: stored.mediaType,
	};
	return c.json({ attachment: ref }, 201);
});

attachments.get("/:id", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized — missing x-authentik-username header" },
			401,
		);
	}

	const { id } = c.req.param();
	const row = attachmentRepo.getById(id, userId);
	if (!row) return c.json({ error: "Attachment not found" }, 404);

	// Attachment bytes are immutable — safe to cache hard.
	return new Response(new Uint8Array(row.data), {
		headers: {
			"Content-Type": row.mediaType,
			"Cache-Control": "private, max-age=31536000, immutable",
			"Content-Length": String(row.bytes),
		},
	});
});

/**
 * Extract pixel dimensions from an image buffer without decoding it fully.
 * Supports JPEG (SOF markers), PNG (IHDR), GIF, and WebP (VP8/VP8L/VP8X).
 * Returns 0×0 when the format can't be parsed — the route rejects those.
 */
function probeImageDimensions(data: Uint8Array): {
	width: number;
	height: number;
} {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	// PNG: 8-byte signature, then IHDR chunk with width/height at offsets 16/20.
	if (
		data.length > 24 &&
		view.getUint32(0) === 0x89504e47 &&
		view.getUint32(4) === 0x0d0a1a0a
	) {
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}

	// GIF: 6-byte signature, little-endian width/height at offsets 6/8.
	if (data.length > 10 && view.getUint32(0) === 0x47494638) {
		return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
	}

	// WebP: "RIFF" + size + "WEBP", then chunk-specific headers.
	if (
		data.length > 30 &&
		view.getUint32(0) === 0x52494646 &&
		view.getUint32(8) === 0x57454250
	) {
		const format = view.getUint32(12);
		// VP8 (lossy): dimensions at offset 26, 14-bit each.
		if (format === 0x56503820 && data.length > 30) {
			return {
				width: view.getUint16(26, true) & 0x3fff,
				height: view.getUint16(28, true) & 0x3fff,
			};
		}
		// VP8L (lossless): 14-bit width-1 / height-1 packed at offset 21.
		if (format === 0x5650384c && data.length > 25) {
			const bits = view.getUint32(21, true);
			return {
				width: (bits & 0x3fff) + 1,
				height: ((bits >> 14) & 0x3fff) + 1,
			};
		}
		// VP8X (extended): 24-bit width-1 / height-1 at offsets 24/25.
		if (format === 0x56503858 && data.length > 30) {
			const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
			const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
			return { width, height };
		}
	}

	// JPEG: scan segment markers for the first SOFn frame header.
	if (data.length > 4 && view.getUint16(0) === 0xffd8) {
		let offset = 2;
		while (offset + 9 < data.length) {
			if (view.getUint8(offset) !== 0xff) break;
			const marker = view.getUint8(offset + 1);
			// Standalone markers without length payload.
			if (
				marker === 0xd8 ||
				marker === 0x01 ||
				(marker >= 0xd0 && marker <= 0xd7)
			) {
				offset += 2;
				continue;
			}
			const length = view.getUint16(offset + 2);
			// SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC).
			if (
				marker >= 0xc0 &&
				marker <= 0xcf &&
				marker !== 0xc4 &&
				marker !== 0xc8 &&
				marker !== 0xcc
			) {
				return {
					height: view.getUint16(offset + 5),
					width: view.getUint16(offset + 7),
				};
			}
			offset += 2 + length;
		}
	}

	return { width: 0, height: 0 };
}

export { attachments };
