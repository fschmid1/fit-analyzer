# Architecture Deepening: Health-Context Derivation

Unify the OW and HAE health-context derivation into one module, eliminating duplicated `determineStatus`, `formatSleepDuration`, and `HealthContext` type drift.

---

## Why

The "derive HealthContext from raw health data" logic is split across two clients with near-identical derivation but duplicated helpers:

**Duplicated verbatim:**
- `determineStatus(latest, avg, metric)` — identical threshold switch in `owClient.ts` and `haeClient.ts`
- `formatSleepDuration(minutes)` — 4 copies: `routes/health.ts`, `haeClient.ts`, `trainerSystemPrompt.ts` (dead), `lib/tools/healthData.ts`
- Sleep-stage averaging block — near-identical between OW and HAE

**Type drift:**
- `HealthContext`, `SleepStages`, `RecentNight` declared in `packages/shared/src/types.ts` AND re-declared locally in `owClient.ts`
- `health.ts` paper-overs with `as import("@fit-analyzer/shared").HealthContext` casts

**Inconsistent cache keying:**
- `owClient` cache keyed by `owUserId`
- `haeClient` cache keyed by `fitUserId`

## Current state

**`owClient.ts`** (563 LOC):
- `fetchSleepSummaries` / `fetchBodySummary` — HTTP fetchers against OW API
- `computeHealthContext(sleepSummaries, bodySummary)` — derives RHR/HRV/RR/SpO2 from sleep summaries (per-night averages, latest-vs-7d status), temperature from body summary, overrides RHR/HRV from body summary's 7-day fields
- `determineStatus` — threshold-based status
- In-memory caches (5-min TTL)

**`haeClient.ts`** (999 LOC — three concerns in one file):
- **Ingestion:** `parseMetrics(metrics)` — huge switch over ~20 metric name aliases, unit conversions (F↔C, fraction↔percent), merge per-day snapshots
- **Context building:** `computeHaeHealthContext` — mirrors OW's derivation but reads from `hae_health_history` table; computes morning HR (lowest within 30min of waking), sleep-average HR (Bevel-style — Apple's `resting_heart_rate` is rejected as drifting)
- **History query:** `getHaeHistory` — per-day `HealthHistoryEntry[]` for charting
- `determineStatus` — identical to OW's
- `formatSleepDuration` — identical to health.ts's

**`routes/health.ts`** (219 LOC):
- `buildHealthData(ctx)` — maps `HealthContext` → `HealthData` (API response shape), formats sleep durations
- `resolveHealthData` — source selection (`openwearables` | `health_auto_export` | `auto`), fallback logic
- Dead `if (healthSource === "auto" && healthData)` block with only comments

## Target

**New file:** `apps/server/src/lib/healthContextDerivation.ts`

**Interface:**
```typescript
interface RawDailySnapshot {
  date: string;
  // Sleep
  sleepStart?: string;
  sleepEnd?: string;
  sleepDurationMin?: number;
  sleepStages?: SleepStages;
  // Vitals
  restingHr?: number;
  sleepAvgHr?: number;
  morningHr?: number;
  hrv?: number;
  respiratoryRate?: number;
  spo2?: number;
  // Temperature
  skinTempC?: number;
  bodyTempC?: number;
}

interface HealthContextDerivationOptions {
  days: number; // default 7
}

function deriveHealthContext(
  snapshots: RawDailySnapshot[],
  options?: HealthContextDerivationOptions
): HealthContext;
```

**Implementation absorbs:**
- `determineStatus` (one copy)
- Per-night averaging logic
- Latest-vs-7-day-avg status computation
- RHR selection (morning HR / sleep-avg HR / OW body-summary override)
- HRV/RR/SpO2 status
- Temperature status

**Becomes adapters:**
- `owClient` — fetches from OW API → produces `RawDailySnapshot[]` → delegates to `deriveHealthContext`
- `haeClient` — queries `hae_health_history` table → produces `RawDailySnapshot[]` → delegates to `deriveHealthContext`

**`formatSleepDuration` moves to:** `apps/server/src/lib/formatters.ts` (new shared formatters file) or `packages/shared`

**`haeClient.ts` splits into:**
- `haeIngest.ts` — `parseMetrics` + `mergeSnapshots` + ingestion
- `haeHealthContext.ts` — raw snapshot query + delegation to `deriveHealthContext`
- `haeHistory.ts` — history query (or stays combined if small enough)

## What tests survive

- **Derivation:** synthetic `RawDailySnapshot[]` → assert correct `HealthContext` (RHR, HRV, RR, SpO2, temp, statuses)
- **Status thresholds:** `determineStatus` with edge values — assert `elevated`/`lower`/`higher`/`normal`
- **7-day average:** snapshots with varying values → assert correct avg and status
- **RHR selection:** morning HR vs sleep-avg HR vs body-summary override — assert priority
- **Sleep duration format:** `formatSleepDuration` with various minutes → assert output

All testable with synthetic snapshots. No API, no DB.

## Files to touch

- `apps/server/src/lib/healthContextDerivation.ts` (new)
- `apps/server/src/lib/owClient.ts` (remove `computeHealthContext` + `determineStatus`, produce raw snapshots)
- `apps/server/src/lib/haeClient.ts` (split: ingestion stays, context-building delegates)
- `apps/server/src/routes/health.ts` (remove `formatSleepDuration` duplicate, remove dead auto block)
- `apps/server/src/lib/tools/healthData.ts` (remove `formatSleepDuration` duplicate)
- `apps/server/src/lib/formatters.ts` (new — `formatSleepDuration` lives here)
- `apps/server/src/lib/healthContextDerivation.test.ts` (new)
- Remove local `HealthContext`/`SleepStages`/`RecentNight` from `owClient.ts` — use shared types

## Dependencies

- Blocked by: none
- Related: removes dead `trainerSystemPrompt.ts` (4th `formatSleepDuration` copy)

## Effort

~1 session. The derivation logic already exists in two places; this is unification + type cleanup + first tests.