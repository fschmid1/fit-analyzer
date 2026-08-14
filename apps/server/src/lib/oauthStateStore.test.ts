import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { oauthStateStore } from "./oauthStateStore.js";

/**
 * State-store tests against the real SQLite-backed store.
 *
 * The spec (plans/07-oauth2-integration.md, line 94) calls out:
 *   "State store: create → consume → null on second consume; survives across
 *    instances if db-backed"
 *
 * "Survives across instances" means a new store backed by the same db file
 * can consume a state created by a previous instance — the state lives in
 * SQLite, not in process memory. We exercise that by re-importing the module
 * against a fresh db path mid-test.
 */

const DB_PATH = `/tmp/oauth-state-test-${crypto.randomUUID()}.db`;

// The shared `db` singleton (imported transitively via oauthStateStore) reads
// its path from env.DB_PATH at import time. We set that before the dynamic
// re-import so the new module graph points at our temp db.
beforeAll(() => {
	process.env.DB_PATH = DB_PATH;
});

afterAll(() => {
	using db = new Database(DB_PATH);
	db.exec("DROP TABLE IF EXISTS oauth_states");
	Bun.file(DB_PATH)
		.delete()
		.catch(() => {});
});

describe("oauthStateStore", () => {
	it("create → consume returns the userId", () => {
		const state = oauthStateStore.create("strava", "user-1");
		expect(typeof state).toBe("string");
		expect(state.length).toBeGreaterThan(0);
		expect(oauthStateStore.consume("strava", state)).toBe("user-1");
	});

	it("a state can only be consumed once", () => {
		const state = oauthStateStore.create("strava", "user-2");
		expect(oauthStateStore.consume("strava", state)).toBe("user-2");
		expect(oauthStateStore.consume("strava", state)).toBeNull();
	});

	it("returns null for an unknown state", () => {
		expect(oauthStateStore.consume("strava", "never-issued")).toBeNull();
	});

	it("scopes states per provider (strava state rejected by wahoo)", () => {
		const state = oauthStateStore.create("strava", "user-3");
		expect(oauthStateStore.consume("wahoo", state)).toBeNull();
		// And the strava state is still consumable by strava
		expect(oauthStateStore.consume("strava", state)).toBe("user-3");
	});

	it("survives across instances (db-backed, not in-memory)", async () => {
		// Create a state with the current instance
		const state = oauthStateStore.create("wahoo", "user-4");

		// Re-import the module graph against the same db path — a fresh
		// module instance should still be able to consume the state, because
		// it lives in SQLite, not in a Map on the old instance.
		const modulePath = require.resolve("./oauthStateStore.js");
		delete require.cache[modulePath];
		const fresh = (await import("./oauthStateStore.js")) as {
			oauthStateStore: typeof oauthStateStore;
		};

		expect(fresh.oauthStateStore.consume("wahoo", state)).toBe("user-4");
	});
});
