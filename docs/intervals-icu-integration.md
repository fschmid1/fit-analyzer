# intervals.icu integration — design

Companion to [ADR-0005](adr/0005-one-plan-many-targets.md) and
[ADR-0006](adr/0006-cross-training-sessions-are-not-activities.md). This is the
implementation map: which module owns what, how a plan reaches two targets, and
what happens when a provider fails.

## Shape

```
coach chat / weekly refresh
        │  sync_training_plan(workouts[])
        ▼
apps/server/src/lib/tools/planSync.ts      tool definitions, arg parsing
        ▼
apps/server/src/lib/planTargets.ts         fan-out, primary target, adapters
        ├── googleCalendarSync.ts          pure Google merge/removal
        ├── googleCalendarClient.ts        Google REST
        ├── intervalsIcuPlanSync.ts        pure ICU merge/removal/projection
        └── intervalsIcuClient.ts          ICU REST
```

`readTrainingPlan` (`trainingPlan.ts`) projects the **primary** target back to
`PlanWorkout[]` for `/api/plan` and the coach prompt. Nothing is persisted
except the target's own events and `plan_sync_marks`.

### Modules

| File | Owns |
| --- | --- |
| `packages/shared/src/workoutPlan.ts` | Neutral step model, normalization, rendering, defaults |
| `lib/planSyncCore.ts` | Shared plan validation, sync key, display row, event window |
| `lib/planTargets.ts` | Connected targets, primary choice, per-target sync/removal |
| `lib/planGuidance.ts` | The single coach guidance block (chat + refresh) |
| `lib/trainingPlan.ts` | Read-back projection, prompt formatting, read-only context |
| `lib/intervalsIcuClient.ts` | Athlete, events, bulk upsert/delete, activities, streams |
| `lib/intervalsIcuPlanSync.ts` | `workout_doc`, ICU merge, edit detection |
| `lib/intervalsIcuConnection.ts` | Key storage, poll/backfill bookkeeping |
| `lib/intervalsIcuImporter.ts` | Five-minute poll, opt-in backfill, notifications |
| `lib/intervalsIcuImportAdapter.ts` | Ride → records/summary, ride filter |
| `lib/intervalsIcuSessionAdapter.ts` | Non-ride activity → cross-training summary |
| `lib/crossTrainingSessionRepo.ts` | Summary-only session storage and reads |
| `lib/activityImporter.ts` | Shared import, same-ride dedupe |
| `lib/rideSummary.ts` | Summary from records (shared by all importers) |
| `lib/planSyncMarks.ts` | Write marks for targets without event metadata |
| `lib/trainingTimezone.ts` | Athlete timezone (`user_settings`) |
| `routes/plan.ts` | `GET /api/plan`, `POST /api/plan/refresh` |
| `routes/intervalsIcu.ts` | status, connect, disconnect, sync-now |
| `routes/sessions.ts` | `GET /api/sessions` (cross-training history) |

## Plan write

1. The tool parses and validates `workouts` (date, focus, duration, sport,
   steps) and rejects the whole call on a bad row. A workout's sport is `Ride`
   by default; strength and other cross-training are supported as prose, while
   structured steps are accepted only for the endurance sports.
2. `syncPlanAcrossTargets` lists connected targets and fans out in parallel.
   Each target gets `respectEdits = primary`.
3. The pure merge diffs the plan against the target's future events by **sync
   key** (`dateTtime|focus`), never by provider id:
   - plan entries upsert; unchanged entries are skipped;
   - our future entries absent from the plan are removed;
   - entries whose start is at or before now are `notScheduled` and untouched;
   - on the primary, an entry updated after our last write is skipped;
   - on a projection, the same entry is overwritten and reported.
4. The result is per target: `created / updated / deleted / skipped /
   overwritten / notScheduled / errors`, plus an aggregated `errors` list.

### intervals.icu identity

