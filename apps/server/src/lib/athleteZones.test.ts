import { createAthleteZonesRepo } from "./athleteZones.js";
import { createTestDb } from "./testDb.js";
import { describe, expect, it } from "bun:test";

const USER_A = "user-a";

describe("athleteZonesRepo", () => {
	describe("get", () => {
		it("returns null overrides for a user with no row", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			const result = repo.get(USER_A);
			expect(result.powerZonesOverride).toBeNull();
			expect(result.hrZonesOverride).toBeNull();
		});
	});

	describe("upsert + get", () => {
		it("persists power zone overrides and retrieves them", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			const power = [
				{ name: "Z1 Recovery", lower: 0, upper: 138 },
				{ name: "Z2 Endurance", lower: 138, upper: 188 },
			];
			repo.upsert(USER_A, power, null);

			const result = repo.get(USER_A);
			expect(result.powerZonesOverride).toEqual(power);
			expect(result.hrZonesOverride).toBeNull();
		});

		it("persists HR zone overrides and retrieves them", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			const hr = [
				{ name: "Z1 Recovery", lower: 0, upper: 104 },
				{ name: "Z2 Endurance", lower: 104, upper: 122 },
			];
			repo.upsert(USER_A, null, hr);

			const result = repo.get(USER_A);
			expect(result.hrZonesOverride).toEqual(hr);
			expect(result.powerZonesOverride).toBeNull();
		});

		it("overwrites previous overrides on a subsequent upsert", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			repo.upsert(
				USER_A,
				[{ name: "Z1 Recovery", lower: 0, upper: 100 }],
				null,
			);
			repo.upsert(
				USER_A,
				[{ name: "Z1 Recovery", lower: 0, upper: 200 }],
				null,
			);

			const result = repo.get(USER_A);
			expect(result.powerZonesOverride).toHaveLength(1);
			expect(result.powerZonesOverride?.[0]?.upper).toBe(200);
		});

		it("handles null overrides (clears that side)", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			repo.upsert(
				USER_A,
				[{ name: "Z1 Recovery", lower: 0, upper: 100 }],
				[{ name: "Z1 Recovery", lower: 0, upper: 100 }],
			);
			repo.upsert(USER_A, null, null);

			const result = repo.get(USER_A);
			expect(result.powerZonesOverride).toBeNull();
			expect(result.hrZonesOverride).toBeNull();
		});
	});

	describe("reset", () => {
		it("deletes the row entirely", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			repo.upsert(
				USER_A,
				[{ name: "Z1 Recovery", lower: 0, upper: 100 }],
				[{ name: "Z1 Recovery", lower: 0, upper: 100 }],
			);
			repo.reset(USER_A);

			const result = repo.get(USER_A);
			expect(result.powerZonesOverride).toBeNull();
			expect(result.hrZonesOverride).toBeNull();
		});

		it("is a no-op when no row exists", () => {
			const db = createTestDb();
			const repo = createAthleteZonesRepo(db);

			expect(() => repo.reset(USER_A)).not.toThrow();
		});
	});
});
