# Medium-Effort Coach & Analysis Improvements

Ideas requiring more infrastructure, new UI components, or cross-cutting changes.

---

## 1. Rich Tool Result Displays

**Why:** Currently `ToolCallCard` renders tool results as raw JSON or plain text. Structured data like PMC charts, power curves, and weather should have visual, scannable displays.

**What:** Per-tool custom rendering in `ToolCallCard` that transforms `display` data into inline visualizations.

**Implementation:**

- **Refactor `ToolCallCard.tsx`** to support per-tool renderers:
  ```typescript
  const TOOL_RENDERERS: Record<string, (display: unknown) => ReactNode> = {
    training_load: renderTrainingLoad,
    power_curve: renderPowerCurve,
    weather_history: renderWeatherHistory,
    zone_analysis: renderZoneAnalysis,
    // ... fallback to JSON for others
  }
  ```

- **`renderTrainingLoad`** — Mini PMC chart:
  - Small inline SVG or canvas showing CTL (blue), ATL (red), TSB (green) lines over the lookback period
  - Current values displayed as a summary row: "CTL: 72 | ATL: 85 | TSB: -13 (productive fatigue)"
  - Use a lightweight charting approach (no Recharts — too heavy for inline). Consider a tiny SVG path or a few div bars.

- **`renderPowerCurve`** — Mini bar chart:
  - Horizontal bars for each duration (5s, 30s, 1m, 5m, 10m, 20m, 60m)
  - Two bars per duration: current activity (filled) vs all-time best (outline)
  - Percent labels on each bar

- **`renderWeatherHistory`** — Weather card:
  - Icon-based summary: ☀️/🌧️/💨 with temp range, precipitation, wind
  - Small table: High | Low | Precip | Wind

- **`renderZoneAnalysis`** — Zone distribution bars:
  - Horizontal stacked bar for power zones (Z1-Z7) with color coding
  - Same for HR zones
  - Percentage labels

- **`renderActivityLookup`** — Activity summary card:
  - Key metrics in a compact grid: Duration | Distance | Avg Power | NP | Avg HR
  - Peak powers row
  - Interval count with avg power range

**Design constraints:**
- Must be lightweight (inline, no heavy chart libraries)
- Must work in the chat message flow (narrow width, dark theme)
- Must degrade gracefully (fallback to text if display data is missing)

**Files to touch:**
- `apps/web/src/components/trainer/ToolCallCard.tsx` (major refactor)
- Potentially new files: `apps/web/src/components/trainer/toolDisplays/*.tsx`

**Effort:** ~4-6 hours

---

## 2. `trend_analysis` Tool

**Why:** "Am I improving?" is the #1 question athletes ask. The coach should be able to show metric trends over time with data, not guesses.

**What:** Given a metric and lookback period, return a time series with trend direction and rate of change.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/trendAnalysis.ts`
- Supported metrics: `avgPower`, `normalizedPower`, `peak1minPower`, `peak5minPower`, `peak20minPower`, `avgHeartRate`, `avgCadence`, `totalDistanceKm`, `totalTimerTime`, `totalWork`
- Tool definition:
  ```typescript
  {
    name: "trend_analysis",
    description: "Analyze trends in a specific performance metric over time. Returns a time series with trend direction, rate of change, and statistical significance.",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["avgPower", "normalizedPower", "peak1minPower", "peak5minPower", "peak20minPower", "avgHeartRate", "avgCadence", "totalDistanceKm", "totalTimerTime", "totalWork"], description: "Metric to analyze" },
        days: { type: "number", description: "Number of days to look back (default 90)" },
        activityId: { type: "string", description: "Optional: compare against a specific activity" }
      },
      required: ["metric"]
    }
  }
  ```
- Handler:
  1. Query all activities in lookback period
  2. Extract the requested metric from each activity's summary
  3. Compute: linear regression slope (trend direction + rate), rolling 7-day average, min/max/current values
  4. Return content: formatted trend summary with direction, rate, confidence
  5. Return display: `{ metric, dates: string[], values: number[], rollingAvg: number[], trend: { slope, direction, r2, changePerWeek } }`

**Files to touch:**
- `apps/server/src/lib/tools/trendAnalysis.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta + renderer with mini sparkline)

**Effort:** ~3 hours

---

## 3. `workout_generator` Tool

**Why:** Athletes want specific, actionable workouts. The coach should be able to generate structured sessions based on current fitness and goals.

**What:** Generate a structured workout with intervals, power targets, durations, and rest periods.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/workoutGenerator.ts`
- Tool definition:
  ```typescript
  {
    name: "workout_generator",
    description: "Generate a structured cycling workout based on the athlete's current fitness, goals, and available time.",
    parameters: {
      type: "object",
      properties: {
        focus: { type: "string", enum: ["endurance", "tempo", "sweet_spot", "threshold", "vo2max", "anaerobic", "sprint", "recovery"], description: "Training focus" },
        durationMinutes: { type: "number", description: "Total workout duration in minutes (default 60)" },
        ftp: { type: "number", description: "FTP in watts (uses estimate if omitted)" },
        eventDate: { type: "string", description: "Target event date for phase-appropriate workout" }
      },
      required: ["focus"]
    }
  }
  ```
- Handler:
  1. Resolve FTP (from arg or `computeAllTimeEstimates`)
  2. Resolve training phase (from `eventDate` via `eventCountdown` logic)
  3. Build workout structure based on focus:
     - **Endurance**: 3x15min Z2, 5min rest
     - **Sweet Spot**: 3x12min @ 88-94% FTP, 5min rest
     - **Threshold**: 2x20min @ 95-105% FTP, 10min rest
     - **VO2max**: 5x4min @ 110-120% FTP, 4min rest
     - **Anaerobic**: 8x1min @ 130-150% FTP, 3min rest
     - **Sprint**: 12x15s max effort, 2min rest
     - **Tempo**: 2x30min @ 76-87% FTP, 5min rest
     - **Recovery**: 45min Z1 only
  4. Scale to fit `durationMinutes` (add warmup/cooldown, adjust interval count)
  5. Return content: formatted workout with power targets, durations, cues
  6. Return display: `{ focus, totalDuration, ftp, intervals: { description, duration, targetPower, targetPowerPercent, restDuration }[], warmup, cooldown }`

**Files to touch:**
- `apps/server/src/lib/tools/workoutGenerator.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta + workout renderer with interval table)

