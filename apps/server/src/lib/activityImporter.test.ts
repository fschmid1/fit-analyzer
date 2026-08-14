import { Database } from "bun:sqlite";
import {
	importActivity,
	type ImportPayload,
	type ImportSideEffects,
} from "./activityImporter.js";
import {
	BIKING_WORKOUT_TYPE_FAMILY_ID,
	BIKING_WORKOUT_TYPE_IDS,
	isBikingWorkout,
	wahooWorkoutToPayload,
	type WahooWorkout,
	type WahooWorkoutSummary,
} from "./wahooImportAdapter.js";
import {
	buildLaps,
	buildRecords,
	buildSummary,
	stravaActivityToPayload,
	type StravaActivity,
	type StravaStreams,
} from "./stravaImportAdapter.js";
import type {
	ActivitySummary,
	LapMarker,
	StoredRecord,
} from "@fit-analyzer/shared";
import { describe, expect, it, mock } from "bun:test";

// ─── Test database helpers ────────────────────────────────────────────────────

/**
 * Build an in-memory SQLite database with the subset of the production schema
 * that `importActivity` touches (activities table + dedup indexes).
 */
function makeTestDb(): Database {
	const db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(`
    CREATE TABLE activities (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      summary TEXT NOT NULL,
      records TEXT NOT NULL,
      laps TEXT NOT NULL,
      intervals TEXT NOT NULL DEFAULT '[]',
      interval_minutes TEXT NOT NULL DEFAULT '',
      custom_ranges TEXT NOT NULL DEFAULT '[]',
      user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      analysis TEXT,
      analysis_tool_calls TEXT,
      strava_activity_id TEXT,
      wahoo_activity_id TEXT
    );
    CREATE UNIQUE INDEX idx_activities_strava_id
      ON activities(user_id, strava_activity_id)
      WHERE strava_activity_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_activities_wahoo_id
      ON activities(user_id, wahoo_activity_id)
      WHERE wahoo_activity_id IS NOT NULL;
  `);
	return db;
}

/** Minimal valid StoredRecord at elapsed second `s`. */
function recordAt(elapsed: number): StoredRecord {
	return {
		timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, elapsed)).toISOString(),
		elapsedSeconds: elapsed,
		power: 200,
		heartRate: 150,
		cadence: 80,
		speed: 25,
		gradient: 0,
		lat: null,
		lng: null,
	};
}

function makeSummary(date = "2025-01-01"): ActivitySummary {
	return {
		date,
		totalTimerTime: 600,
		totalDistanceKm: 41.7,
		avgPower: 200,
		normalizedPower: 210,
		maxPower: 350,
		avgHeartRate: 150,
		maxHeartRate: 170,
		avgCadence: 80,
		normalizedCadence: 81,
		totalWork: 120_000,
		peak1minPower: 300,
		peak5minPower: 260,
		peak20minPower: 230,
		locationCity: null,
		locationState: null,
		locationCountry: null,
	};
}

function makeLaps(): LapMarker[] {
	return [
		{
			startSeconds: 0,
			endSeconds: 600,
			avgPower: 200,
			avgHeartRate: 150,
			avgCadence: 80,
		},
	];
}

function makePayload(overrides: Partial<ImportPayload> = {}): ImportPayload {
	return {
		source: "strava",
		sourceActivityId: "strava-123",
		records: [recordAt(0), recordAt(1), recordAt(2)],
		summary: makeSummary(),
		laps: makeLaps(),
		userId: "user-1",
		...overrides,
	};
}

/** Build a side-effect fake that records every call. */
function recordingSideEffects(): {
	sideEffects: Partial<ImportSideEffects>;
	notifyCalls: { userId: string; records: StoredRecord[] }[];
	locationCalls: string[];
	throwInNotify: boolean;
} {
	const notifyCalls: { userId: string; records: StoredRecord[] }[] = [];
	const locationCalls: string[] = [];
	let throwInNotify = false;
	const sideEffects: Partial<ImportSideEffects> = {
		notifyWaxedChain: mock(async (userId, records) => {
			notifyCalls.push({ userId, records });
			if (throwInNotify) throw new Error("notify-fail");
		}),
		maybeUpdateAthleteLocation: mock((userId) => {
			locationCalls.push(userId);
		}),
	};
	return {
		sideEffects,
		notifyCalls,
		locationCalls,
		get throwInNotify() {
			return throwInNotify;
		},
		set throwInNotify(v: boolean) {
			throwInNotify = v;
		},
	};
}

