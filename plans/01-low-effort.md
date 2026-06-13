# Low-Effort Coach & Analysis Improvements

Ideas that can be implemented quickly with minimal new infrastructure.

---

## 1. `current_activity` Tool

**Why:** The coach currently has no access to the activity the user is viewing. Every thread has an `activity_id` but the coach can only look up *past* activities via `activity_lookup`. This is the single biggest gap.

**What:** A new tool that reads the activity the thread is attached to and returns its full data to the LLM.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/currentActivity.ts`
- Reuses the same DB queries as `activityLookup.ts` (`getByIdStmt`)
- Tool definition:
  ```typescript
  {
    name: "current_activity",
    description: "Fetch the full data for the activity currently being discussed. Returns summary, intervals, peak powers, and all per-second records.",
    parameters: { type: "object", properties: {}, required: [] }
  }
  ```
- Handler receives `threadId` via a new mechanism (pass `threadId` through the tool execution context, or derive `activityId` from the thread in the handler)
- Returns same shape as `activity_lookup` (summary, intervals, peakPowers, records)
- Register in `init.ts`

**Files to touch:**
- `apps/server/src/lib/tools/currentActivity.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/server/src/lib/tools/registry.ts` (extend `ToolHandler` signature to accept `threadId` or context)
- `apps/server/src/lib/trainerToolLoop.ts` (pass `threadId` to `executeTool`)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add `current_activity` meta entry)

**Effort:** ~1 hour

---

## 2. Auto-Inject Current Activity into System Prompt

**Why:** Even without a tool call, the coach should know basic facts about the activity being discussed. This eliminates the need for the user to paste data manually.

**What:** When a thread has an `activity_id`, include the activity's summary + intervals in the system prompt automatically.

**Implementation:**

- In `buildTrainerAthleteContext` (or a new helper), accept an optional `activityId` parameter
- If provided, query the activity from DB and format a section like:
  ```
  ## Current Activity
  Date: 2025-06-12
  Duration: 1h 23m, Distance: 42.3 km
  Avg Power: 210 W, NP: 228 W, Max: 650 W
  Avg HR: 142 bpm, Max: 178 bpm
  Peak 1min: 380 W, Peak 5min: 310 W, Peak 20min: 265 W
  Intervals: 5 detected (avg 245-280 W)
  ```
- In `trainer.ts` POST `/chat`, pass `threadId` → resolve `activityId` → pass to `buildSystemPrompt`
- Keep it concise — the full detail is available via the `current_activity` tool

**Files to touch:**
- `apps/server/src/lib/trainerSystemPrompt.ts` (add `activityId` param, format activity section)
- `apps/server/src/routes/trainer.ts` (resolve `activityId` from `threadId`, pass to prompt builder)

**Effort:** ~30 minutes

---

## 3. `zone_analysis` Tool

**Why:** Time-in-zone is a fundamental coaching metric. Every coach asks "how much Zone 2 did you do?" or "was this ride polarized?"

**What:** Given an activity + FTP + maxHR, compute % time spent in each power and HR zone.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/zoneAnalysis.ts`
- Zone definitions (standard cycling):
  - Power: Z1 (0-55% FTP), Z2 (56-75%), Z3 (76-90%), Z4 (91-105%), Z5 (106-120%), Z6 (121-150%), Z7 (>150%)
  - HR: Z1 (0-60% maxHR), Z2 (61-70%), Z3 (71-80%), Z4 (81-90%), Z5 (91-100%), Z6 (>100%)
- Tool definition:
  ```typescript
  {
    name: "zone_analysis",
    description: "Compute time-in-zone distribution for power and heart rate for a given activity. Requires FTP and max HR (uses estimates if not provided).",
    parameters: {
      type: "object",
      properties: {
        activityId: { type: "string", description: "Activity ID (defaults to current thread's activity)" },
        ftp: { type: "number", description: "Functional Threshold Power in watts (uses estimate if omitted)" },
        maxHr: { type: "number", description: "Maximum heart rate in bpm (uses recorded max if omitted)" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve activity (from `activityId` or thread's activity)
  2. Resolve FTP (from arg or `computeAllTimeEstimates`)
  3. Resolve maxHR (from arg or activity's `maxHeartRate`)
  4. Iterate records, bucket each second into power zone and HR zone
  5. Return content: formatted text with zone names, durations, percentages
  6. Return display: `{ powerZones: { zone, seconds, percent }[], hrZones: {...}[], ftp, maxHr }`

**Files to touch:**
- `apps/server/src/lib/tools/zoneAnalysis.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `BarChart3`)