**Effort:** ~3 hours

---

## 4. Persist Tool Results in Chat History

**Why:** Currently tool calls are ephemeral — they disappear on page reload. This loses the coach's reasoning context and makes conversations feel incomplete when revisited.

**What:** Store tool results as special message types in `trainer_messages` and render them on history load.

**Implementation:**

- **DB schema change:** Add a `tool_calls` JSON column to `trainer_messages` (or a new `trainer_tool_results` table)
  - Option A (simpler): Extend `trainer_messages` with nullable `tool_calls` TEXT column storing JSON array of `UIToolCall[]`
  - Option B (cleaner): New table `trainer_tool_results` (id, message_id, tool_call_id, tool_name, arguments JSON, content, display JSON, error, created_at)

- **Server changes:**
  - In `trainerToolLoop.ts`, after all tool results are yielded, collect them and store alongside the final assistant message
  - In `trainer.ts` history endpoints, include tool results in the response
  - New shared type: `TrainerMessageWithTools extends TrainerMessage { toolCalls?: UIToolCall[] }`

- **Client changes:**
  - In `useTrainerHistoryPersist.ts`, include tool results when saving
  - In `TrainerChat.tsx`, on history load, reconstruct `UIToolCall[]` state from persisted data
  - Tool cards render in collapsed state (no re-execution, no spinner)
  - Add a subtle "cached" indicator to distinguish from live tool calls

**Files to touch:**
- `apps/server/src/db.ts` (schema migration)
- `apps/server/src/lib/trainerToolLoop.ts` (collect + store tool results)
- `apps/server/src/routes/trainer.ts` (include tool results in history responses)
- `packages/shared/src/types.ts` (new `TrainerMessageWithTools` type)
- `apps/web/src/components/trainer/useTrainerHistoryPersist.ts` (persist tool results)
- `apps/web/src/components/trainer/TrainerChat.tsx` (reconstruct tool state on load)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add "cached" state)

**Effort:** ~4-5 hours

---

## 5. `cardiac_drift` Analysis Tool

**Why:** Aerobic decoupling (HR drift over steady efforts) is a key endurance metric. It indicates fatigue resistance and aerobic fitness.

**What:** Detect steady-state efforts and compute the power:HR ratio drift over time.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/cardiacDrift.ts`
- Tool definition:
  ```typescript
  {
    name: "cardiac_drift",
    description: "Analyze cardiac drift (aerobic decoupling) during steady-state efforts. Measures how heart rate rises relative to power over sustained efforts.",
    parameters: {
      type: "object",
      properties: {
        activityId: { type: "string", description: "Activity ID (defaults to current thread's activity)" },
        minDuration: { type: "number", description: "Minimum steady effort duration in seconds (default 600 = 10min)" },
        powerVariance: { type: "number", description: "Max power variance percent to consider 'steady' (default 10)" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve activity
  2. Find steady-state blocks: sliding windows where power variance < threshold
  3. For each block: compute power:HR ratio in first half vs second half
  4. Drift % = (ratioSecondHalf - ratioFirstHalf) / ratioFirstHalf * 100
  5. Interpretation: <5% = excellent, 5-10% = good, 10-15% = moderate fatigue, >15% = significant decoupling
  6. Return content: formatted drift analysis per steady block
  7. Return display: `{ blocks: { startSeconds, endSeconds, duration, avgPower, powerVariance, firstHalfRatio, secondHalfRatio, driftPercent, interpretation }[] }`

**Files to touch:**
- `apps/server/src/lib/tools/cardiacDrift.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `HeartPulse`)

**Effort:** ~3 hours

---

## 6. `ride_recommendation` Tool

**Why:** Combine weather forecast + training load + event countdown to suggest today's optimal ride.

**What:** Given current CTL/ATL/TSB, weather forecast, and event timeline, recommend ride type, duration, and intensity.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/rideRecommendation.ts`
- Tool definition:
  ```typescript
  {
    name: "ride_recommendation",
    description: "Recommend today's optimal ride based on current training load, weather forecast, and event timeline.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude for weather forecast" },
        lng: { type: "number", description: "Longitude for weather forecast" },
        availableMinutes: { type: "number", description: "Available time in minutes (default 60)" },
        eventDate: { type: "string", description: "Target event date for phase context" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Fetch weather forecast for today (reuse `weatherHistory.ts` forecast logic)
  2. Compute current training load (reuse `trainingLoad.ts` logic)
  3. Determine training phase (reuse `eventCountdown.ts` logic)
  4. Decision matrix:
     - TSB < -25 + bad weather → rest day
     - TSB < -10 + good weather → Z1/Z2 endurance
     - TSB -10 to 0 + build phase → threshold or sweet spot
     - TSB > 0 + peak phase → VO2max or race-pace
     - TSB > 15 → hard workout or long ride
  5. Return content: recommendation with rationale
  6. Return display: `{ recommendation, rationale, weather, trainingLoad, phase }`

**Files to touch:**
- `apps/server/src/lib/tools/rideRecommendation.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `Bike`)

**Effort:** ~3 hours
