import { db } from "../db.js";

/**
 * Persistent OAuth2 CSRF state store.
 *
 * Both the Strava and Wahoo flows previously kept `pendingStates` in an
 * in-memory Map. That state was process-local: any restart (deploy, crash,
 * Bun --watch reload) dropped it, so a user who completed OAuth on the
 * provider while the server was mid-restart hit "invalid state" on callback.
 *
 * This module moves the state into SQLite so it survives restarts. Each
 * state is scoped to a provider (`strava` | `wahoo`) so a Strava state
 * can't be replayed against the Wahoo callback (or vice versa).
 *
 * States expire after 10 minutes (matching the previous in-memory TTL) and
 * are pruned opportunistically on every create.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

const insertStateStmt = db.prepare(
	`INSERT OR REPLACE INTO oauth_states (state, provider, user_id, expires_at)
   VALUES (?, ?, ?, ?)`,
);

/**
 * Atomically delete a state and return its row in one statement, so two
 * concurrent callbacks for the same state can't both succeed (SQLite serializes
 * the DELETE; only one gets the row back).
 */
const consumeStateStmt = db.prepare<
	{ user_id: string; expires_at: number },
	[string, string, number]
>(
	`DELETE FROM oauth_states
	  WHERE state = ? AND provider = ? AND expires_at > ?
	  RETURNING user_id, expires_at`,
);

const pruneExpiredStmt = db.prepare(
	"DELETE FROM oauth_states WHERE expires_at < ?",
);

export interface OAuthStateStore {
	create(provider: string, userId: string): string;
	consume(provider: string, state: string): string | null;
}

/**
 * Create a fresh state token for `userId`, persist it, and return it.
 * Expired states are pruned opportunistically to avoid unbounded growth.
 */
function create(provider: string, userId: string): string {
	const now = Date.now();
	pruneExpiredStmt.run(now);
	const state = crypto.randomUUID();
	const expiresAt = now + STATE_TTL_MS;
	insertStateStmt.run(state, provider, userId, expiresAt);
	return state;
}

/**
 * Atomically consume a state: DELETE … RETURNING removes the row and returns
 * it in one statement, so a state can only be consumed once even under
 * concurrent callbacks. Returns the userId, or null if the state is unknown
 * or already expired (the `expires_at > ?` predicate rejects expired rows
 * in the same statement, so expired states are consumed-and-discarded).
 */
function consume(provider: string, state: string): string | null {
	const row = consumeStateStmt.get(state, provider, Date.now());
	return row?.user_id ?? null;
}

export const oauthStateStore: OAuthStateStore = { create, consume };

// ─── Provider-scoped callback metadata ────────────────────────────────────────

/**
 * Small side-channel for data the browser captures before the flow starts
 * (e.g. the training timezone for Google) but the OAuth callback carries in a
 * separate round-trip. Keyed by the state token, TTL'd like the states
 * themselves, and consumed independently of the CSRF state.
 */
export function setOAuthStateMeta(
	state: string,
	key: string,
	value: string,
): void {
	const now = Date.now();
	db.prepare("DELETE FROM oauth_state_meta WHERE expires_at < ?").run(now);
	db.prepare(
		"INSERT OR REPLACE INTO oauth_state_meta (state, key, value, expires_at) VALUES (?, ?, ?, ?)",
	).run(state, key, value, now + STATE_TTL_MS);
}

export function consumeOAuthStateMeta(
	state: string,
	key: string,
): string | null {
	const row = db
		.prepare<{ value: string }, [string, string, number]>(
			"DELETE FROM oauth_state_meta WHERE state = ? AND key = ? AND expires_at > ? RETURNING value",
		)
		.get(state, key, Date.now());
	return row?.value ?? null;
}
