# Architecture Deepening: OAuth2 Integration Module

Unify the Strava and Wahoo OAuth2 flows behind a shared core with provider adapters, eliminating ~200 LOC of duplication.

---

## Why

Strava and Wahoo share the same OAuth2 flow shape — connect, state store, callback, token exchange, refresh, status, webhook register/unregister — but each route inlines its own copy:

**Duplicated verbatim across `strava.ts` and `wahoo.ts`:**
- `pendingStates` Map + `PendingState` interface + `pruneStates()` (in-memory, process-local — lost on restart; users mid-OAuth get an error)
- `getUserId(c)` — **also duplicated in 6 other route files** (8 total copies)
- `maybeUpdateAthleteLocation(userId)` — byte-identical except `[strava]`/`[wahoo]` log prefix
- Token exchange + token refresh + token row upsert (same structure, different URLs/scopes)
- Webhook register/unregister (same structure, different API endpoints)

Two adapters justify the seam: HTTP in prod, in-memory in tests.

## Current state

**Strava:** `apps/server/src/routes/strava.ts` (1272 LOC)
- `GET /connect` — builds OAuth URL, stores state → userId in `pendingStates`
- `GET /callback` — validates state, exchanges code, fetches athlete, upserts token
- `GET /status` — returns `{connected, ...}` from DB
- `DELETE /disconnect` — deauthorizes via API, deletes token row
- `POST /sync` — paginates activities, calls `importSingleActivity`
- `POST /webhook` — background-imports `activity:create` events
- `POST /webhook/subscription`, `DELETE /webhook/subscription`
- `getValidToken(userId)` — refreshes if within 60s of expiry
- `exchangeStravaTokenWithBunFetch`
- `eventsCache` Map (5-min TTL) + `fetchAllEventsFromStrava` + `paginateEvents`

**Wahoo:** `apps/server/src/routes/wahoo.ts` (855 LOC)
- Same route structure with Wahoo-specific URLs/scopes
- `importWorkout` with webhook backoff polling `[15s, 30s, 60s, 120s, 120s, 60s]`
- `BIKING_WORKOUT_TYPE_IDS` Set (13 ids)
- `isBikingWorkout(workout)`

## Target

**New file:** `apps/server/src/lib/oauth2.ts`

**Interface:**
```typescript
interface OAuth2Provider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  // Provider-specific parsing
  parseTokenResponse(body: unknown): { accessToken, refreshToken, expiresAt, providerUserId? };
  parseAuthorizeUser(body: unknown): { providerUserId: string };
  deauthorizeUrl?: string;
}

interface OAuth2TokenStore {
  getToken(userId: string): Promise<StoredToken | null>;
  upsertToken(userId: string, token: StoredToken): Promise<void>;
  deleteToken(userId: string): Promise<void>;
}

class OAuth2Flow {
  constructor(provider: OAuth2Provider, tokenStore: OAuth2TokenStore);
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenResponse>;
  refreshToken(token: StoredToken): Promise<TokenResponse>;
  getValidToken(userId: string): Promise<string>;
  deauthorize(userId: string): Promise<void>;
}
```

**New file:** `apps/server/src/lib/oauthStateStore.ts`
- `createState(userId)` → state string, stored in db (survives restart)
- `consumeState(state)` → userId | null
- Replaces both in-memory `pendingStates` Maps

**Becomes adapters:**
- `stravaProvider` — Strava URLs, scopes, token parsing, athlete fetch
- `wahooProvider` — Wahoo URLs, scopes, token parsing, user fetch
- `stravaTokenStore` / `wahooTokenStore` — db-backed token repositories (part of plan 09)

**Routes shrink to:**
- Connect: `flow.buildAuthorizeUrl(state)` + redirect
- Callback: `consumeState(state)` + `flow.exchangeCode(code)` + `tokenStore.upsertToken`
- Status: `tokenStore.getToken(userId)` + shape response
- Disconnect: `flow.deauthorize(userId)` + `tokenStore.deleteToken(userId)`
- Sync: `flow.getValidToken(userId)` + provider-specific fetch loop → `importActivity` (plan 06)
- Webhook: provider-specific event handling → `importActivity`

## What tests survive

- **State store:** create → consume → null on second consume; survives across instances if db-backed
- **Token exchange:** mock fetch → assert correct URL, body, response parsing
- **Token refresh:** expired token → assert refresh call, new token persisted
- **Provider adapter:** `parseTokenResponse` with various response shapes — assert correct extraction
- **getValidToken:** unexpired → returns access token; expired → refreshes → returns new token; no token → throws

All testable with a fake `OAuth2Provider` + in-memory `OAuth2TokenStore`.

## Files to touch

- `apps/server/src/lib/oauth2.ts` (new)
- `apps/server/src/lib/oauthStateStore.ts` (new)
- `apps/server/src/routes/strava.ts` (remove ~400 LOC of OAuth scaffolding, keep Strava-specific sync/webhook/events)
- `apps/server/src/routes/wahoo.ts` (remove ~350 LOC of OAuth scaffolding, keep Wahoo-specific webhook polling)
- `apps/server/src/lib/getUserId.ts` (new — shared auth helper, used by all 8 routes)
- `apps/server/src/lib/oauth2.test.ts` (new)

## Dependencies

- Blocked by: none (can start independently)
- Related: plan 06 (activity importer — the sync path delegates to it), plan 09 (persistence seam — token stores become repos)
- Note: `maybeUpdateAthleteLocation` moves to the activity importer (plan 06), not here

## Effort

~1 session. The OAuth logic already exists; this is extraction + state-store hardening + first tests.