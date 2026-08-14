# Architecture Deepening: Persistence Seam

Extract per-concern repository modules from the route files and lib files that currently prepare SQL statements directly against the `db` singleton.

---

## Why

Every route and lib module reaches directly into `db` to prepare SQL statements. SQL is inlined in route handlers. `getUserId(c)` is copy-pasted 8×. No module can be tested without a real SQLite file.

**SQL inlined in routes:**
- `trainer.ts` — ~14 prepared statements (threads, messages, activity analysis)
- `strava.ts` — disconnect: `db.prepare("DELETE FROM strava_tokens WHERE user_id = ?").run(userId)`
- `wahoo.ts` — disconnect: `db.prepare("DELETE FROM wahoo_tokens WHERE user_id = ?").run(userId)`
- `me.ts` — `owUserId` upsert, `healthSource` upsert, `SELECT health_source` (3 inline SQL statements)
- `healthAutoExport.ts` — `SELECT health_source`, `generate-key` upsert
- `activities.ts` — 6 prepared statements (list, get, insert, update intervals, update summary, delete)

**SQL in lib files:**
- `trainerStreamRegistry.ts` — `updateContextTokensStmt` (context-token persistence leaks into stream plumbing)
- `haeClient.ts` — 6 prepared statements
- `owClient.ts` — reads `user_settings.ow_user_id`
- `athleteStats.ts` — 3 prepared statements
- `athleteProfile.ts` — 8 upsert statements (one per field)
- `compareSettings.ts` — inlines a `trainer_chats` SELECT (hidden cross-concern coupling)
- `favoriteModels.ts`, `coachModelSettings.ts`, `waxedChainReminders.ts` — each prepares own statements

**`getUserId(c)` duplicated in:** activities, health, healthAutoExport, heatmap, me, strava, trainer, wahoo (8 copies).

## Current state

