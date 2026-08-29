import { describe, expect, it } from "bun:test";
import {
	buildEvent,
	eventFocus,
	filterRemovals,
	mergePlan,
	syncKey,
	wallClockMinute,
	SYNC_FOCUS_PROP,
	SYNC_KEY_PROP,
	SYNC_STAMP_PROP,
	type CalendarEventSnapshot,
} from "./googleCalendarSync.js";
import type { PlannedWorkout } from "@fit-analyzer/shared";

const TZ = "Europe/Zurich";
const NOW = Date.parse("2026-08-29T10:00:00Z"); // 12:00 in Zurich (CEST)
// Wall-clock "now" in the training timezone — matches wallClockMinute output.
const NOW_WALL = "2026-08-29T12:00";

function workout(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
	return {
		date: "2026-09-01",
		startTime: "17:00",
		durationMinutes: 60,
		focus: "Threshold intervals",
		description: null,
		...overrides,
	};
}

/** A stored app event as Google would return it after our own write at stampMs. */
function appEvent(
	id: string,
	dateTime: string,
	stampMs: number,
	overrides: Partial<CalendarEventSnapshot> = {},
): CalendarEventSnapshot {
	const date = dateTime.slice(0, 10);
	const time = dateTime.slice(11, 16);
	const focusOverride =
		typeof overrides.summary === "string"
			? overrides.summary.replace(/^🚴\s*/, "")
			: "Threshold intervals";
	return {
		id,
		summary: "🚴 Threshold intervals",
		description: null,
		start: { dateTime, timeZone: TZ },
		end: { dateTime: shiftHour(dateTime), timeZone: TZ },
		updated: new Date(stampMs).toISOString(),
		colorId: "7",
		extendedProperties: {
			private: {
				[SYNC_KEY_PROP]: `${date}T${time}|${focusOverride.toLowerCase()}`,
				[SYNC_FOCUS_PROP]: focusOverride,
				[SYNC_STAMP_PROP]: String(stampMs),
			},
		},
		...overrides,
	};
}

function shiftHour(dateTime: string): string {
	const base = Date.parse(`${dateTime.slice(0, 16)}:00Z`);
	return `${new Date(base + 3_600_000).toISOString().slice(0, 16)}:00`;
}

describe("syncKey", () => {
	it("derives a deterministic key from date, time, and focus", () => {
		expect(syncKey(workout())).toBe("2026-09-01T17:00|threshold intervals");
	});

	it("normalizes a missing start time to the default", () => {
		expect(syncKey(workout({ startTime: null }))).toBe(
			"2026-09-01T17:00|threshold intervals",
		);
	});

	it("is case-insensitive on focus", () => {
		expect(syncKey(workout({ focus: "THRESHOLD INTERVALS" }))).toBe(
			syncKey(workout()),
		);
	});
});

describe("buildEvent", () => {
	it("builds a wall-clock event with sync properties", () => {
		const ev = buildEvent(workout({ description: "3x10 min" }), TZ, 1234567890);
		expect(ev.summary).toBe("🚴 Threshold intervals");
		expect(ev.start).toEqual({ dateTime: "2026-09-01T17:00:00", timeZone: TZ });
		expect(ev.end).toEqual({ dateTime: "2026-09-01T18:00:00", timeZone: TZ });
		expect(ev.extendedProperties.private[SYNC_KEY_PROP]).toBe(
			syncKey(workout()),
		);
		expect(ev.extendedProperties.private[SYNC_STAMP_PROP]).toBe("1234567890");
	});

	it("defaults duration to 60 minutes when invalid", () => {
		const ev = buildEvent(workout({ durationMinutes: 0 }), TZ, 0);
		expect(ev.end.dateTime.slice(11, 16)).toBe("18:00");
	});
});

describe("wallClockMinute", () => {
	it("formats the current minute in the target timezone", () => {
		expect(wallClockMinute(new Date(NOW), TZ)).toBe(NOW_WALL);
		expect(wallClockMinute(new Date(NOW), "UTC")).toBe("2026-08-29T10:00");
	});
});