function readRow(db: Database, id: string) {
	return db
		.prepare(
			"SELECT id, date, summary, records, laps, user_id, strava_activity_id, wahoo_activity_id FROM activities WHERE id = ?",
		)
		.get(id) as {
		id: string;
		date: string;
		summary: string;
		records: string;
		laps: string;
		user_id: string;
		strava_activity_id: string | null;
		wahoo_activity_id: string | null;
	};
}

/** Assert the import result has an id and return it (narrows the type). */
function expectId(result: { id: string | null }): string {
	expect(result.id).toBeString();
	return result.id as string;
}

function countRows(
	db: Database,
	userId: string,
	sourceActivityId: string,
): number {
	const row = db
		.prepare(
			"SELECT COUNT(*) as c FROM activities WHERE user_id = ? AND (strava_activity_id = ? OR wahoo_activity_id = ?)",
		)
		.get(userId, sourceActivityId, sourceActivityId) as { c: number };
	return row.c;
}

// ─── importActivity ───────────────────────────────────────────────────────────

describe("importActivity", () => {
	it("inserts a new row with the correct source tag", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		const payload = makePayload();

		const result = await importActivity(db, payload, {
			sideEffects: fx.sideEffects,
		});

		expect(result.status).toBe("imported");

		const row = readRow(db, expectId(result));
		expect(row.user_id).toBe("user-1");
		expect(row.date).toBe("2025-01-01");
		expect(row.strava_activity_id).toBe("strava-123");
		expect(row.wahoo_activity_id).toBeNull();
		expect(JSON.parse(row.summary)).toEqual(payload.summary);
		expect(JSON.parse(row.records)).toEqual(payload.records);
		expect(JSON.parse(row.laps)).toEqual(payload.laps);
	});

	it("tags wahoo source with wahoo_activity_id", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		const payload = makePayload({
			source: "wahoo",
			sourceActivityId: "wahoo-456",
		});

		const result = await importActivity(db, payload, {
			sideEffects: fx.sideEffects,
		});

		expect(result.status).toBe("imported");
		const row = readRow(db, expectId(result));
		expect(row.strava_activity_id).toBeNull();
		expect(row.wahoo_activity_id).toBe("wahoo-456");
	});

	it("re-import updates the existing row (delete+insert) and keeps a single row", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		const payload = makePayload();

		const first = await importActivity(db, payload, {
			sideEffects: fx.sideEffects,
		});
		expect(first.status).toBe("imported");

		// New summary data — re-import should replace, not duplicate.
		const updatedPayload = makePayload({
			summary: makeSummary("2025-01-02"),
		});
		const second = await importActivity(db, updatedPayload, {
			sideEffects: fx.sideEffects,
		});

		expect(second.status).toBe("updated");
		expect(second.id).not.toBe(first.id);
		expect(countRows(db, "user-1", "strava-123")).toBe(1);
		expect(readRow(db, expectId(second)).date).toBe("2025-01-02");
	});

	it("fit-upload source never dedups — always inserts a fresh row", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();

		const a = await importActivity(
			db,
			makePayload({ source: "fit-upload", sourceActivityId: "upload-1" }),
			{ sideEffects: fx.sideEffects },
		);
		const b = await importActivity(
			db,
			makePayload({ source: "fit-upload", sourceActivityId: "upload-2" }),
			{ sideEffects: fx.sideEffects },
		);

		expect(a.status).toBe("imported");
		expect(b.status).toBe("imported");
		expect(a.id).not.toBe(b.id);
		// fit-upload rows have NULL dedup columns
		const aId = expectId(a);
		const bId = expectId(b);
		expect(readRow(db, aId).strava_activity_id).toBeNull();
		expect(readRow(db, aId).wahoo_activity_id).toBeNull();
		expect(readRow(db, bId).strava_activity_id).toBeNull();
	});

	it("does not collide across sources that happen to share a sourceActivityId", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();

		const stravaRow = await importActivity(
			db,
			makePayload({ source: "strava", sourceActivityId: "shared-99" }),
			{ sideEffects: fx.sideEffects },
		);
		const wahooRow = await importActivity(
			db,
			makePayload({ source: "wahoo", sourceActivityId: "shared-99" }),
			{ sideEffects: fx.sideEffects },
		);

		expect(stravaRow.status).toBe("imported");
		expect(wahooRow.status).toBe("imported");
		expect(stravaRow.id).not.toBe(wahooRow.id);
		expect(readRow(db, expectId(stravaRow)).strava_activity_id).toBe(
			"shared-99",
		);
		expect(readRow(db, expectId(wahooRow)).wahoo_activity_id).toBe("shared-99");
	});

	it("fires both side effects after commit", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		const payload = makePayload();

		await importActivity(db, payload, { sideEffects: fx.sideEffects });

		expect(fx.notifyCalls).toHaveLength(1);
		expect(fx.notifyCalls[0].userId).toBe("user-1");
		expect(fx.notifyCalls[0].records).toEqual(payload.records);
		expect(fx.locationCalls).toEqual(["user-1"]);
	});

	it("does not abort when notifyWaxedChain throws", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		fx.throwInNotify = true;

		const result = await importActivity(db, makePayload(), {
			sideEffects: fx.sideEffects,
		});

		// Row is still persisted even though the side effect threw.
		expect(result.status).toBe("imported");
		expect(readRow(db, expectId(result)).user_id).toBe("user-1");
		// Location side effect still ran.
		expect(fx.locationCalls).toEqual(["user-1"]);
	});

	it("skips (no delete+insert) when re-importing identical content", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		const payload = makePayload();

		const first = await importActivity(db, payload, {
			sideEffects: fx.sideEffects,
		});
		expect(first.status).toBe("imported");
		const firstId = expectId(first);

		// Re-import the exact same payload. The importer should detect identical
		// content and skip, leaving the original row untouched.
		const second = await importActivity(db, payload, {
			sideEffects: fx.sideEffects,
		});

		expect(second.status).toBe("skipped");
		expect(second.id).toBe(firstId);
		// Row identity preserved — no delete+insert happened.
		expect(readRow(db, firstId).id).toBe(firstId);
		// Side effects fired exactly once (on the first import), not twice.
		expect(fx.notifyCalls).toHaveLength(1);
		expect(fx.locationCalls).toEqual(["user-1"]);
	});

	it("updates when re-importing with changed records (not a skip)", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();
		const payload = makePayload();

		const first = await importActivity(db, payload, {
			sideEffects: fx.sideEffects,
		});

		// Same sourceActivityId, different records.
		const changed = makePayload({
			records: [recordAt(0), recordAt(1), recordAt(2), recordAt(3)],
		});
		const second = await importActivity(db, changed, {
			sideEffects: fx.sideEffects,
		});

		expect(second.status).toBe("updated");
		expect(second.id).not.toBe(first.id);
	});

	it("transaction rolls back when the insert throws — original row survives", async () => {
		const db = makeTestDb();
		const fx = recordingSideEffects();

		// Insert an initial row we'll attempt to "re-import".
		const original = await importActivity(
			db,
			makePayload({ source: "strava", sourceActivityId: "tx-1" }),
			{ sideEffects: fx.sideEffects },
		);
		expect(original.status).toBe("imported");
		const originalId = expectId(original);

		// Drop the activities table mid-test, then attempt a re-import with
		// changed content (so the skip path doesn't short-circuit). The
		// importer's transaction will: (1) fetch existing — succeeds because
		// the row is still there, (2) begin tx, (3) DELETE — succeeds, (4)
		// INSERT — throws because the table was dropped. The transaction
		// wrapper must roll back step (3), leaving the original row intact.
		//
		// We can't drop the table between (1) and (2) from inside the same
		// connection the importer uses, so instead we sabotage the cached
		// INSERT statement by dropping the `laps` column it references. The
		// DELETE (which doesn't reference `laps`) still succeeds, but the
		// INSERT throws — proving the rollback restores the deleted row.
		//
		// SQLite doesn't support DROP COLUMN directly; we rebuild the table
		// without `laps` to force the INSERT to fail.
		db.exec("ALTER TABLE activities RENAME TO activities_old");
		db.exec(`
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        summary TEXT NOT NULL,
        records TEXT NOT NULL,
        intervals TEXT NOT NULL DEFAULT '[]',
        user_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        strava_activity_id TEXT,
        wahoo_activity_id TEXT
      );
    `);
		// Copy the original row into the new table (without laps).
		db.exec(`
      INSERT INTO activities (id, date, summary, records, intervals, user_id, created_at, strava_activity_id)
      SELECT id, date, summary, records, intervals, user_id, created_at, strava_activity_id
      FROM activities_old;
    `);
		db.exec("DROP TABLE activities_old");

		// Re-import with changed content so the skip path doesn't short-circuit.
		// The INSERT will throw (no `laps` column), the transaction rolls back
		// the DELETE, and the original row survives.
		const changed = makePayload({
			source: "strava",
			sourceActivityId: "tx-1",
			summary: makeSummary("2025-01-02"),
		});

		await expect(
			importActivity(db, changed, { sideEffects: fx.sideEffects }),
		).rejects.toThrow();

		// Original row survived the failed transaction (DELETE was rolled back).
		const row = db
			.prepare(
				"SELECT id, summary FROM activities WHERE strava_activity_id = ?",
			)
			.get("tx-1") as { id: string; summary: string };
		expect(row.id).toBe(originalId);
		expect(JSON.parse(row.summary).date).toBe("2025-01-01");
	});
});

