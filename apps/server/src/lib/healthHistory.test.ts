import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type * as HealthHistoryModule from "./healthHistory.js";
import {
	clearSourceHistory,
	getDailySnapshots,
	getLastHistoryUpdate,
	upsertDailySnapshot,
	type HealthHistorySource,
} from "./healthHistory.js";

const DB_PATH = `/tmp/health-history-test-${crypto.randomUUID()}.db`;

interface Snap {
	value: number;
	tags: string[];
}

function mergeSnap(existing: Snap, incoming: Snap): Snap {
	return {
		value: incoming.value ?? existing.value,
		tags: [...new Set([...existing.tags, ...incoming.tags])],
	};
}

beforeAll(() => {
	// The shared `db` singleton reads its path from env.DB_PATH at import
	// time. Set it before the dynamic import so the module graph points at
	// our temp db.
	process.env.DB_PATH = DB_PATH;
});

afterAll(() => {
	using db = new Database(DB_PATH);
	db.exec("DROP TABLE IF EXISTS health_daily_history");
	db.exec("DROP TABLE IF EXISTS hae_health_history");
	Bun.file(DB_PATH)
		.delete()
		.catch(() => {});
});

async function importFresh() {
	const modulePath = require.resolve("./healthHistory.js");
	delete require.cache[modulePath];
	return (await import("./healthHistory.js")) as typeof HealthHistoryModule;
}

describe("healthHistory", () => {
	it("upserts a snapshot and reads it back in range", async () => {
		const h = await importFresh();
		const snap: Snap = { value: 42, tags: ["a"] };
		h.upsertDailySnapshot("u1", "openwearables", "2026-09-01", snap, mergeSnap);

		const rows = h.getDailySnapshots<Snap>(
			"u1",
			"openwearables",
			"2026-08-25",
			"2026-09-08",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].date).toBe("2026-09-01");
		expect(rows[0].snap).toEqual(snap);
		expect(rows[0].updatedAt).toBeTypeOf("string");
	});

	it("merges on conflict instead of overwriting", async () => {
		const h = await importFresh();
		h.upsertDailySnapshot(
			"u2",
			"openwearables",
			"2026-09-01",
			{ value: 1, tags: ["a"] },
			mergeSnap,
		);
		h.upsertDailySnapshot(
			"u2",
			"openwearables",
			"2026-09-01",
			{ value: 2, tags: ["b"] },
			mergeSnap,
		);

		const rows = h.getDailySnapshots<Snap>(
			"u2",
			"openwearables",
			"2026-09-01",
			"2026-09-01",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].snap.value).toBe(2);
		expect(rows[0].snap.tags).toEqual(["a", "b"]);
	});

	it("falls back to incoming when the stored row is unparseable", async () => {
		const h = await importFresh();
		const { db } = await import("../db.js");
		db.prepare(
			"INSERT OR REPLACE INTO health_daily_history (user_id, source, date, data) VALUES (?, ?, ?, ?)",
		).run("u3", "openwearables", "2026-09-01", "{not json");

		h.upsertDailySnapshot(
			"u3",
			"openwearables",
			"2026-09-01",
			{ value: 7, tags: [] },
			mergeSnap,
		);

		const rows = h.getDailySnapshots<Snap>(
			"u3",
			"openwearables",
			"2026-09-01",
			"2026-09-01",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].snap.value).toBe(7);
	});

	it("scopes rows per source and per user", async () => {
		const h = await importFresh();
		h.upsertDailySnapshot(
			"u4",
			"openwearables",
			"2026-09-01",
			{ value: 1, tags: [] },
			mergeSnap,
		);
		h.upsertDailySnapshot(
			"u4",
			"health_auto_export",
			"2026-09-01",
			{ value: 2, tags: [] },
			mergeSnap,
		);
		h.upsertDailySnapshot(
			"u5",
			"openwearables",
			"2026-09-01",
			{ value: 3, tags: [] },
			mergeSnap,
		);

		expect(
			h.getDailySnapshots<Snap>(
				"u4",
				"openwearables",
				"2026-08-01",
				"2026-09-08",
			)[0].snap.value,
		).toBe(1);
		expect(
			h.getDailySnapshots<Snap>(
				"u4",
				"health_auto_export",
				"2026-08-01",
				"2026-09-08",
			)[0].snap.value,
		).toBe(2);
		expect(
			h.getDailySnapshots<Snap>(
				"u5",
				"openwearables",
				"2026-08-01",
				"2026-09-08",
			)[0].snap.value,
		).toBe(3);
	});

	it("range query is inclusive and ordered by date ascending", async () => {
		const h = await importFresh();
		for (const date of [
			"2026-09-03",
			"2026-09-01",
			"2026-09-02",
			"2026-08-31",
		]) {
			h.upsertDailySnapshot(
				"u6",
				"openwearables",
				date,
				{ value: 0, tags: [] },
				mergeSnap,
			);
		}
		const rows = h.getDailySnapshots<Snap>(
			"u6",
			"openwearables",
			"2026-09-01",
			"2026-09-03",
		);
		expect(rows.map((r) => r.date)).toEqual([
			"2026-09-01",
			"2026-09-02",
			"2026-09-03",
		]);
	});

	it("getLastHistoryUpdate reflects the newest write and clearSourceHistory wipes a source", async () => {
		const h = await importFresh();
		expect(
			h.getLastHistoryUpdate("u7", "openwearables" as HealthHistorySource),
		).toBeNull();
		h.upsertDailySnapshot(
			"u7",
			"openwearables",
			"2026-09-01",
			{ value: 1, tags: [] },
			mergeSnap,
		);
		expect(h.getLastHistoryUpdate("u7", "openwearables")).toBeTypeOf("string");
		expect(h.getLastHistoryUpdate("u7", "health_auto_export")).toBeNull();

		h.clearSourceHistory("u7", "openwearables");
		expect(
			h.getDailySnapshots<Snap>(
				"u7",
				"openwearables",
				"2026-01-01",
				"2026-12-31",
			),
		).toHaveLength(0);
	});

	it("migrated HAE rows are readable under the health_auto_export source", async () => {
		const h = await importFresh();
		// Simulate the legacy table being populated before the migration ran,
		// then run the same INSERT..SELECT the db.ts migration performs.
		const { db } = await import("../db.js");
		db.prepare(
			"INSERT OR REPLACE INTO hae_health_history (user_id, date, data, updated_at) VALUES (?, ?, ?, ?)",
		).run(
			"u8",
			"2026-08-01",
			JSON.stringify({ hrv: 55 }),
			"2026-08-01T00:00:00Z",
		);
		db.exec(`
      INSERT INTO health_daily_history (user_id, source, date, data, updated_at)
      SELECT user_id, 'health_auto_export', date, data, updated_at
      FROM hae_health_history
      WHERE true
      ON CONFLICT(user_id, source, date) DO NOTHING
    `);

		const fresh = await importFresh();
		fresh.upsertDailySnapshot(
			"u8",
			"health_auto_export",
			"2026-08-02",
			{ hrv: 60 },
			(e, i) => ({ ...e, ...i }),
		);

		const rows = fresh.getDailySnapshots<{ hrv: number }>(
			"u8",
			"health_auto_export",
			"2026-08-01",
			"2026-08-02",
		);
		expect(rows.map((r) => r.date)).toEqual(["2026-08-01", "2026-08-02"]);
		expect(rows[0].snap.hrv).toBe(55);
		expect(rows[1].snap.hrv).toBe(60);
	});
});
