import { db } from "../db.js";
import { env } from "../env.js";
import {
	type OAuth2Provider,
	type OAuth2TokenStore,
	type StoredToken,
	OAuth2Flow,
} from "./oauth2.js";

/**
 * Calendar connection domain module: the Google OAuth provider + token store,
 * and the per-user connection access (calendar id + training timezone) used
 * by the coach tools and system prompt. HTTP routes (routes/google.ts) are a
 * thin layer over this module.
 */

export interface GoogleTokenRow {
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	scope: string;
	calendar_id: string | null;
	tz: string | null;
}

function rowToToken(row: GoogleTokenRow): StoredToken {
	return {
		userId: row.user_id,
		accessToken: row.access_token,
		refreshToken: row.refresh_token,
		expiresAt: row.expires_at,
		providerUserId: null,
		scope: row.scope,
	};
}

const getTokenStmt = db.prepare<GoogleTokenRow, [string]>(
	`SELECT user_id, access_token, refresh_token, expires_at, scope, calendar_id, tz
   FROM google_tokens WHERE user_id = ?`,
);

/**
 * Re-consent flows don't return a new refresh token; keep the stored one
 * when Google withholds it instead of writing an empty string.
 */
const upsertTokenStmt = db.prepare(
	`INSERT INTO google_tokens
	   (user_id, access_token, refresh_token, expires_at, scope, updated_at)
	 VALUES (?, ?, ?, ?, ?, datetime('now'))
	 ON CONFLICT(user_id) DO UPDATE SET
	   access_token = excluded.access_token,
	   refresh_token = CASE WHEN excluded.refresh_token = ''
	                       THEN google_tokens.refresh_token
	                       ELSE excluded.refresh_token END,
	   expires_at = excluded.expires_at,
	   scope = excluded.scope,
	   updated_at = excluded.updated_at`,
);

const updateTokensStmt = db.prepare(
	`UPDATE google_tokens
	 SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
	 WHERE user_id = ?`,
);

const deleteTokenStmt = db.prepare(
	"DELETE FROM google_tokens WHERE user_id = ?",
);

export const googleTokenStore: OAuth2TokenStore = {
	get: (userId) => {
		const row = getTokenStmt.get(userId);
		return row ? rowToToken(row) : null;
	},
	// No provider-side user id in our model — Google sends no webhooks here.
	getByProviderUserId: () => null,
	upsert: (token) => {
		upsertTokenStmt.run(
			token.userId,
			token.accessToken,
			token.refreshToken,
			token.expiresAt,
			token.scope,
		);
	},
	updateTokens: (userId, accessToken, refreshToken, expiresAt) => {
		updateTokensStmt.run(accessToken, refreshToken, expiresAt, userId);
	},
	delete: (userId) => {
		deleteTokenStmt.run(userId);
	},
};

/** Google token revocation — kills the refresh token server-side. */
async function revokeGoogleToken(accessToken: string): Promise<void> {
	const res = await fetch("https://oauth2.googleapis.com/revoke", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token: accessToken }),
	});
	if (!res.ok) throw new Error(`Token revoke failed: ${res.status}`);
}

export const googleProvider: OAuth2Provider = {
	name: "google",
	authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenUrl: "https://oauth2.googleapis.com/token",
	clientId: env.GOOGLE_CLIENT_ID ?? "",
	clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
	redirectUri: env.GOOGLE_REDIRECT_URI ?? "",
	scope: "https://www.googleapis.com/auth/calendar",
	// offline = refresh token; consent = force it again on re-connect.
	extraAuthorizeParams: {
		access_type: "offline",
		prompt: "consent",
	},
	parseTokenResponse: (body) => {
		const b = body as {
			access_token: string;
			refresh_token?: string;
			expires_in: number;
			scope?: string;
		};
		return {
			accessToken: b.access_token,
			refreshToken: b.refresh_token ?? "",
			expiresAt: Math.floor(Date.now() / 1000) + b.expires_in,
			providerUserId: null,
			scope: b.scope ?? "",
		};
	},
	deauthorize: revokeGoogleToken,
};

export const googleFlow = new OAuth2Flow(googleProvider, googleTokenStore);

// ─── Connection metadata access ───────────────────────────────────────────────

export function getGoogleConnection(
	userId: string,
): { calendarId: string | null; tz: string | null } | null {
	const row = getTokenStmt.get(userId);
	if (!row) return null;
	return { calendarId: row.calendar_id, tz: row.tz };
}

/** Valid access token + connection metadata for calendar work. Throws when
 * the Calendar connection is missing or incomplete. */
export async function getCalendarContext(userId: string): Promise<{
	accessToken: string;
	calendarId: string;
	timezone: string;
}> {
	const connection = getGoogleConnection(userId);
	if (!connection?.calendarId || !connection.tz) {
		throw new Error("Google Calendar not connected");
	}
	const accessToken = await googleFlow.getValidToken(userId);
	return {
		accessToken,
		calendarId: connection.calendarId,
		timezone: connection.tz,
	};
}

/** Record (or clear) the connection's calendar id + training timezone. */
export function setConnectionMetadata(
	userId: string,
	calendarId: string | null,
	tz: string | null,
): void {
	db.prepare(
		"UPDATE google_tokens SET calendar_id = ?, tz = ?, updated_at = datetime('now') WHERE user_id = ?",
	).run(calendarId, tz, userId);
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