// ─── Strava adapter ───────────────────────────────────────────────────────────

describe("stravaActivityToPayload", () => {
	function makeStravaActivity(
		overrides: Partial<StravaActivity> = {},
	): StravaActivity {
		return {
			id: 123,
			name: "Morning Ride",
			type: "Ride",
			sport_type: "Ride",
			start_date: "2025-01-01T08:00:00Z",
			moving_time: 600,
			elapsed_time: 610,
			distance: 41700,
			average_watts: 200,
			max_watts: 350,
			average_heartrate: 150,
			max_heartrate: 170,
			average_cadence: 80,
			kilojoules: 120,
			location_city: "Berlin",
			location_state: "BE",
			location_country: "Germany",
			...overrides,
		};
	}

	function makeStreams(): StravaStreams {
		const time = [0, 1, 2, 3, 4];
		return {
			time: { type: "time", data: time },
			watts: { type: "watts", data: [180, 200, 220, 240, 260] },
			heartrate: { type: "heartrate", data: [140, 145, 150, 155, 160] },
			cadence: { type: "cadence", data: [70, 75, 80, 85, 90] },
			velocity_smooth: { type: "velocity_smooth", data: [6, 7, 8, 9, 10] },
			grade_smooth: { type: "grade_smooth", data: [0, 1, 2, -1, 0] },
			latlng: {
				type: "latlng",
				data: [
					[52.5, 13.4],
					[52.51, 13.41],
					[52.52, 13.42],
					[52.53, 13.43],
					[52.54, 13.44],
				],
			},
		};
	}

	it("returns { skipped: 'not-a-ride' } for a non-ride activity", async () => {
		const fetcher = {
			fetchActivity: async () =>
				makeStravaActivity({ type: "Run", sport_type: "Run" }),
			fetchStreams: async () => ({}),
			fetchLaps: async () => [],
		};
		const result = await stravaActivityToPayload("user-1", 123, "tok", fetcher);
		expect(result).toEqual({ skipped: "not-a-ride" });
	});

	it("transforms a ride into a normalized ImportPayload", async () => {
		const activity = makeStravaActivity();
		const streams = makeStreams();
		const fetcher = {
			fetchActivity: async () => activity,
			fetchStreams: async () => streams,
			fetchLaps: async () => [
				{
					start_index: 0,
					end_index: 4,
					average_watts: 210,
					average_heartrate: 150,
					average_cadence: 80,
				},
			],
		};

		const result = await stravaActivityToPayload("user-1", 123, "tok", fetcher);

		expect("payload" in result).toBe(true);
		if (!("payload" in result)) return;

		const { payload } = result;
		expect(payload.source).toBe("strava");
		expect(payload.sourceActivityId).toBe("123");
		expect(payload.userId).toBe("user-1");
		expect(payload.records).toHaveLength(5);
		expect(payload.records[0].timestamp).toBe(
			new Date(Date.UTC(2025, 0, 1, 8, 0, 0)).toISOString(),
		);
		expect(payload.records[0].elapsedSeconds).toBe(0);
		expect(payload.records[0].power).toBe(180);
		expect(payload.records[4].power).toBe(260);
		expect(payload.summary.date).toBe("2025-01-01");
		expect(payload.summary.totalTimerTime).toBe(600);
		expect(payload.summary.totalDistanceKm).toBe(41.7);
		expect(payload.summary.avgPower).toBe(220); // mean of [180,200,220,240,260]
		expect(payload.summary.maxPower).toBe(260);
		expect(payload.summary.locationCity).toBe("Berlin");
		expect(payload.laps).toHaveLength(1);
		expect(payload.laps[0].startSeconds).toBe(0);
		expect(payload.laps[0].endSeconds).toBe(4);
		expect(payload.laps[0].avgPower).toBe(210);
	});

	it("propagates fetchActivity errors", async () => {
		const fetcher = {
			fetchActivity: async () => {
				throw new Error("404");
			},
			fetchStreams: async () => ({}),
			fetchLaps: async () => [],
		};
		expect(
			stravaActivityToPayload("user-1", 999, "tok", fetcher),
		).rejects.toThrow("404");
	});

	it("handles missing streams gracefully (empty object)", async () => {
		const fetcher = {
			fetchActivity: async () => makeStravaActivity(),
			fetchStreams: async () => ({}),
			fetchLaps: async () => [],
		};
		const result = await stravaActivityToPayload("user-1", 123, "tok", fetcher);
		expect("payload" in result).toBe(true);
		if (!("payload" in result)) return;
		expect(result.payload.records).toEqual([]);
	});
});

