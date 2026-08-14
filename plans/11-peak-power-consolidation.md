# Architecture Deepening: Peak Power Consolidation

Unify the three peak-power implementations into one canonical function with thin input-shape adapters.

---

## Why

There are three implementations of "best average power over N seconds" with subtly different zero/gap handling. A value computed during Strava import can differ from the same activity's web-chart peak — a latent correctness bug.

**The three implementations:**

1. **`packages/shared/src/power.ts` — `peakPowerFromSeconds(seconds, windowSecs)`**
   - Input: per-second power array (with nulls for gaps)
   - Zero handling: **zero-exclusive** — zeros and nulls are skipped (window sum counts only non-null, non-zero)
   - Used by: `parseFit.ts` (FIT import), `athleteStats.ts` (all-time estimates)

2. **`apps/server/src/routes/strava.ts` — `computePeakPower(timeArr, wattsArr, windowSecs)`**
   - Input: raw Strava time + watt arrays (variable-rate, not per-second)
   - Zero handling: **zero-inclusive** — zeros included in window sum, but divides by count of non-zero values in window
   - Used by: Strava import `buildSummary`

3. **`apps/web/src/lib/stats.ts` — `computePeakPower(records, windowSecs)`**
   - Input: `ActivityRecord[]`
   - Converts records → `buildPowerBySecond` → calls shared `peakPowerFromSeconds`
   - Zero handling: **same as shared** (zero-exclusive)
   - Used by: web interval selection stats

The Strava version is the outlier. It operates on raw Strava time/watt arrays (variable-rate streams, not 1Hz), so it can't directly call `peakPowerFromSeconds`. But its zero-handling differs from the canonical implementation, meaning the same ride can have different peak-power values depending on whether it was imported via Strava or via FIT upload.

## Current state

**`packages/shared/src/power.ts`** (181 LOC):
- `buildPowerBySecond(records)` — carry-forward over records, produces per-second array with nulls
- `peakPowerFromSeconds(powerBySecond, windowSecs)` — sliding best-average, ignores null/zero, returns best avg watts
- `computeNormalizedPower(powerBySecond)` — rolling 30s, 4th-power mean, 4th root
- `normalizedPowerFromSeconds(seconds)` — wrapper
- `computeNormalizedCadence` / `normalizedCadenceFromSeconds` — same pattern for cadence

**`routes/strava.ts`** `computePeakPower`:
```typescript
function computePeakPower(timeArr: number[], wattsArr: number[], windowSecs: number): number {
  // Sliding window over raw time array
  // Sum includes zeros, divide by count of non-zero
  // Different result from peakPowerFromSeconds for the same data
}
```

**`apps/web/src/lib/stats.ts`** `computePeakPower`:
```typescript
function computePeakPower(records: ActivityRecord[], windowSecs: number): number {
  const bySecond = buildPowerBySecond(records);
  return peakPowerFromSeconds(bySecond, windowSecs);
}
```

## Target

**Keep:** `packages/shared/src/power.ts` `peakPowerFromSeconds` as the canonical implementation.

**New helper:** `packages/shared/src/power.ts`
```typescript
function peakPowerFromTimeSeries(timeArr: number[], wattsArr: number[], windowSecs: number): number {
  // Convert variable-rate time/watt arrays to per-second (carry-forward)
  // Then delegate to peakPowerFromSeconds
  // This is what stravaStreamToPowerBySecond already does — but inline
}
```

**Delete:**
- `computePeakPower` from `routes/strava.ts` → replaced by `peakPowerFromTimeSeries`
- `computePeakPower` from `apps/web/src/lib/stats.ts` → already delegates to shared, can be replaced by direct `peakPowerFromSeconds(buildPowerBySecond(records), windowSecs)` call or kept as a thin wrapper

**Also consolidate:** `stravaStreamToPowerBySecond` / `stravaStreamToCadenceBySecond` in `routes/strava.ts` are parallel to `buildPowerBySecond` / `buildCadenceBySecond` in shared — they do the same carry-forward but from variable-rate Strava streams instead of 1Hz records. Extract a `buildMetricBySecondFromTimeSeries(timeArr, valuesArr)` helper to shared.

## What tests survive

- **`peakPowerFromSeconds`:** known per-second arrays → assert correct best-average for various window sizes
- **Zero/gap handling:** array with zeros and nulls → assert zeros excluded, nulls excluded
- **`peakPowerFromTimeSeries`:** variable-rate time/watt arrays → assert same result as equivalent per-second array
- **Equivalence:** construct a per-second array, convert to time-series, compute peak both ways → assert equal
- **Edge cases:** all zeros, all nulls, window > array length, single value

All testable with pure arrays. No DB, no API.

## Files to touch

- `packages/shared/src/power.ts` (add `peakPowerFromTimeSeries`, add `buildMetricBySecondFromTimeSeries`)
- `apps/server/src/routes/strava.ts` (delete `computePeakPower`, `stravaStreamToPowerBySecond`, `stravaStreamToCadenceBySecond` — use shared)
- `apps/web/src/lib/stats.ts` (delete `computePeakPower` — use shared directly, or keep as thin wrapper)
- `packages/shared/src/power.test.ts` (new — first tests for the most important pure math in the codebase)

## Dependencies

- Blocked by: none
- Related: plan 06 (activity importer — Strava adapter uses the shared peak power instead of its own)

## Effort

~0.25 session. Smallest extract — one function moves, one adapter adds, two duplicates delete.