**`db.ts`** (385 LOC):
- Opens SQLite, sets WAL/FK
- `CREATE TABLE IF NOT EXISTS` for 7 tables
- ~30 `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch (no version table, no ordering guarantee, silent on failure)
- One-time JSON-blob→rows migration for legacy trainer chats
- Exports just `db` — no schema, no migration API, no repository

**`user_settings` is a god-table:** 20+ columns spanning waxed-chain, coach model, favorites, compare, HAE, athlete profile (ftp, maxHr, goals, focus areas, location).

## Target

### Phase 1: Shared auth + settings repo

**New file:** `apps/server/src/lib/getUserId.ts`
```typescript
function getUserId(c: Context): string;
```
Used by all 8 routes. Delete 8 copies.

**New file:** `apps/server/src/lib/settingsRepo.ts`
```typescript
interface SettingsRepo {
  getHealthSource(userId: string): Promise<HealthSource>;
  setHealthSource(userId: string, source: HealthSource): Promise<void>;
  getOwUserId(userId: string): Promise<string | null>;
  setOwUserId(userId: string, owUserId: string): Promise<void>;
  getHaeToken(userId: string): Promise<string | null>;
  setHaeToken(userId: string, token: string): Promise<void>;
  clearHaeToken(userId: string): Promise<void>;
  // ... per-concern getters/setters
}
```
Absorbs inline SQL from `me.ts`, `healthAutoExport.ts`, `owClient.ts`, `haeClient.ts`.

### Phase 2: Per-concern repos

**New file:** `apps/server/src/lib/threadRepo.ts`
```typescript
interface ThreadRepo {
  listByActivity(userId: string, activityId: string): Promise<TrainerThread[]>;
  getById(userId: string, threadId: string): Promise<TrainerThread | null>;
  create(userId: string, activityId: string, name?: string): Promise<TrainerThread>;
  rename(userId: string, threadId: string, name: string): Promise<void>;
  updateModel(userId: string, threadId: string, model: string): Promise<void>;
  updateContextTokens(userId: string, threadId: string, tokens: number): Promise<void>;
  delete(userId: string, threadId: string): Promise<void>;
  touch(userId: string, threadId: string): Promise<void>;
}
```

**New file:** `apps/server/src/lib/messageRepo.ts`
```typescript
interface MessageRepo {
  getPaginated(threadId: string, cursor?: string, limit?: number): Promise<{messages, nextCursor, hasMore, total}>;
  getAll(threadId: string): Promise<TrainerMessage[]>;
  getLatest(threadId: string, count: number): Promise<TrainerMessage[]>;
  replaceAll(threadId: string, messages: TrainerMessage[]): Promise<void>;
  insert(threadId: string, message: TrainerMessage): Promise<void>;
  deleteAll(threadId: string): Promise<void>;
}
```

**New file:** `apps/server/src/lib/activityRepo.ts`
```typescript
interface ActivityRepo {
  list(userId: string): Promise<ActivityListItem[]>;
  getById(userId: string, id: string): Promise<StoredActivity | null>;
  create(userId: string, activity: CreateActivityBody): Promise<StoredActivity>;
  updateIntervals(userId: string, id: string, intervals: Interval[]): Promise<void>;
  updateSummary(userId: string, id: string, summary: ActivitySummary): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
  getBySourceActivityId(userId: string, source: string, sourceId: string): Promise<StoredActivity | null>;
}
```

**New file:** `apps/server/src/lib/tokenRepo.ts`
```typescript
interface TokenRepo {
  getStravaToken(userId: string): Promise<StoredStravaToken | null>;
  upsertStravaToken(userId: string, token: StoredStravaToken): Promise<void>;
  deleteStravaToken(userId: string): Promise<void>;
  getWahooToken(userId: string): Promise<StoredWahooToken | null>;
  upsertWahooToken(userId: string, token: StoredWahooToken): Promise<void>;
  deleteWahooToken(userId: string): Promise<void>;
  setWahooWebhookEnabled(userId: string, enabled: boolean): Promise<void>;
}
```

### Phase 3: `trainerStreamRegistry` decoupling

`trainerStreamRegistry.ts` currently prepares `updateContextTokensStmt` to persist `lastPromptTokens`. After extracting `threadRepo`, the registry calls `threadRepo.updateContextTokens` instead of preparing its own statement. The registry becomes pure plumbing.

### Phase 4: Migration framework

**`db.ts` changes:**
- Add a `schema_version` table + ordered migrations
- Remove silent try/catch — migrations should fail loudly
- Export a `migrate()` function called at boot

## What tests survive

- **Thread repo:** in-memory SQLite → create, list, rename, delete — assert correct state
- **Message repo:** in-memory SQLite → insert, paginate, replace-all — assert cursor logic, total count
- **Activity repo:** in-memory SQLite → create, get-by-source-id, update-intervals — assert source tags
- **Token repo:** in-memory SQLite → upsert, refresh-token preservation (COALESCE), webhook flag
- **Settings repo:** in-memory SQLite → get/set per field, default fallbacks
- **Routes:** inject fake repos → assert correct calls, no SQL in route handlers

## Files to touch

Phase 1:
- `apps/server/src/lib/getUserId.ts` (new — 1 function)
- `apps/server/src/lib/settingsRepo.ts` (new)
- All 8 route files (replace inline `getUserId` + inline settings SQL)

Phase 2:
- `apps/server/src/lib/threadRepo.ts` (new)
- `apps/server/src/lib/messageRepo.ts` (new)
- `apps/server/src/lib/activityRepo.ts` (new)
- `apps/server/src/lib/tokenRepo.ts` (new)
- `apps/server/src/routes/trainer.ts` (remove ~14 SQL statements, inject repos)
- `apps/server/src/routes/activities.ts` (remove 6 SQL statements, inject repos)
- `apps/server/src/routes/strava.ts` (remove token SQL, inject `tokenRepo`)
- `apps/server/src/routes/wahoo.ts` (remove token SQL, inject `tokenRepo`)

Phase 3:
- `apps/server/src/lib/trainerStreamRegistry.ts` (remove `updateContextTokensStmt`, inject `threadRepo`)

Phase 4:
- `apps/server/src/db.ts` (add migration framework, remove silent catches)

## Dependencies

- Blocked by: none (Phase 1 can start immediately)
- Blocks: none (each phase is independently shippable)
- Related: plan 04 (trainer god-module — thread repo + message repo are the trainer-specific instances), plan 07 (OAuth2 — token repo backs the token stores)

## Effort

Phase 1: ~0.5 session (getUserId + settings repo).
Phase 2: ~1.5 sessions (4 repos + route refactoring).
Phase 3: ~0.25 session.
Phase 4: ~0.5 session.
Total: ~2.5 sessions.