// ─── Wahoo adapter ────────────────────────────────────────────────────────────

describe("wahooWorkoutToPayload", () => {
	function makeWahooSummary(): WahooWorkoutSummary {
		return {
			id: 42,
			name: "Indoor Ride",
			ascent_accum: "0",
			cadence_avg: "80",
			calories_accum: "120",
			distance_accum: "0",
			duration_active_accum: "1800",
			duration_paused_accum: "0",
			duration_total_accum: "1800",
			heart_rate_avg: "150",
			power_bike_np_last: "210",
			power_bike_tss_last: "50",
			power_avg: "200",
			speed_avg: "25",
			work_accum: "360000",
			file: { url: "https://cdn.wahoo.example/42.fit" },
			created_at: "2025-01-01T08:00:00Z",
			updated_at: "2025-01-01T08:30:00Z",
		};
	}

	function makeWorkout(overrides: Partial<WahooWorkout> = {}): WahooWorkout {
		return {
			id: 42,
			starts: "2025-01-01T08:00:00Z",
			minutes: 30,
			name: "Indoor Ride",
			plan_id: null,
			plan_ids: [],
			route_id: null,
			workout_token: "tok",
			workout_type_id: 15, // BIKING_ROAD
			workout_summary: makeWahooSummary(),
			created_at: "2025-01-01T08:00:00Z",
			updated_at: "2025-01-01T08:30:00Z",
			...overrides,
		};
	}

	// The adapter's FIT-parsing seam accepts a canned ParsedActivity, so tests
	// don't need a real FIT file. The downloader still returns an ArrayBuffer
	// (the parser is what interprets it), so we return an empty buffer — the
	// fake parser ignores it.
	const noopDownloader = { downloadFit: async () => new ArrayBuffer(0) };

	it("returns { skipped: 'not-biking' } for a non-biking workout", async () => {
		const result = await wahooWorkoutToPayload(
			"user-1",
			makeWorkout({ workout_type_id: 1, workout_type_family_id: undefined }),
			{ downloader: noopDownloader },
		);
		expect(result).toEqual({ skipped: "not-biking" });
	});

	it("returns { skipped: 'pending' } when no FIT url is present", async () => {
		const result = await wahooWorkoutToPayload(
			"user-1",
			makeWorkout({
				workout_summary: { ...makeWahooSummary(), file: { url: null } },
			}),
			{ downloader: noopDownloader },
		);
		expect(result).toEqual({ skipped: "pending" });
	});

	it("returns { skipped: 'pending' } when workout_summary is null", async () => {
		const result = await wahooWorkoutToPayload(
			"user-1",
			makeWorkout({ workout_summary: null }),
			{ downloader: noopDownloader },
		);
		expect(result).toEqual({ skipped: "pending" });
	});

	it("transforms a biking workout with a FIT url into a normalized ImportPayload", async () => {
		// Canned ParsedActivity returned by the fake parser.
		const baseDate = new Date(Date.UTC(2025, 0, 1, 8, 0, 0));
		const parsed = {
			records: [
				{
					timestamp: baseDate,
					elapsedSeconds: 0,
					power: 200,
					heartRate: 140,
					cadence: 80,
					speed: 25,
					gradient: 0,
					lat: null,
					lng: null,
				},
				{
					timestamp: new Date(baseDate.getTime() + 1000),
					elapsedSeconds: 1,
					power: 210,
					heartRate: 145,
					cadence: 82,
					speed: 26,
					gradient: 1,
					lat: null,
					lng: null,
				},
			],
			summary: makeSummary("2025-01-01"),
			laps: makeLaps(),
		};

		const fakeParser = { parse: () => parsed };

		const result = await wahooWorkoutToPayload("user-1", makeWorkout(), {
			downloader: noopDownloader,
			parser: fakeParser,
		});

		expect("payload" in result).toBe(true);
		if (!("payload" in result)) return;

		const { payload } = result;
		expect(payload.source).toBe("wahoo");
		expect(payload.sourceActivityId).toBe("42");
		expect(payload.userId).toBe("user-1");
		// ActivityRecord Date timestamps were converted to ISO strings.
		expect(payload.records).toHaveLength(2);
		expect(payload.records[0].timestamp).toBe(baseDate.toISOString());
		expect(payload.records[0].power).toBe(200);
		expect(payload.records[1].timestamp).toBe(
			new Date(baseDate.getTime() + 1000).toISOString(),
		);
		expect(payload.records[1].power).toBe(210);
		expect(payload.summary).toEqual(parsed.summary);
		expect(payload.laps).toEqual(parsed.laps);
	});

	it("propagates downloader errors", async () => {
		const failingDownloader = {
			downloadFit: async () => {
				throw new Error("503");
			},
		};
		expect(
			wahooWorkoutToPayload("user-1", makeWorkout(), {
				downloader: failingDownloader,
			}),
		).rejects.toThrow("503");
	});
});

