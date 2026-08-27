import { createAttachmentRepo } from "./attachmentRepo.js";
import { createMessageRepo } from "./messageRepo.js";
import { createThreadRepo } from "./threadRepo.js";
import { createTestDb } from "./testDb.js";
import type {
	TrainerAttachmentRef,
	TrainerMessage,
} from "@fit-analyzer/shared";
import { describe, expect, it } from "bun:test";

const USER_A = "user-a";
const ACTIVITY_1 = "act-1";

function makeRef(id: string): TrainerAttachmentRef {
	return {
		id,
		kind: "image",
		name: "photo.jpg",
		bytes: 1024,
		width: 800,
		height: 600,
		mediaType: "image/jpeg",
	};
}

function makeMessage(
	role: "user" | "assistant",
	content: string,
	createdAt: string,
	attachments?: TrainerAttachmentRef[],
): TrainerMessage {
	const msg: TrainerMessage = {
		id: crypto.randomUUID(),
		role,
		content,
		createdAt,
	};
	if (attachments && attachments.length > 0) msg.attachments = attachments;
	return msg;
}

function seed(): {
	threadId: string;
	messages: ReturnType<typeof createMessageRepo>;
	attachments: ReturnType<typeof createAttachmentRepo>;
	threads: ReturnType<typeof createThreadRepo>;
} {
	const db = createTestDb();
	const threads = createThreadRepo(db);
	const messages = createMessageRepo(db);
	const attachments = createAttachmentRepo(db);
	const thread = threads.create(USER_A, ACTIVITY_1, "T", null);
	return { threadId: thread.id, messages, attachments, threads };
}

describe("attachmentRepo", () => {
	it("stores and retrieves attachment bytes scoped to owner", () => {
		const { attachments } = seed();
		const data = new Uint8Array([1, 2, 3, 4]);
		attachments.create({
			id: "att-1",
			userId: USER_A,
			kind: "image",
			name: "photo.jpg",
			mediaType: "image/jpeg",
			width: 800,
			height: 600,
			data,
		});

		const row = attachments.getById("att-1", USER_A);
		expect(row).not.toBeNull();
		expect(row?.bytes).toBe(4);
		expect(Array.from(row?.data ?? [])).toEqual([1, 2, 3, 4]);

		// Another user cannot read it
		expect(attachments.getById("att-1", "user-b")).toBeNull();
	});

	it("GC deletes attachments with zero references after replaceAll", () => {
		const { threadId, messages, attachments } = seed();

		attachments.create({
			id: "att-keep",
			userId: USER_A,
			kind: "image",
			name: "keep.jpg",
			mediaType: "image/jpeg",
			width: 10,
			height: 10,
			data: new Uint8Array([1]),
		});
		attachments.create({
			id: "att-orphan",
			userId: USER_A,
			kind: "image",
			name: "orphan.jpg",
			mediaType: "image/jpeg",
			width: 10,
			height: 10,
			data: new Uint8Array([2]),
		});

		messages.replaceAll(threadId, [
			makeMessage("user", "see this", "2025-01-01T00:00:00.000Z", [
				makeRef("att-keep"),
			]),
		]);

		expect(attachments.getById("att-keep", USER_A)).not.toBeNull();
		// Never referenced → GC'd by the replaceAll transaction
		expect(attachments.getById("att-orphan", USER_A)).toBeNull();
	});

	it("GC keeps blobs referenced by other threads (fork shares by reference)", () => {
		const { threadId, threads, messages, attachments } = seed();

		attachments.create({
			id: "att-shared",
			userId: USER_A,
			kind: "image",
			name: "shared.jpg",
			mediaType: "image/jpeg",
			width: 10,
			height: 10,
			data: new Uint8Array([1]),
		});

		// Fork: new thread sharing the blob by reference.
		const forkId = crypto.randomUUID();
		threads.insertWithId(forkId, USER_A, ACTIVITY_1, "Fork", null);
		messages.insertMany(forkId, [
			makeMessage("user", "fork copy", "2025-01-01T00:00:00.000Z", [
				makeRef("att-shared"),
			]),
		]);

		// Source thread replaces its history without the ref; the fork still
		// references the blob, so GC must keep it.
		messages.replaceAll(threadId, [
			makeMessage("user", "no refs here", "2025-01-01T00:00:00.000Z"),
		]);

		expect(attachments.getById("att-shared", USER_A)).not.toBeNull();
	});

	it("GC covers uploads that were never sent", () => {
		const { threadId, messages, attachments } = seed();

		attachments.create({
			id: "att-unsent",
			userId: USER_A,
			kind: "image",
			name: "unsent.jpg",
			mediaType: "image/jpeg",
			width: 10,
			height: 10,
			data: new Uint8Array([1]),
		});
		messages.replaceAll(threadId, [
			makeMessage("user", "text only", "2025-01-01T00:00:00.000Z"),
		]);

		expect(attachments.getById("att-unsent", USER_A)).toBeNull();
	});
});