describe("mergePlan — create", () => {
	it("creates events for workouts with no existing event", () => {
		const { actions, result } = mergePlan([workout()], [], TZ, NOW);
		expect(actions).toHaveLength(1);
		expect(actions[0].kind).toBe("create");
		expect(result.created).toEqual([
			{ date: "2026-09-01", startTime: "17:00", focus: "Threshold intervals" },
		]);
		expect(result.deleted).toBe(0);
		expect(result.errors).toEqual([]);
	});

	it("does not create workouts that already started", () => {
		const { actions, result } = mergePlan(
			[workout({ date: "2026-08-29", startTime: "09:00" })],
			[],
			TZ,
			NOW,
		);
		expect(actions).toHaveLength(0);
		expect(result.created).toEqual([]);
		expect(result.notScheduled).toHaveLength(1);
	});
});

describe("mergePlan — update in place", () => {
	it("updates a matching un-edited event", () => {
		const stamp = NOW - 60_000;
		const existing = appEvent("ev1", "2026-09-01T17:00:00", stamp, {
			description: "old notes",
		});
		const { actions, result } = mergePlan(
			[workout({ description: "new notes" })],
			[existing],
			TZ,
			NOW,
		);
		expect(actions[0].kind).toBe("update");
		expect(result.updated).toHaveLength(1);
	});

	it("does not update when nothing changed", () => {
		const stamp = NOW - 60_000;
		const existing = appEvent("ev1", "2026-09-01T17:00:00", stamp);
		const plan = workout();
		const ev = buildEvent(plan, TZ, stamp);
		const stored: CalendarEventSnapshot = {
			...existing,
			summary: ev.summary,
			description: ev.description,
			colorId: ev.colorId,
		};
		const { actions, result } = mergePlan([plan], [stored], TZ, NOW);
		expect(actions).toHaveLength(0);
		expect(result.updated).toEqual([]);
	});

	it("skips an event the user edited in Google", () => {
		const stamp = NOW - 60_000;
		const existing = appEvent("ev1", "2026-09-01T17:00:00", stamp, {
			updated: new Date(NOW - 30_000).toISOString(), // newer than our stamp
		});
		const { actions, result } = mergePlan([workout()], [existing], TZ, NOW);
		expect(actions[0].kind).toBe("skipEdited");
		expect(result.skipped).toHaveLength(1);
	});

	it("treats an equal-timestamp `updated` as our own write", () => {
		const stamp = NOW - 60_000;
		const existing = appEvent("ev1", "2026-09-01T17:00:00", stamp, {
			updated: new Date(stamp).toISOString(),
		});
		const { actions } = mergePlan(
			[workout({ description: "changed" })],
			[existing],
			TZ,
			NOW,
		);
		expect(actions[0].kind).toBe("update");
	});
});

describe("mergePlan — delete", () => {
	it("removes future app events absent from the plan", () => {
		const stamp = NOW - 60_000;
		const stale = appEvent("stale", "2026-09-02T17:00:00", stamp, {
			summary: "🚴 Recovery spin",
		});
		const { actions, result } = mergePlan([workout()], [stale], TZ, NOW);
		expect(actions.some((a) => a.kind === "remove")).toBe(true);
		expect(result.deleted).toBe(1);
	});

	it("never removes started or past app events", () => {
		const past = appEvent("past", "2026-08-25T17:00:00", NOW - 60_000, {
			summary: "🚴 Recovery spin",
		});
		const { actions, result } = mergePlan([], [past], TZ, NOW);
		expect(actions[0].kind).toBe("skipStarted");
		expect(result.deleted).toBe(0);
	});

	it("counts user-edited orphans as skippedEdits instead of deleting", () => {
		const stamp = NOW - 60_000;
		const edited = appEvent("edited", "2026-09-02T17:00:00", stamp, {
			summary: "🚴 Recovery spin",
			updated: new Date(NOW - 30_000).toISOString(),
		});
		const { result } = mergePlan([], [edited], TZ, NOW);
		expect(result.deleted).toBe(0);
		expect(result.skippedEdits).toBe(1);
	});

	it("never touches events without our sync key", () => {
		const foreign: CalendarEventSnapshot = {
			id: "personal",
			summary: "Dentist",
			description: null,
			start: { dateTime: "2026-09-01T09:00:00", timeZone: TZ },
			end: { dateTime: "2026-09-01T10:00:00", timeZone: TZ },
			updated: new Date(NOW).toISOString(),
		};
		const { actions, result } = mergePlan([], [foreign], TZ, NOW);
		expect(actions).toHaveLength(0);
		expect(result.deleted).toBe(0);
	});
});