// ─── Wahoo biking filter (pure, no I/O) ───────────────────────────────────────

describe("isBikingWorkout", () => {
	function workout(
		typeId: number,
		familyId?: number,
	): Pick<WahooWorkout, "workout_type_id" | "workout_type_family_id"> {
		return { workout_type_id: typeId, workout_type_family_id: familyId };
	}

	it("returns true when workout_type_family_id is BIKING (0)", () => {
		expect(isBikingWorkout(workout(99, 0))).toBe(true);
	});

	it("returns false when workout_type_family_id is non-BIKING", () => {
		expect(isBikingWorkout(workout(99, 1))).toBe(false);
	});

	it("falls back to BIKING_WORKOUT_TYPE_IDS when family id is absent", () => {
		for (const id of BIKING_WORKOUT_TYPE_IDS) {
			expect(isBikingWorkout(workout(id, undefined))).toBe(true);
		}
	});

	it("returns false for an unknown type id with no family", () => {
		expect(isBikingWorkout(workout(999, undefined))).toBe(false);
	});

	it("prefers family id over type id (family wins even if type id is not in the set)", () => {
		// family id 0 = biking; type id 999 is not in the set, but family wins.
		expect(isBikingWorkout(workout(999, 0))).toBe(true);
		// family id 1 = not biking; type id 15 IS in the set, but family wins.
		expect(isBikingWorkout(workout(15, 1))).toBe(false);
	});

	it("BIKING_WORKOUT_TYPE_FAMILY_ID is 0", () => {
		expect(BIKING_WORKOUT_TYPE_FAMILY_ID).toBe(0);
	});
});

