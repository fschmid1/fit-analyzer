/**
 * Google Calendar REST access for the training calendar. Every API path in
 * this module takes an access token supplied by the OAuth flow — no token
 * logic lives here. One-segment API: each call returns typed data or throws
 * with context; the sync routes/tools translate errors into tool errors.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarListEntry {
	id: string;
	summary: string;
}

export interface GoogleEventInput {
	summary: string;
	description: string | null;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	colorId: string;
	extendedProperties: { private: Record<string, string> };
}

export interface GoogleEvent {
	id: string;
	summary?: string;
	description?: string;
	start?: { dateTime?: string; date?: string; timeZone?: string };
	end?: { dateTime?: string; date?: string; timeZone?: string };
	updated?: string;
	colorId?: string;
	extendedProperties?: { private?: Record<string, string> };
	status?: string;
}

async function googleFetch(
	path: string,
	accessToken: string,
	init?: RequestInit,
): Promise<Response> {
	const res = await fetch(`${CALENDAR_API}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(
			`Google Calendar ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 300)}`,
		);
	}
	return res;
}

/** Find the app's Training calendar in the user's calendar list, if present. */
export async function findTrainingCalendar(
	accessToken: string,
): Promise<GoogleCalendarListEntry | null> {
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({ minAccessRole: "owner" });
		if (pageToken) params.set("pageToken", pageToken);
		const res = await googleFetch(
			`/users/me/calendarList?${params}`,
			accessToken,
		);
		const data = (await res.json()) as {
			items?: GoogleCalendarListEntry[];
			nextPageToken?: string;
		};
		const hit = data.items?.find((cal) => cal.summary === "Training");
		if (hit) return hit;
		pageToken = data.nextPageToken;
	} while (pageToken);
	return null;
}

/** Create the dedicated Training calendar. */
export async function createTrainingCalendar(
	accessToken: string,
	timezone: string,
): Promise<GoogleCalendarListEntry> {
	const res = await googleFetch("/calendars", accessToken, {
		method: "POST",
		body: JSON.stringify({
			summary: "Training",
			description: "Planned workouts scheduled by the fit-analyzer coach.",
			timeZone: timezone,
		}),
	});
	return (await res.json()) as GoogleCalendarListEntry;
}

/** Find-or-create the Training calendar; returns its id. */
export async function ensureTrainingCalendar(
	accessToken: string,
	timezone: string,
): Promise<{ calendarId: string; created: boolean }> {
	const existing = await findTrainingCalendar(accessToken);
	if (existing) return { calendarId: existing.id, created: false };
	const created = await createTrainingCalendar(accessToken, timezone);
	return { calendarId: created.id, created: true };
}

/**
 * List future events on the training calendar, ordered by start time.
 * Returns only non-cancelled events with the fields the sync engine needs.
 */
export async function listUpcomingEvents(
	accessToken: string,
	calendarId: string,
): Promise<GoogleEvent[]> {
	const events: GoogleEvent[] = [];
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({
			timeMin: new Date().toISOString(),
			singleEvents: "true",
			orderBy: "startTime",
			maxResults: "250",
			fields:
				"items(id,summary,description,start,end,updated,colorId,extendedProperties),nextPageToken",
		});
		if (pageToken) params.set("pageToken", pageToken);
		const res = await googleFetch(
			`/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
			accessToken,
		);
		const data = (await res.json()) as {
			items?: GoogleEvent[];
			nextPageToken?: string;
		};
		events.push(...(data.items ?? []));
		pageToken = data.nextPageToken;
	} while (pageToken);
	return events.filter((ev) => ev.status !== "cancelled");
}

export async function insertEvent(
	accessToken: string,
	calendarId: string,
	event: GoogleEventInput,
): Promise<void> {
	await googleFetch(
		`/calendars/${encodeURIComponent(calendarId)}/events`,
		accessToken,
		{ method: "POST", body: JSON.stringify(event) },
	);
}

export async function patchEvent(
	accessToken: string,
	calendarId: string,
	eventId: string,
	event: Partial<GoogleEventInput>,
): Promise<void> {
	await googleFetch(
		`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
		accessToken,
		{ method: "PATCH", body: JSON.stringify(event) },
	);
}

export async function deleteEvent(
	accessToken: string,
	calendarId: string,
	eventId: string,
): Promise<void> {
	await googleFetch(
		`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
		accessToken,
		{ method: "DELETE" },
	);
}
