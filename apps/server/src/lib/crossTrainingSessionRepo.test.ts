import { describe, expect, it } from "bun:test";
import {
	createCrossTrainingSessionRepo,
	type CrossTrainingSessionInput,
} from "./crossTrainingSessionRepo.js";
import { createTestDb } from "./testDb.js";

const USER = "user-a";

function sessionInput(
	overrides: Partial<CrossTrainingSessionInput> = {},
): CrossTrainingSessionInput {
	return {
		userId: USER,
		date: "2026-11-18",
		startTime: "18:30",
		sport: "WeightTraining",
		name: "Gym",
		durationSeconds: 3300,
		elapsedSeconds: 3600,
		distanceKm: null,
		avgHeartRate: 112,
		maxHeartRate: 148,
		trainingLoad: 42,
		kgLifted: 3250,
		source: "intervals-icu",
		sourceActivityId: "i42",
		...overrides,
	};
}

describe("crossTrainingSessionRepo", () => {
	it("imports once and skips an unchanged re-import", () => {
		const repo = createCrossTrainingSessionRepo(createTestDb());
		expect(repo.upsert(sessionInput())).toBe("imported");
		expect(repo.exists(USER, "intervals-icu", "i42")).toBe(true);
		expect(repo.upsert(sessionInput())).toBe("skipped");
		expect(repo.list(USER)).toHaveLength(1);
	});

	it("updates in place when the provider data changes", () => {
		const repo = createCrossTrainingSessionRepo(createTestDb());
		repo.upsert(sessionInput());
		const first = repo.list(USER)[0];
		expect(repo.upsert(sessionInput({ name: "Upper body" }))).toBe("updated");
		const sessions = repo.list(USER);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe(first.id);
		expect(sessions[0].name).toBe("Upper body");
	});

	it("lists newest first and filters by date window", () => {
		const repo = createCrossTrainingSessionRepo(createTestDb());
		repo.upsert(
			sessionInput({
				sourceActivityId: "old",
				date: "2026-09-01",
				trainingLoad: 20,
			}),
		);
		repo.upsert(
			sessionInput({
				sourceActivityId: "new",
				date: "2026-11-18",
				trainingLoad: 40,
			}),
		);
		expect(repo.list(USER).map((s) => s.source)).toEqual([
			"intervals-icu",
			"intervals-icu",
		]);
		expect(repo.list(USER)[0].date).toBe("2026-11-18");
		expect(repo.recent(USER, "2026-10-01").map((s) => s.date)).toEqual([
			"2026-11-18",
		]);
		expect(repo.loadByDate(USER, "2026-09-01", "2026-09-30")).toEqual([
			{ date: "2026-09-01", trainingLoad: 20 },
		]);
	});
});