// ─── Strava build* helpers (pure) ─────────────────────────────────────────────

describe("buildRecords", () => {
	it("maps stream indices to StoredRecords with ISO timestamps", () => {
		const startDate = new Date(Date.UTC(2025, 0, 1, 8, 0, 0));
		const streams: StravaStreams = {
			time: { type: "time", data: [0, 1, 2] },
			watts: { type: "watts", data: [100, 200, 300] },
			heartrate: { type: "heartrate", data: [120, 130, 140] },
			cadence: { type: "cadence", data: [70, 75, 80] },
			velocity_smooth: { type: "velocity_smooth", data: [5, 6, 7] },
			grade_smooth: { type: "grade_smooth", data: [0, 1, -1] },
			latlng: {
				type: "latlng",
				data: [
					[52, 13],
					[52.1, 13.1],
					[52.2, 13.2],
				],
			},
		};

		const records = buildRecords(startDate, streams);

		expect(records).toHaveLength(3);
		expect(records[0]).toEqual({
			timestamp: new Date(Date.UTC(2025, 0, 1, 8, 0, 0)).toISOString(),
			elapsedSeconds: 0,
			power: 100,
			heartRate: 120,
			cadence: 70,
			speed: 18, // 5 m/s * 3.6 = 18 km/h, rounded to 0.1
			gradient: 0,
			lat: 52,
			lng: 13,
		});
		expect(records[1].speed).toBe(21.6); // 6 * 3.6
		expect(records[2].lat).toBe(52.2);
	});

	it("handles missing streams (all-null fields except time)", () => {
		const records = buildRecords(new Date("2025-01-01T00:00:00Z"), {
			time: { type: "time", data: [0, 1] },
		});
		expect(records).toHaveLength(2);
		expect(records[0].power).toBeNull();
		expect(records[0].heartRate).toBeNull();
		expect(records[0].lat).toBeNull();
	});

	it("returns [] for empty time stream", () => {
		expect(buildRecords(new Date(), {})).toEqual([]);
	});
});

