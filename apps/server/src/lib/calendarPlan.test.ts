import { describe, expect, it } from "bun:test";
import {
	SYNC_FOCUS_PROP,
	SYNC_KEY_PROP,
	SYNC_STAMP_PROP,
	toPlanWorkout,
	type CalendarEventSnapshot,
} from "./googleCalendarSync.js";

const TZ = "Europe/Zurich";
const NOW = new Date("2026-09-30T10:00:00Z"); // 12:00 Zurich

function appEvent(
	startDateTime: string,
	overrides: Partial<CalendarEventSnapshot> = {},
): CalendarEventSnapshot {
	return {
		id: `ev-${startDateTime}`,
		summary: "🚴 Threshold intervals",
		description: "3x10 min",
		start: { dateTime: startDateTime, timeZone: TZ },
		end: { dateTime: startDateTime.replace("T17:00", "T18:00"), timeZone: TZ },
		updated: new Date(NOW.getTime()).toISOString(),
		colorId: "7",
		extendedProperties: {
			private: {
				[SYNC_KEY_PROP]: `${startDateTime.slice(0, 10)}T17:00|threshold intervals`,
				[SYNC_FOCUS_PROP]: "Threshold intervals",
				[SYNC_STAMP_PROP]: String(NOW.getTime()),
			},
		},
		...overrides,
	};
}

describe("toPlanWorkout", () => {
	it("projects an app-owned future event", () => {
		const w = toPlanWorkout(appEvent("2026-10-01T17:00:00"), TZ, NOW);
		expect(w).toEqual({
			id: "ev-2026-10-01T17:00:00",
			date: "2026-10-01",
			startTime: "17:00",
			durationMinutes: 60,
			focus: "Threshold intervals",
			description: "3x10 min",
			edited: false,
		});
	});

	it("drops events that already started", () => {
		expect(toPlanWorkout(appEvent("2026-09-30T11:00:00"), TZ, NOW)).toBeNull();
	});

	it("falls back to the event summary when not app-owned", () => {
		const w = toPlanWorkout(
			appEvent("2026-10-01T17:00:00", {
				summary: "Dentist",
				extendedProperties: undefined,
			}),
			TZ,
			NOW,
		);
		expect(w?.focus).toBe("Dentist");
	});

	it("flags events edited after the last sync stamp", () => {
		const w = toPlanWorkout(
			appEvent("2026-10-01T17:00:00", {
				updated: new Date(NOW.getTime() + 60_000).toISOString(),
			}),
			TZ,
			NOW,
		);
		expect(w?.edited).toBe(true);
	});

	it("returns null when the event has no timed start", () => {
		expect(
			toPlanWorkout(
				appEvent("2026-10-01T17:00:00", { start: { date: "2026-10-01" } }),
				TZ,
				NOW,
			),
		).toBeNull();
	});
});