**Effort:** ~1.5 hours

---

## 4. `analyze_intervals` Tool

**Why:** The client already has `detectPowerIntervals` in `apps/web/src/lib/stats.ts`. Porting this to the server lets the coach autonomously find efforts matching specific criteria.

**What:** Server-side interval detection with configurable power/HR thresholds and duration minimums.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/analyzeIntervals.ts`
- Port `detectPowerIntervals` logic from `apps/web/src/lib/stats.ts` to shared or server
- Also add HR-based detection: find blocks where HR stays above a threshold for a minimum duration
- Tool definition:
  ```typescript
  {
    name: "analyze_intervals",
    description: "Detect intervals (sustained efforts) in an activity by power or heart rate thresholds. Returns each interval's duration, average power, HR, and cadence.",
    parameters: {
      type: "object",
      properties: {
        activityId: { type: "string", description: "Activity ID (defaults to current thread's activity)" },
        minPower: { type: "number", description: "Minimum average power in watts (default 200)" },
        minSeconds: { type: "number", description: "Minimum duration in seconds (default 10)" },
        coastingTolerance: { type: "number", description: "Max coasting gap to merge adjacent efforts in seconds (default 2)" },
        minHeartRate: { type: "number", description: "Minimum heart rate in bpm for HR-based detection" },
        detectionMode: { type: "string", enum: ["power", "heart_rate", "both"], description: "Detection mode (default 'power')" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve activity
  2. Run power detection if `minPower` provided
  3. Run HR detection if `minHeartRate` provided
  4. Return content: formatted list of intervals with stats
  5. Return display: `{ intervals: Interval[], mode, params }`

**Files to touch:**
- `apps/server/src/lib/tools/analyzeIntervals.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `Activity`)

**Effort:** ~2 hours

---

## 5. `compare_activities` Tool

**Why:** Athletes constantly compare rides. "Was today better than last week?" is the most common question.

**What:** Side-by-side comparison of two activities with diff values.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/compareActivities.ts`
- Tool definition:
  ```typescript
  {
    name: "compare_activities",
    description: "Compare two activities side-by-side. Returns a diff table of key metrics.",
    parameters: {
      type: "object",
      properties: {
        activityId1: { type: "string", description: "First activity ID" },
        activityId2: { type: "string", description: "Second activity ID" },
        date1: { type: "string", description: "First activity date (YYYY-MM-DD)" },
        date2: { type: "string", description: "Second activity date (YYYY-MM-DD)" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve both activities (by ID or date)
  2. Compute diff for: duration, distance, avgPower, NP, maxPower, avgHR, maxHR, avgCadence, totalWork, peak powers (1m, 5m, 20m)
  3. Return content: formatted diff table
  4. Return display: `{ activity1: {...}, activity2: {...}, diffs: { metric, value1, value2, delta, deltaPercent }[] }`

**Files to touch:**
- `apps/server/src/lib/tools/compareActivities.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `GitCompare`)

**Effort:** ~1.5 hours

---

## 6. `segment_finder` Tool

**Why:** Climbs and descents are key features of any ride. The coach should be able to find and analyze them.

**What:** Find climbs, descents, or flat sections in an activity by gradient and duration.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/segmentFinder.ts`
- Tool definition:
  ```typescript
  {
    name: "segment_finder",
    description: "Find climbs, descents, or flat sections in an activity by gradient threshold and minimum duration.",
    parameters: {
      type: "object",
      properties: {
        activityId: { type: "string", description: "Activity ID (defaults to current thread's activity)" },
        minGradient: { type: "number", description: "Minimum gradient percent for climbs (default 3)" },
        maxGradient: { type: "number", description: "Maximum gradient percent for descents (default -3)" },
        minDuration: { type: "number", description: "Minimum duration in seconds (default 60)" },
        segmentType: { type: "string", enum: ["climb", "descent", "flat", "all"], description: "Segment type to find (default 'all')" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve activity
  2. Scan records for contiguous gradient blocks matching criteria
  3. For each segment: compute duration, distance, elevation gain/loss, avg gradient, avg power, avg HR
  4. Return content: formatted list of segments
  5. Return display: `{ segments: { type, startSeconds, endSeconds, duration, distance, elevationGain, avgGradient, avgPower, avgHR }[] }`

**Files to touch:**
- `apps/server/src/lib/tools/segmentFinder.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `Mountain`)

**Effort:** ~2 hours