`uid = "fit-analyzer|<sync key>"`. `upsertOnUid` updates in place; any event
without the prefix belongs to the athlete (race, note, own workout) and is
never touched. Because intervals.icu has no extended properties, the server
records `plan_sync_marks(user_id, target, sync_key, written_at)` and compares
`event.updated` against it (with a 60 s write skew) to detect athlete edits.

## Activity import

```
poll (5 min) ───┐
Sync now ───────┼─► listIntervalsIcuActivities(range)
backfill (90 d) ┘        │
                         ▼
              Strava-sourced? ──yes──► skip (stub + terms)
                         │no
              isIntervalsIcuRide?
                 │yes                    │no
                 ▼                       ▼
     fetchIntervalsIcuStreams     intervalsIcuSessionFromActivity
                 │                       │
     buildRecordsFromStreams             ▼
     → summarizeRideRecords        cross_training_sessions (summary only)
                 │                       │
                 ▼                       ▼
          importActivity(db)       coach context, history, training load
```

- **Rides** become Activities: `time`, `watts`, `heartrate`, `cadence`,
  `velocity_smooth`, `grade_smooth`, `latlng`, `distance` are requested;
  everything else is derived locally.
- **Every other completed activity** becomes a Cross-training session: the
  summary intervals.icu reports, no streams. `cross_training_sessions` is a separate
  table on purpose (ADR-0006); rides keep their single meaning.
- `date` comes from `start_date_local`; the dedupe start comes from
  `records[0].timestamp`.
- Same-ride dedupe: same wall-clock start ±2 min (training timezone) and a
  duration within `max(120 s, 3%)`; then the intervals.icu id is stamped on the
  existing row and nothing is inserted.
- Sessions upsert by `(user, source, source activity id)`: a re-seen session is
  skipped unless the provider changed it.
- The backfill runs in 14-day chunks, records progress after each chunk, and
  never blocks a poll (the poller skips a user while a backfill runs).

## Failure semantics

| Failure | Behaviour |
| --- | --- |
| One activity fails to import | Counted, logged, pass continues; the pass counts as failed for the streak |
| One session fails to import | Counted like a ride; the pass continues |
| Activity list fails | The poll counts as failed |
| `401`/`403` | `key_valid = 0`; poller stops for that user; Settings shows "Key rejected"; the target is treated as disconnected for plan sync |
| 3 consecutive failed polls | One ntfy notification, once per streak; success resets the streak |
| Backfill chunk fails | Recorded, backfill continues, final status `error` with first message |
| Sync write fails | Per-target error in the tool card; other target still runs; only writes the API confirmed are reported as created/updated |
| Weekly refresh write fails | Watermark stays unadvanced, so the next hourly tick retries (capped per week) |
| Started workout | Never touched on any target |
| Disconnect | Key and marks forgotten; events stay |

## API

| Route | Purpose |
| --- | --- |
| `GET /api/intervals-icu/status` | Connection, key state, backfill progress, last sync |
| `POST /api/intervals-icu/connect` | Verify + store key, set timezone, optional backfill |
| `DELETE /api/intervals-icu/disconnect` | Forget key, clear marks, leave events |
| `POST /api/intervals-icu/sync` | Import the last 90 days now |
| `GET /api/sessions` | Cross-training sessions, newest first |
| `GET /api/plan` | Forward plan from the primary target |
| `POST /api/plan/refresh` | Run a weekly refresh on demand |
| `GET/PATCH /api/me/training-timezone` | Shared athlete timezone |

## Tests

- `packages/shared/src/workoutPlan.test.ts` — normalization and rendering.
- `apps/server/src/lib/trainingPlanProjection.test.ts` — event ↔ plan shape.
- `apps/server/src/lib/planRefreshRunner.test.ts` — refresh outcome from
  per-target tool results.
- `apps/server/src/lib/activityImporter.test.ts` — source tagging and dedupe
  column behaviour.
- `apps/server/src/lib/intervalsIcuSessionAdapter.test.ts` — ride/Strava
  filtering and summary mapping.
- `apps/server/src/lib/crossTrainingSessionRepo.test.ts` — idempotent upsert,
  ordering and load lookup.
