import { createMessageRepo } from "./messageRepo.js";
import { createThreadRepo } from "./threadRepo.js";
import { createTestDb } from "./testDb.js";
import type { TrainerMessage, UIToolCall } from "@fit-analyzer/shared";
import { describe, expect, it } from "bun:test";

const USER_A = "user-a";
const ACTIVITY_1 = "act-1";

function makeMessage(
	role: "user" | "assistant",
	content: string,
	createdAt: string,
	id?: string,
): TrainerMessage {
	return { id: id ?? crypto.randomUUID(), role, content, createdAt };
}

function makeToolCall(name: string): UIToolCall {
	return {
		id: crypto.randomUUID(),
		name,
		arguments: { foo: "bar" },
		status: "done",
		result: {
			id: crypto.randomUUID(),
			name,
			content: "result-content",
			display: null,
		},
	};
}

function seedThread(): {
	db: ReturnType<typeof createTestDb>;
	threadId: string;
	messages: ReturnType<typeof createMessageRepo>;
	threads: ReturnType<typeof createThreadRepo>;
} {
	const db = createTestDb();
	const threads = createThreadRepo(db);
	const messages = createMessageRepo(db);
	const thread = threads.create(USER_A, ACTIVITY_1, "T", null);
	return { db, threadId: thread.id, messages, threads };
}

