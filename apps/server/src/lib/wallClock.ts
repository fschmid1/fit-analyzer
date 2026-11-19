/**
 * Wall-clock helpers shared by every plan target and the importers. All plan
 * comparisons are wall-clock in the athlete's training timezone: a plan event's
 * local start string is the truth, so no IANA math is needed once the string is
 * sliced. Imports compare wall-clock too, because a ride's stored timestamp may
 * be UTC (Strava) or local (intervals.icu).
 */

/** Current wall-clock minute "YYYY-MM-DDTHH:MM" in the given timezone. */
export function wallClockMinute(now: Date, timezone: string): string {
	const parts = wallClockParts(now, timezone);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The wall-clock instant as epoch milliseconds (timezone offset removed). */
export function wallClockMs(now: Date, timezone: string): number {
	const p = wallClockParts(now, timezone);
	return Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		Number(p.hour),
		Number(p.minute),
		Number(p.second),
	);
}

function wallClockParts(now: Date, timezone: string) {
	const fmt = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const get = (type: Intl.DateTimeFormatPartTypes): string =>
		fmt.formatToParts(now).find((p) => p.type === type)?.value ?? "";
	return {
		year: get("year"),
		month: get("month"),
		day: get("day"),
		hour: get("hour"),
		minute: get("minute"),
		second: get("second"),
	};
}

/**
 * The UTC instant of a wall-clock date-time in a timezone — the inverse of
 * `wallClockMs`. intervals.icu reports `start_date_local` without an offset, so
 * importers need this to store the same real instant Strava and FIT files
 * already store.
 */
export function wallClockToInstant(
	localDateTime: string,
	timezone: string,
): Date | null {
	const naive = Date.parse(`${localDateTime.slice(0, 19)}Z`);
	if (!Number.isFinite(naive)) return null;
	const offsetAt = (ms: number) => wallClockMs(new Date(ms), timezone) - ms;
	const guess = naive - offsetAt(naive);
	// Re-evaluate once: around a DST boundary the offset at the guessed instant
	// can differ from the offset at the naive one.
	const corrected = naive - offsetAt(guess);
	return new Date(corrected);
}

/** Best-effort IANA timezone check — Intl throws on unknown zones. */
export function isValidTimezone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}
