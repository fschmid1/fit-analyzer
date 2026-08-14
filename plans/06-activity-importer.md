# Architecture Deepening: Activity Importer

Extract a shared import seam for Strava and Wahoo, eliminating duplicated post-import steps and giving each integration a thin adapter.

---

## Why

"Import a ride" is spread across two route files that duplicate the post-import scaffolding verbatim:
- Delete-then-insert (not transactional — a crash between loses the activity)
- `handleNewActivityForWaxedChainReminder` call
- `maybeUpdateAthleteLocation` call (duplicated verbatim, only the log prefix differs)

The Strava path additionally inlines stream-to-record converters (`buildRecords`, `buildSummary`, `buildLaps`, `stravaStreamToCadenceBySecond`, `stravaStreamToPowerBySecond`). The Wahoo path inlines biking detection (`isBikingWorkout` with a hardcoded 13-id set).

No shared import seam means every new integration (Garmin Connect? Zwift?) duplicates the entire scaffolding.

## Current state

**Strava:** `apps/server/src/routes/strava.ts` — `importSingleActivity(userId, stravaActivityId, accessToken)` (~200 LOC)
- Fetches activity + streams + laps from Strava API
- `buildRecords(startDate, streams)` — maps variable-rate streams → `StoredRecord[]`
- `buildSummary(activity, records, timeArr, wattsArr, cadenceArr)` — computes summary from raw streams (ignores Strava's pre-computed averages)
- `buildLaps(laps, timeArr)` — stream-index → elapsed-seconds
- `computePeakPower(timeArr, wattsArr, windowSecs)` — **third implementation** of peak power (see plan 08)
- Delete + insert via prepared statements
- `await handleNewActivityForWaxedChainReminder(userId, records)`
- `maybeUpdateAthleteLocation(userId)` — **duplicated verbatim** from wahoo.ts

**Wahoo:** `apps/server/src/routes/wahoo.ts` — `importWorkout(userId, workout)` (~80 LOC)
- `isBikingWorkout(workout)` — `workout_type_family_id` or hardcoded `BIKING_WORKOUT_TYPE_IDS` Set (13 ids)
- Downloads FIT from `workout_summary.file.url` (unauthenticated CDN)
- `parseFit(arrayBuffer)` from shared
- Converts `ActivityRecord[]` → `StoredRecord[]` (Date → ISO string)
- Delete + insert via prepared statements
- `await handleNewActivityForWaxedChainReminder(userId, records)`
- `maybeUpdateAthleteLocation(userId)` — **duplicated verbatim** from strava.ts

## Target

**New file:** `apps/server/src/lib/activityImporter.ts`

**Interface:**
```typescript
interface ImportPayload {
  source: "strava" | "wahoo" | "fit-upload";
  sourceActivityId: string;
  records: StoredRecord[];
  summary: ActivitySummary;
  laps: LapMarker[];
  userId: string;
}

interface ImportResult {
  status: "imported" | "updated" | "skipped";
}

async function importActivity(payload: ImportPayload): Promise<ImportResult>;
```

**Implementation absorbs:**
- Delete-then-insert (should be wrapped in a transaction — correctness fix)
- `handleNewActivityForWaxedChainReminder` call
- `maybeUpdateAthleteLocation` call (moves here, deleted from both routes)
- Duplicate detection via `source` + `sourceActivityId` columns

**Becomes adapters:**
- `stravaImportAdapter` — fetches Strava activity/streams/laps, transforms to `ImportPayload` (absorbs `buildRecords`, `buildSummary`, `buildLaps`)
- `wahooImportAdapter` — fetches workout, downloads FIT, `parseFit`, transforms to `ImportPayload` (absorbs `isBikingWorkout`, Date→ISO conversion)
- FIT upload path in `routes/activities.ts` — already has the payload shape, just calls `importActivity` directly

## What tests survive

The importer's interface is pure: a normalized payload in, a result out.

- **Import:** insert a payload → assert row exists with correct source tag
- **Re-import (update):** import same `sourceActivityId` → assert delete+insert, row has new data
- **Re-import (skip):** import with same content → assert `skipped`
- **Side effects:** assert `handleNewActivityForWaxedChainReminder` and `maybeUpdateAthleteLocation` are called (with injected fakes)
- **Transaction safety:** simulate a crash between delete and insert → assert no data loss (after transaction wrapping)

Adapter tests:
- **Strava adapter:** mock Strava API responses → assert correct `ImportPayload` (records, summary, laps)
- **Wahoo adapter:** mock Wahoo API + FIT download → assert correct `ImportPayload`
- **Biking filter:** `isBikingWorkout` with various `workout_type_id` / `workout_type_family_id` combos

## Files to touch

- `apps/server/src/lib/activityImporter.ts` (new)
- `apps/server/src/lib/stravaImportAdapter.ts` (new — absorbs build* functions from route)
- `apps/server/src/lib/wahooImportAdapter.ts` (new — absorbs isBikingWorkout, FIT download)
- `apps/server/src/routes/strava.ts` (remove ~200 LOC, replace with adapter + `importActivity`)
- `apps/server/src/routes/wahoo.ts` (remove ~80 LOC, replace with adapter + `importActivity`)
- `apps/server/src/routes/activities.ts` (FIT upload path calls `importActivity`)
- `apps/server/src/lib/activityImporter.test.ts` (new)

## Dependencies

- Blocked by: none (can start independently)
- Related: plan 06 (OAuth2 unification — the adapters become thinner once OAuth is shared), plan 08 (peak power consolidation — Strava adapter delegates to shared impl)

## Effort

~1 session. The transform logic already exists; this is extraction + transaction wrapping + first tests.