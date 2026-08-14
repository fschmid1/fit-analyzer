import { createThreadRepo } from "./threadRepo.js";
import { createMessageRepo } from "./messageRepo.js";
import { createTestDb } from "./testDb.js";
import type { TrainerMessage } from "@fit-analyzer/shared";
import { describe, expect, it } from "bun:test";

const USER_A = "user-a";
const USER_B = "user-b";
const ACTIVITY_1 = "act-1";
const ACTIVITY_2 = "act-2";

function makeMessages(count: number, startAt = 0): TrainerMessage[] {
	const msgs: TrainerMessage[] = [];
	for (let i = 0; i < count; i++) {
		const idx = startAt + i;
		const createdAt = new Date(2025, 0, 1, 0, 0, idx).toISOString();
		msgs.push({
			id: `msg-${idx}-${crypto.randomUUID()}`,
			role: idx % 2 === 0 ? "user" : "assistant",
			content: `message ${idx}`,
			createdAt,
		});
	}
	return msgs;
}

describe("threadRepo", () => {
	describe("create + getById", () => {
		it("creates a thread and retrieves it by id for the owner", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "My Thread", null);
			expect(thread.id).toBeTypeOf("string");
			expect(thread.name).toBe("My Thread");
			expect(thread.activityId).toBe(ACTIVITY_1);
			expect(thread.coachModel).toBeNull();
			expect(thread.createdAt).toBeTypeOf("string");
			expect(thread.updatedAt).toBeTypeOf("string");

			const fetched = repo.getById(USER_A, thread.id);
			expect(fetched?.id).toBe(thread.id);
			expect(fetched?.name).toBe("My Thread");
		});

		it("returns null when the thread belongs to another user", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "Mine", null);
			expect(repo.getById(USER_B, thread.id)).toBeNull();
		});

		it("returns null for a non-existent thread id", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);
			expect(repo.getById(USER_A, "does-not-exist")).toBeNull();
		});
	});

	describe("insertWithId", () => {
		it("inserts a thread with a caller-supplied id", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			repo.insertWithId("custom-id", USER_A, ACTIVITY_1, "Custom", null);
			const fetched = repo.getById(USER_A, "custom-id");
			expect(fetched?.id).toBe("custom-id");
			expect(fetched?.name).toBe("Custom");
		});
	});

	describe("listByActivity", () => {
		it("lists threads for a user+activity with message counts", () => {
			const db = createTestDb();
			const threads = createThreadRepo(db);
			const messages = createMessageRepo(db);

			const t1 = threads.create(USER_A, ACTIVITY_1, "First", null);
			const t2 = threads.create(USER_A, ACTIVITY_1, "Second", null);
			threads.create(USER_A, ACTIVITY_2, "Other activity", null);
			threads.create(USER_B, ACTIVITY_1, "Other user", null);

			messages.insertMany(t1.id, makeMessages(3));
			messages.insertMany(t2.id, makeMessages(2, 3));

			const list = threads.listByActivity(USER_A, ACTIVITY_1);
			expect(list).toHaveLength(2);
			const byId = Object.fromEntries(list.map((t) => [t.id, t]));
			expect(byId[t1.id]?.name).toBe("First");
			expect(byId[t1.id]?.messageCount).toBe(3);
			expect(byId[t2.id]?.name).toBe("Second");
			expect(byId[t2.id]?.messageCount).toBe(2);
		});

		it("returns empty array when no threads exist", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);
			expect(repo.listByActivity(USER_A, ACTIVITY_1)).toEqual([]);
		});
	});

	describe("rename", () => {
		it("renames a thread", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "Old", null);
			repo.rename(USER_A, thread.id, "New");
			expect(repo.getById(USER_A, thread.id)?.name).toBe("New");
		});

		it("does not rename a thread belonging to another user", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "Old", null);
			repo.rename(USER_B, thread.id, "Hacked");
			expect(repo.getById(USER_A, thread.id)?.name).toBe("Old");
		});
	});

	describe("updateModel", () => {
		it("updates the coach model", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "T", null);
			repo.updateModel(USER_A, thread.id, "moonshotai/kimi-k2.6");
			expect(repo.getById(USER_A, thread.id)?.coachModel).toBe(
				"moonshotai/kimi-k2.6",
			);
		});
	});

	describe("updateContextTokens", () => {
		it("persists the context-token count", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "T", null);
			repo.updateContextTokens(USER_A, thread.id, 12345);
			expect(repo.getById(USER_A, thread.id)?.contextTokens).toBe(12345);
		});
	});

	describe("delete", () => {
		it("deletes a thread and its messages", () => {
			const db = createTestDb();
			const threads = createThreadRepo(db);
			const messages = createMessageRepo(db);

			const thread = threads.create(USER_A, ACTIVITY_1, "T", null);
			messages.insertMany(thread.id, makeMessages(3));

			threads.delete(USER_A, thread.id);

			expect(threads.getById(USER_A, thread.id)).toBeNull();
			expect(messages.count(thread.id)).toBe(0);
		});

		it("does not delete a thread belonging to another user", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "T", null);
			repo.delete(USER_B, thread.id);
			expect(repo.getById(USER_A, thread.id)).not.toBeNull();
		});
	});

	describe("touch", () => {
		it("bumps updated_at without changing other columns", () => {
			const db = createTestDb();
			const repo = createThreadRepo(db);

			const thread = repo.create(USER_A, ACTIVITY_1, "T", null);

			// Force an old updated_at so we can detect the bump.
			db.prepare(
				`UPDATE trainer_chats SET updated_at = '2020-01-01 00:00:00' WHERE id = ?`,
			).run(thread.id);
			repo.touch(thread.id);

			const fetched = repo.getById(USER_A, thread.id);
			expect(fetched?.updatedAt).not.toBe("2020-01-01 00:00:00");
			expect(fetched?.name).toBe("T");
			expect(fetched?.coachModel).toBeNull();
		});
	});
});