describe("buildSummary", () => {
	it("computes avg/max from non-zero records", () => {
		const activity: StravaActivity = {
			id: 1,
			name: "Ride",
			type: "Ride",
			sport_type: "Ride",
			start_date: "2025-03-15T08:00:00Z",
			moving_time: 600,
			elapsed_time: 610,
			distance: 10000,
			location_city: null,
			location_state: null,
			location_country: null,
		};
		const records: StoredRecord[] = [
			{ ...makePayload().records[0], power: 0, heartRate: 0, cadence: 0 },
			{
				...makePayload().records[0],
				power: 200,
				heartRate: 150,
				cadence: 80,
				elapsedSeconds: 1,
			},
			{
				...makePayload().records[0],
				power: 400,
				heartRate: 170,
				cadence: 90,
				elapsedSeconds: 2,
			},
		];
		const timeArr = [0, 1, 2];
		const wattsArr = [0, 200, 400];
		const cadenceArr = [0, 80, 90];

		const summary = buildSummary(
			activity,
			records,
			timeArr,
			wattsArr,
			cadenceArr,
		);

		expect(summary.date).toBe("2025-03-15");
		expect(summary.totalTimerTime).toBe(600);
		expect(summary.totalDistanceKm).toBe(10);
		expect(summary.avgPower).toBe(300); // mean of [200, 400]
		expect(summary.maxPower).toBe(400);
		expect(summary.avgHeartRate).toBe(160);
		expect(summary.maxHeartRate).toBe(170);
		expect(summary.avgCadence).toBe(85);
		expect(summary.totalWork).toBe(600 * 0 + 200 * 1 + 400 * 1); // 600 J
	});

	it("returns null averages when all values are zero or null", () => {
		const activity: StravaActivity = {
			id: 1,
			name: "Ride",
			type: "Ride",
			sport_type: "Ride",
			start_date: "2025-03-15T08:00:00Z",
			moving_time: 600,
			elapsed_time: 610,
			distance: undefined,
		};
		const records: StoredRecord[] = [
			{ ...makePayload().records[0], power: 0, heartRate: 0, cadence: 0 },
		];
		const summary = buildSummary(activity, records, [0], [0], [0]);
		expect(summary.avgPower).toBeNull();
		expect(summary.avgHeartRate).toBeNull();
		expect(summary.avgCadence).toBeNull();
		expect(summary.maxPower).toBeNull();
		expect(summary.totalDistanceKm).toBeNull();
	});
});

describe("buildLaps", () => {
	it("converts stream indices to elapsed seconds via the time stream", () => {
		const timeArr = [0, 10, 20, 30, 40];
		const laps = buildLaps(
			[
				{ start_index: 0, end_index: 2, average_watts: 200 },
				{ start_index: 3, end_index: 4, average_watts: 220 },
			],
			timeArr,
		);
		expect(laps).toEqual([
			{
				startSeconds: 0,
				endSeconds: 20,
				avgPower: 200,
				avgHeartRate: null,
				avgCadence: null,
			},
			{
				startSeconds: 30,
				endSeconds: 40,
				avgPower: 220,
				avgHeartRate: null,
				avgCadence: null,
			},
		]);
	});

	it("clamps end_index past the time array length", () => {
		const laps = buildLaps([{ start_index: 0, end_index: 99 }], [0, 10]);
		expect(laps[0].endSeconds).toBe(10);
	});

	it("falls back to the raw index when time array is empty", () => {
		const laps = buildLaps([{ start_index: 5, end_index: 10 }], []);
		expect(laps[0].startSeconds).toBe(5);
		expect(laps[0].endSeconds).toBe(10);
	});
});
