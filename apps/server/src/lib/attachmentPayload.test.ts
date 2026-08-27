import { describe, expect, it } from "bun:test";
import type { ModelMessage } from "@tanstack/ai";
import {
	hydrateAttachmentSources,
	stripImageParts,
} from "./attachmentPayload.js";
import { createAttachmentRepo } from "./attachmentRepo.js";
import { createTestDb } from "./testDb.js";
import { toOpenAiMessages } from "./trainerStream.js";
import { toOllamaMessages } from "./ollamaTrainerStream.js";

const SYSTEM = "system prompt";
const USER_A = "user-a";
const ATT_ID = "11111111-1111-1111-1111-111111111111";
const ATT_FOREIGN = "22222222-2222-2222-2222-222222222222";

describe("trainerStream.toOpenAiMessages", () => {
	it("passes plain text messages through unchanged", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "How did my ride look?" },
		];
		const out = toOpenAiMessages(SYSTEM, messages);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({ role: "system", content: SYSTEM });
		expect(out[1]).toEqual({ role: "user", content: "How did my ride look?" });
	});

	it("maps image url parts to image_url content (attachment travel rule)", () => {
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", content: "What's my cadence here?" },
					{
						type: "image",
						source: { type: "url", value: "/api/trainer/attachments/att-1" },
					},
				],
			},
		];
		const out = toOpenAiMessages(SYSTEM, messages);
		expect(out).toHaveLength(2);
		const user = out[1] as { content: Array<Record<string, unknown>> };
		expect(Array.isArray(user.content)).toBe(true);
		expect(user.content[0]).toEqual({
			type: "text",
			text: "What's my cadence here?",
		});
		expect(user.content[1]).toEqual({
			type: "image_url",
			image_url: { url: "/api/trainer/attachments/att-1" },
		});
	});

	it("wraps inline data sources as data URIs", () => {
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "data", value: "QUJD", mimeType: "image/png" },
					},
				],
			},
		];
		const out = toOpenAiMessages(SYSTEM, messages);
		const user = out[1] as { content: Array<Record<string, unknown>> };
		expect(user.content[0]).toEqual({
			type: "image_url",
			image_url: { url: "data:image/png;base64,QUJD" },
		});
	});
});

describe("ollamaTrainerStream.toOllamaMessages", () => {
	it("passes plain text messages through unchanged", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "How did my ride look?" },
		];
		const out = toOllamaMessages(SYSTEM, messages);
		expect(out[1]).toEqual({ role: "user", content: "How did my ride look?" });
	});

	it("maps image parts to a parallel base64 images array", () => {
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", content: "Read this power chart" },
					{
						type: "image",
						source: { type: "data", value: "QUJD", mimeType: "image/jpeg" },
					},
				],
			},
		];
		const out = toOllamaMessages(SYSTEM, messages);
		const user = out[1] as { content: string; images: string[] };
		expect(user.content).toBe("Read this power chart");
		expect(user.images).toEqual(["QUJD"]);
	});

	it("strips data-URI prefixes from url sources", () => {
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: {
							type: "url",
							value: "data:image/jpeg;base64,WFla",
						},
					},
				],
			},
		];
		const out = toOllamaMessages(SYSTEM, messages);
		const user = out[1] as { images: string[] };
		expect(user.images).toEqual(["WFla"]);
	});

	it("keeps an image-only message even without text", () => {
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "data", value: "QUJD", mimeType: "image/jpeg" },
					},
				],
			},
		];
		const out = toOllamaMessages(SYSTEM, messages);
		expect(out).toHaveLength(2);
		const user = out[1] as { content: string; images: string[] };
		expect(user.content).toBe("");
		expect(user.images).toEqual(["QUJD"]);
	});
});

describe("hydrateAttachmentSources", () => {
	function seed() {
		const db = createTestDb();
		const attachments = createAttachmentRepo(db);
		return { db, attachments };
	}

	it("resolves attachment URL refs to inline base64 data sources", () => {
		const { db, attachments } = seed();
		const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		attachments.create({
			id: ATT_ID,
			userId: USER_A,
			kind: "image",
			name: "x.png",
			mediaType: "image/png",
			width: 10,
			height: 10,
			data: pngBytes,
		});

		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", content: "look" },
					{
						type: "image",
						source: {
							type: "url",
							value: `/api/trainer/attachments/${ATT_ID}`,
						},
					},
				],
			},
		];
		const out = hydrateAttachmentSources(messages, db, USER_A);
		const img = (out[0].content as Array<{ type: string; source: unknown }>)[1];
		expect(img.type).toBe("image");
		const source = img.source as {
			type: string;
			value: string;
			mimeType: string;
		};
		expect(source.type).toBe("data");
		expect(source.mimeType).toBe("image/png");
		expect(source.value).toBe(Buffer.from(pngBytes).toString("base64"));
	});

	it("drops image parts whose attachment is missing or foreign", () => {
		const { db, attachments } = seed();
		attachments.create({
			id: ATT_ID,
			userId: USER_A,
			kind: "image",
			name: "m.png",
			mediaType: "image/png",
			width: 10,
			height: 10,
			data: new Uint8Array([1]),
		});

		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", content: "hi" },
					{
						type: "image",
						source: {
							type: "url",
							value: `/api/trainer/attachments/${ATT_ID}`,
						},
					},
					{
						type: "image",
						source: {
							type: "url",
							value: `/api/trainer/attachments/${ATT_FOREIGN}`,
						},
					},
				],
			},
		];
		const out = hydrateAttachmentSources(messages, db, USER_A);
		const parts = out[0].content as Array<{ type: string }>;
		expect(parts).toHaveLength(2);
		expect(parts[0].type).toBe("text");
		expect(parts[1].type).toBe("image");
		const source = (parts[1] as unknown as { source: { type: string } }).source;
		expect(source.type).toBe("data");
	});

	it("leaves messages without image parts unchanged in content", () => {
		const { db } = seed();
		const messages: ModelMessage[] = [{ role: "user", content: "plain" }];
		const out = hydrateAttachmentSources(messages, db, USER_A);
		expect(out).toEqual(messages);
	});
});

describe("stripImageParts", () => {
	it("removes image parts from multimodal messages", () => {
		const messages: ModelMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", content: "look" },
					{
						type: "image",
						source: { type: "url", value: "/api/trainer/attachments/x" },
					},
				],
			},
			{ role: "assistant", content: "reply" },
		];
		const out = stripImageParts(messages);
		const userContent = out[0].content as Array<{ type: string }>;
		expect(userContent).toHaveLength(1);
		expect(userContent[0].type).toBe("text");
		// Plain assistant message has no image parts.
		expect(out[1]).toEqual(messages[1]);
	});

	it("leaves text-only messages unchanged", () => {
		const messages: ModelMessage[] = [{ role: "user", content: "hi" }];
		expect(stripImageParts(messages)).toEqual(messages);
	});
});
