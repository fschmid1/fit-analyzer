import { createProfileChangesRepo } from "./profileChanges.js";
import type { ChangeDiff } from "./profileChanges.js";
import { createTestDb } from "./testDb.js";
import { describe, expect, it } from "bun:test";

const USER_A = "user-a";
const USER_B = "user-b";

describe("profileChangesRepo", () => {
	describe("append + list", () => {
		it("appends a change and returns it", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			const diff: ChangeDiff = {
				ftp: { old: 250, new: 260 },
				maxHr: { old: 185, new: 190 },
			};
			repo.append(USER_A, "update_profile", diff);

			const entries = repo.list(USER_A);
			expect(entries).toHaveLength(1);
			expect(entries[0].source).toBe("update_profile");
			expect(entries[0].changes.ftp).toEqual({ old: 250, new: 260 });
			expect(entries[0].changes.maxHr).toEqual({ old: 185, new: 190 });
		});

		it("lists multiple entries for a user", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			repo.append(USER_A, "update_profile", { ftp: { old: 1, new: 2 } });
			repo.append(USER_A, "set_zones", { powerZones: { old: null, new: [] } });
			repo.append(USER_A, "manual", { maxHr: { old: 3, new: 4 } });

			const entries = repo.list(USER_A);
			expect(entries).toHaveLength(3);
			// All three sources should be present (order depends on timestamp/id)
			const sources = new Set(entries.map((e) => e.source));
			expect(sources.has("update_profile")).toBe(true);
			expect(sources.has("set_zones")).toBe(true);
			expect(sources.has("manual")).toBe(true);
		});

		it("isolates changes per user", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			repo.append(USER_A, "update_profile", { ftp: { old: 1, new: 2 } });
			repo.append(USER_B, "manual", { maxHr: { old: 3, new: 4 } });

			expect(repo.list(USER_A)).toHaveLength(1);
			expect(repo.list(USER_B)).toHaveLength(1);
			expect(repo.list(USER_A)[0].source).toBe("update_profile");
			expect(repo.list(USER_B)[0].source).toBe("manual");
		});

		it("returns an empty array when no changes exist", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			expect(repo.list(USER_A)).toEqual([]);
		});
	});

	describe("append with empty diff", () => {
		it("does not append when the diff is empty", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			repo.append(USER_A, "update_profile", {});
			expect(repo.list(USER_A)).toHaveLength(0);
		});
	});

	describe("list limit", () => {
		it("respects the limit parameter", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			for (let i = 0; i < 10; i++) {
				repo.append(USER_A, "manual", { ftp: { old: i, new: i + 1 } });
			}

			const entries = repo.list(USER_A, 3);
			expect(entries).toHaveLength(3);
		});
	});

	describe("malformed changes JSON", () => {
		it("returns an empty diff when the JSON is invalid", () => {
			const db = createTestDb();
			const repo = createProfileChangesRepo(db);

			// Insert a row with invalid JSON directly
			db.prepare(
				"INSERT INTO profile_changes (id, user_id, source, changes) VALUES (?, ?, ?, ?)",
			).run("bad-1", USER_A, "manual", "not-json{");

			const entries = repo.list(USER_A);
			expect(entries).toHaveLength(1);
			expect(entries[0].changes).toEqual({});
		});
	});
});
