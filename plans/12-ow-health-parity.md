# OpenWearables Health Parity

Bring the OW integration to parity with HAE on three gaps: historical persistence, morning-HR / sleep-avg-HR derivation, and bodyComposition in the health context.

---

## Why

HAE is the richer health integration today:

| Capability | HAE | OW |
|---|---|---|
| Historical persistence | `hae_health_history` table (`db.ts:444`), 7-day windowed context | None — live polling, `history: []` and `lastSyncAt: null` (`routes/health.ts:194-197`) |
| Morning heart rate | Lowest HR within 30 min of waking (`haeClient.ts:579-599`) | Hardcoded `null` (`owClient.ts:266`) |
| Sleep-avg-HR (Bevel-style RHR) | `computeSleepAverageHrByDate` (`haeClient.ts:624-649`) | Uses `avg_heart_rate_bpm` from sleep summaries as RHR (`owClient.ts:344-364`) — same concept, but not persisted so no 7-day trend survives data gaps |
| bodyComposition in `HealthContext` | `pickLatestBodyComposition` (`haeClient.ts:889-900`) | Hardcoded `null` (`owClient.ts:472`) even though `BodySummaryResponse.slow_changing` has weight |

OW polls a 7-day rolling sleep-summary window (`owClient.ts:162-201`) and a current-only body snapshot (`owClient.ts:203-222`). Any missed poll day is lost forever; charts get no history; the coach sees no morning HR or weight.

## Approach

Follow plan 08's shape: OW becomes an adapter that persists raw daily snapshots and delegates derivation, rather than copying HAE logic into `owClient`. Adding the three features naively would triple the duplication plan 08 already catalogs (`determineStatus` ×2, `formatSleepDuration` ×4, type drift).

## Target

### 1. Shared daily-snapshot history store

New module: `apps/server/src/lib/healthHistory.ts`

- Generalize the `hae_health_history` pattern into `health_daily_history` (schema: `user_id TEXT, source TEXT, date TEXT, data TEXT, updated_at TEXT`, PK `(user_id, source, date)`). Migrate existing `hae_health_history` rows in with `source = 'health_auto_export'`.
- `upsertDailySnapshot(userId, source, date, data)` — JSON merge-upsert, mirroring `haeClient.ts:160-166`.
- `getDailySnapshots(userId, source, startDate, endDate)` — parsed rows, newest first.
- `clearSourceHistory(userId, source)`.

OW poll path (`resolveHealthContext`, `owClient.ts:476-509`): after a successful fetch, persist each sleep summary as a dated snapshot and the body summary onto its most recent date. Then build the context from the 7-day history window (like `getHaeHealthContext`, `haeClient.ts:973-1006`) instead of the ephemeral response, so gaps in polling degrade gracefully instead of erasing days.

Add `ow_last_sync_at` column to `user_settings`; `routes/health.ts:194-197` serves `lastSyncAt` + `history` (via a `getOwHistory` that maps snapshots → `HealthHistoryEntry`) for the OW source too.

### 2. Unified derivation with morning HR + sleep-avg-HR

Implement plan 08's `healthContextDerivation.ts`:

```ts
deriveHealthContext(snapshots: RawDailySnapshot[]): HealthContext
```

`RawDailySnapshot` gains the fields both adapters can supply:

- `sleepAvgHr` — OW: `avg_heart_rate_bpm` per night (already present); HAE: `computeSleepAverageHrByDate`.
- `morningHr` — HAE: `computeMorningHeartRateByDate`; OW: **blocked on API surface** (see Open questions).
- `weightKg` / body fields — OW: `BodySummaryResponse.slow_changing`; HAE: `bodyComposition`.

RHR selection priority (per plan 08:82-84): morning HR → sleep-avg HR → body-summary 7-day override (OW).

`owClient.computeHealthContext` and `haeClient.computeHaeHealthContext` both collapse to "fetch → snapshots → `deriveHealthContext`". Shared `HealthContext`/`SleepStages`/`RecentNight` from `packages/shared` replace owClient's local copies (`owClient.ts:3-61`).

### 3. bodyComposition in OW context

Map `bodySummary.slow_changing.weight_kg` → `HealthContext.bodyComposition`, with `asOf` from the persisted snapshot date. Once snapshots are persisted, `pickLatestBodyComposition` logic lives once in the derivation module and serves both clients.

### 4. Tests

- `healthContextDerivation.test.ts` — synthetic `RawDailySnapshot[]` → assert context incl. morning-HR/sleep-avg-HR RHR priority, statuses, weight selection (plan 08:98-104).
- `healthHistory.test.ts` — upsert merge semantics, range query, migration of existing HAE rows.
- Existing `haeSleep.test.ts` must stay green; HAE output must be byte-identical before/after (golden snapshot of `computeHaeHealthContext` on fixture rows).

## Files to touch

- `apps/server/src/lib/healthHistory.ts` (new — shared snapshot store + migration)
- `apps/server/src/lib/healthContextDerivation.ts` (new — per plan 08)
- `apps/server/src/lib/owClient.ts` — persist on poll, delegate derivation, bodyComposition, shared types
- `apps/server/src/lib/haeClient.ts` — swap table for `healthHistory`, delegate derivation, drop `determineStatus`
- `apps/server/src/db.ts` — `health_daily_history` migration + `ow_last_sync_at`
- `apps/server/src/routes/health.ts` — OW source serves `lastSyncAt`/`history`; drop local `formatSleepDuration`
- `packages/shared/src/types.ts` — no change expected (`HealthContext`, `HealthHistoryEntry` already cover it)
- Tests as above

## Open questions

1. **Morning HR for OW** — needs per-reading HR samples with timestamps plus sleep end. Does the OW API expose a samples/heart-rate endpoint beyond `summaries/sleep` and `summaries/body`? If not, OW's sleep-avg-HR is the only RHR, and morning HR stays HAE-only (documented, not a blocker).
2. **Table strategy** — generalize to `health_daily_history(user_id, source, date)` with migration (proposed), vs. a second table `ow_health_history` (zero migration, but duplicates the store).
3. **Sequencing** — this plan absorbs plan 08. Land in two PRs: (a) history store + OW persistence + bodyComposition, (b) derivation unification + morning HR. Or one PR if review budget allows.

## Effort

~2 sessions: history store + OW wiring is the bulk; derivation unification is mostly moving existing code.