describe("mergePlan — duplicates", () => {
	it("removes future twin events sharing a sync key, keeps the first", () => {
		const stamp = NOW - 60_000;
		const canonical = appEvent("a", "2026-09-01T17:00:00", stamp);
		const twin = appEvent("b", "2026-09-01T17:00:00", stamp);
		const { actions, result } = mergePlan(
			[workout()],
			[canonical, twin],
			TZ,
			NOW,
		);
		const removed = actions.filter((a) => a.kind === "remove");
		expect(removed).toHaveLength(1);
		expect((removed[0] as { event: CalendarEventSnapshot }).event.id).toBe("b");
		expect(result.deleted).toBe(1);
		expect(result.deletedRows).toHaveLength(1);
	});

	it("reports started plan workouts as notScheduled, not errors", () => {
		const { result } = mergePlan(
			[workout({ date: "2026-08-29", startTime: "09:00" })],
			[],
			TZ,
			NOW,
		);
		expect(result.errors).toEqual([]);
		expect(result.notScheduled).toEqual([
			{ date: "2026-08-29", startTime: "09:00", focus: "Threshold intervals" },
		]);
	});
});

describe("eventFocus", () => {
	it("prefers the private focus property over title parsing", () => {
		const ev: CalendarEventSnapshot = {
			id: "x",
			summary: "🚴 Renamed by user",
			description: null,
			start: { dateTime: "2026-09-01T17:00:00", timeZone: TZ },
			end: { dateTime: "2026-09-01T18:00:00", timeZone: TZ },
			extendedProperties: {
				private: {
					[SYNC_KEY_PROP]: "2026-09-01T17:00|threshold intervals",
					[SYNC_FOCUS_PROP]: "Threshold intervals",
					[SYNC_STAMP_PROP]: String(NOW),
				},
			},
		};
		expect(eventFocus(ev)).toBe("Threshold intervals");
	});
});

describe("mergePlan — validation", () => {
	it("reports errors for invalid rows without aborting the rest", () => {
		const { result } = mergePlan(
			[
				workout({ date: "September 1" }),
				workout({ focus: "  " }),
				workout({ durationMinutes: 0 }),
				workout({ startTime: "25:99" }),
				workout(),
			],
			[],
			TZ,
			NOW,
		);
		expect(result.errors).toHaveLength(4);
		expect(result.created).toHaveLength(1);
	});

	it("rejects duplicate keys within one plan", () => {
		const { result } = mergePlan([workout(), workout()], [], TZ, NOW);
		expect(result.errors[0]).toContain("Duplicate workout");
		expect(result.created).toHaveLength(1);
	});
});

describe("filterRemovals", () => {
	const stamp = NOW - 60_000;
	const tue = appEvent("tue", "2026-09-01T17:00:00", stamp);
	const thu = appEvent("thu", "2026-09-03T09:00:00", stamp, {
		summary: "🚴 Recovery spin",
	});
	const edited = appEvent("edited", "2026-09-04T17:00:00", stamp, {
		summary: "🚴 Long ride",
		updated: new Date(NOW - 30_000).toISOString(),
	});
	const past = appEvent("past", "2026-08-25T17:00:00", stamp, {
		summary: "🚴 Recovery spin",
	});

	it("removes all future un-edited app events with no filters", () => {
		const { remove, skippedEdits } = filterRemovals(
			[tue, thu, edited, past],
			{ fromDate: null, toDate: null, focus: null },
			TZ,
			NOW,
		);
		expect(remove.map((e) => e.id)).toEqual(["tue", "thu"]);
		expect(skippedEdits).toBe(1);
	});

	it("applies date and focus filters", () => {
		const { remove } = filterRemovals(
			[tue, thu],
			{ fromDate: "2026-09-02", toDate: null, focus: null },
			TZ,
			NOW,
		);
		expect(remove.map((e) => e.id)).toEqual(["thu"]);

		const byFocus = filterRemovals(
			[tue, thu],
			{ fromDate: null, toDate: null, focus: "recovery" },
			TZ,
			NOW,
		);
		expect(byFocus.remove.map((e) => e.id)).toEqual(["thu"]);
	});
});