describe("messageRepo", () => {
	describe("insertMany + getAll", () => {
		it("inserts and retrieves all messages in ascending order", () => {
			const { threadId, messages } = seedThread();

			const inserted = [
				makeMessage("user", "hello", "2025-01-01T00:00:00.000Z"),
				makeMessage("assistant", "hi there", "2025-01-01T00:00:01.000Z"),
				makeMessage("user", "how are you", "2025-01-01T00:00:02.000Z"),
			];
			messages.insertMany(threadId, inserted);

			const all = messages.getAll(threadId);
			expect(all).toHaveLength(3);
			expect(all[0].content).toBe("hello");
			expect(all[2].content).toBe("how are you");
		});

		it("preserves tool calls through insert and retrieve", () => {
			const { threadId, messages } = seedThread();

			const tc = makeToolCall("zone_analysis");
			messages.insertMany(threadId, [
				{
					id: "msg-tc",
					role: "assistant",
					content: "calling tool",
					createdAt: "2025-01-01T00:00:00.000Z",
					toolCalls: [tc],
				},
			]);

			const all = messages.getAll(threadId);
			expect(all).toHaveLength(1);
			expect(all[0].toolCalls).toHaveLength(1);
			expect(all[0].toolCalls?.[0].name).toBe("zone_analysis");
			expect(all[0].toolCalls?.[0].arguments).toEqual({ foo: "bar" });
		});
	});

	describe("getPage", () => {
		it("returns the latest page when no cursor is given", () => {
			const { threadId, messages } = seedThread();

			const msgs: TrainerMessage[] = [];
			for (let i = 0; i < 25; i++) {
				msgs.push(
					makeMessage(
						i % 2 === 0 ? "user" : "assistant",
						`msg ${i}`,
						new Date(2025, 0, 1, 0, 0, i).toISOString(),
					),
				);
			}
			messages.insertMany(threadId, msgs);

			const page = messages.getPage(threadId, null, 10);
			expect(page.messages).toHaveLength(10);
			expect(page.hasMore).toBe(true);
			expect(page.total).toBe(25);
			// Ascending order — oldest of the page first
			expect(page.messages[0].content).toBe("msg 15");
			expect(page.messages[9].content).toBe("msg 24");
		});

		it("returns an older page when a cursor is given", () => {
			const { threadId, messages } = seedThread();

			const msgs: TrainerMessage[] = [];
			for (let i = 0; i < 25; i++) {
				msgs.push(
					makeMessage(
						i % 2 === 0 ? "user" : "assistant",
						`msg ${i}`,
						new Date(2025, 0, 1, 0, 0, i).toISOString(),
					),
				);
			}
			messages.insertMany(threadId, msgs);

			const firstPage = messages.getPage(threadId, null, 10);
			expect(firstPage.nextCursor).not.toBeNull();

			const secondPage = messages.getPage(threadId, firstPage.nextCursor, 10);
			expect(secondPage.messages).toHaveLength(10);
			expect(secondPage.hasMore).toBe(true);
			expect(secondPage.messages[0].content).toBe("msg 5");
			expect(secondPage.messages[9].content).toBe("msg 14");
		});

		it("returns the last page with hasMore=false", () => {
			const { threadId, messages } = seedThread();

			const msgs: TrainerMessage[] = [];
			for (let i = 0; i < 5; i++) {
				msgs.push(
					makeMessage(
						i % 2 === 0 ? "user" : "assistant",
						`msg ${i}`,
						new Date(2025, 0, 1, 0, 0, i).toISOString(),
					),
				);
			}
			messages.insertMany(threadId, msgs);

			const page = messages.getPage(threadId, null, 10);
			expect(page.messages).toHaveLength(5);
			expect(page.hasMore).toBe(false);
			expect(page.nextCursor).toBeNull();
			expect(page.total).toBe(5);
		});

		it("returns empty page for a thread with no messages", () => {
			const { threadId, messages } = seedThread();

			const page = messages.getPage(threadId, null, 10);
			expect(page.messages).toEqual([]);
			expect(page.hasMore).toBe(false);
			expect(page.nextCursor).toBeNull();
			expect(page.total).toBe(0);
		});
	});

	describe("replaceAll", () => {
		it("replaces all messages and bumps the thread updated_at", () => {
			const { db, threadId, messages, threads } = seedThread();

			messages.insertMany(threadId, [
				makeMessage("user", "old", "2025-01-01T00:00:00.000Z"),
			]);

			// Force an old updated_at so we can detect the bump.
			db.prepare(
				`UPDATE trainer_chats SET updated_at = '2020-01-01 00:00:00' WHERE id = ?`,
			).run(threadId);

			const newMessages = [
				makeMessage("user", "new1", "2025-02-01T00:00:00.000Z"),
				makeMessage("assistant", "new2", "2025-02-01T00:00:01.000Z"),
			];
			messages.replaceAll(threadId, newMessages);

			const all = messages.getAll(threadId);
			expect(all).toHaveLength(2);
			expect(all[0].content).toBe("new1");
			expect(all[1].content).toBe("new2");

			const thread = threads.getById(USER_A, threadId);
			expect(thread?.updatedAt).not.toBe("2020-01-01 00:00:00");
		});

		it("clears all messages when replacing with an empty array", () => {
			const { threadId, messages } = seedThread();

			messages.insertMany(threadId, [
				makeMessage("user", "old", "2025-01-01T00:00:00.000Z"),
				makeMessage("assistant", "old2", "2025-01-01T00:00:01.000Z"),
			]);

			messages.replaceAll(threadId, []);
			expect(messages.getAll(threadId)).toEqual([]);
			expect(messages.count(threadId)).toBe(0);
		});
	});

	describe("count", () => {
		it("counts messages in a thread", () => {
			const { threadId, messages } = seedThread();

			messages.insertMany(threadId, [
				makeMessage("user", "a", "2025-01-01T00:00:00.000Z"),
				makeMessage("assistant", "b", "2025-01-01T00:00:01.000Z"),
				makeMessage("user", "c", "2025-01-01T00:00:02.000Z"),
			]);

			expect(messages.count(threadId)).toBe(3);
		});

		it("returns 0 for a thread with no messages", () => {
			const { threadId, messages } = seedThread();
			expect(messages.count(threadId)).toBe(0);
		});
	});

	describe("deleteAll", () => {
		it("deletes all messages for a thread", () => {
			const { threadId, messages } = seedThread();

			messages.insertMany(threadId, [
				makeMessage("user", "a", "2025-01-01T00:00:00.000Z"),
				makeMessage("assistant", "b", "2025-01-01T00:00:01.000Z"),
			]);

			messages.deleteAll(threadId);
			expect(messages.getAll(threadId)).toEqual([]);
		});
	});
});
