# High-Effort Coach & Analysis Improvements

Ideas requiring significant new infrastructure, multi-file changes, or new UI surfaces.

---

## 1. Proactive Coach on Activity Load

**Why:** Currently the user must manually "Send to Trainer" to start a conversation. The coach should proactively analyze the activity when the user opens it, creating an immediate, delightful experience.

**What:** When a user opens an activity, auto-trigger a coach analysis that streams into a special "Activity Report" message in chat.

**Implementation:**

- **New endpoint:** `POST /api/trainer/analyze/:activityId`
  - Builds a specialized system prompt: "You are analyzing a single cycling activity. Provide a concise, structured report..."
  - Injects the full activity data (summary, intervals, peak powers, records) into the prompt
  - Uses the same streaming infrastructure (`trainerToolLoop`) but with a pre-built first user message like "Analyze this ride"
  - Returns SSE stream

- **Client changes:**
  - In the activity detail page, when an activity loads:
    1. Check if there's already a thread for this activity with messages
    2. If no thread exists, auto-create one and trigger the analysis
    3. If a thread exists but has no messages, trigger analysis
    4. If a thread exists with messages, don't auto-trigger (user already discussed it)
  - The analysis appears as the first assistant message in the thread
  - Show a subtle "Analyzing your ride..." indicator while streaming

- **Report structure** (prompt-guided):
  ```
  ## Ride Report: June 12, 2025
  
  ### Overview
  1h 23m, 42.3 km, 210 W avg / 228 W NP
  
  ### Intensity Distribution
  Zone 1: 15%, Zone 2: 45%, Zone 3: 25%, Zone 4: 10%, Zone 5: 5%
  
  ### Key Efforts
  1. 5:30 @ 310 W (threshold)
  2. 2:15 @ 380 W (VO2max)
  3. 8:00 @ 265 W (tempo)
  
  ### Highlights
  - Strong 20-min peak at 265 W (95% of estimated FTP)
  - Good HR stability on climbs
  
  ### Suggestions
  - Consider adding more Zone 2 volume
  - Next session: threshold intervals
  ```

- **Thread auto-naming:** Name the thread after the activity date + type (e.g., "Ride Report · Jun 12")

**Files to touch:**
- `apps/server/src/routes/trainer.ts` (new `POST /analyze/:activityId` endpoint)
- `apps/server/src/lib/trainerSystemPrompt.ts` (new `buildAnalysisPrompt` function)
- `apps/web/src/lib/trainerStreamConnection.ts` (support analysis endpoint)
- `apps/web/src/components/trainer/TrainerChat.tsx` (auto-trigger logic)
- `apps/web/src/pages/ActivityDetail.tsx` or equivalent (trigger on activity load)
- `apps/web/src/components/trainer/useTrainerHistoryPersist.ts` (handle auto-created threads)

**Effort:** ~6-8 hours

---

## 2. `training_plan` Tool

**Why:** A multi-week periodization plan is the ultimate coaching deliverable. Combining event countdown, training load, and workout generation into a coherent plan.

**What:** Generate a week-by-week training plan from now until a target event, with weekly TSS targets, key workouts, and rest weeks.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/trainingPlan.ts`
- Tool definition:
  ```typescript
  {
    name: "training_plan",
    description: "Generate a multi-week periodized training plan from now until a target event. Includes weekly TSS targets, key workouts, and rest weeks.",
    parameters: {
      type: "object",
      properties: {
        eventDate: { type: "string", description: "Target event date in YYYY-MM-DD format" },
        eventName: { type: "string", description: "Optional event name" },
        daysPerWeek: { type: "number", description: "Available training days per week (default 5)" },
        maxHoursPerWeek: { type: "number", description: "Maximum hours per week (default 10)" },
        ftp: { type: "number", description: "FTP in watts (uses estimate if omitted)" },
        focusAreas: { type: "string", description: "Comma-separated focus areas: endurance,threshold,vo2max,sprint" }
      },
      required: ["eventDate"]
    }
  }
  ```
- Handler:
  1. Compute weeks until event (reuse `eventCountdown` logic)
  2. Determine phase for each week (Base → Build → Peak → Taper → Race)
  3. Resolve FTP
  4. Compute current CTL/ATL/TSB (reuse `trainingLoad` logic)
  5. Generate weekly plan:
     - **Base weeks**: CTL ramp rate 3-5 TSS/day, mostly Z2, 1 threshold session
     - **Build weeks**: CTL ramp rate 2-4 TSS/day, 2 intensity sessions (threshold + VO2max)
     - **Peak weeks**: CTL flat or slight decline, race-specific intensity, reduced volume
     - **Taper weeks**: CTL decline 5-8 TSS/day, short intensity touches only
     - **Rest weeks** (every 4th week): CTL decline, recovery focus
  6. For each week, generate specific workout suggestions (reuse `workoutGenerator` logic)
  7. Return content: formatted week-by-week plan
  8. Return display: `{ eventName, eventDate, weeksRemaining, ftp, weeks: { weekNumber, phase, targetCtl, targetTss, workouts: { day, focus, description, duration }[], notes }[] }`

**Files to touch:**
- `apps/server/src/lib/tools/trainingPlan.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta + plan renderer with week-by-week accordion)

**Effort:** ~5-7 hours

---

## 3. Coach-to-Chart Interaction

**Why:** The coach can analyze data but can't point to specific sections of the ride. "Look at the section from 45:00 to 52:00" should highlight that region on the chart.

**What:** A protocol where the coach emits time-range references that the client renders as chart overlays.

**Implementation:**

- **New stream chunk type:** `CHART_HIGHLIGHT` — emitted by the coach when it references a time range
  ```typescript
  { type: "CHART_HIGHLIGHT", startSeconds: number, endSeconds: number, label: string, color: string, timestamp: number }
  ```

- **Server changes:**
  - In the system prompt, instruct the coach to use a special syntax when referencing time ranges:
    ```
    When you want to highlight a section of the ride chart, use this format on its own line:
    ```chart-highlight
    start: 2700
    end: 3120
    label: Threshold effort
    ```
    ```
  - In `trainerToolLoop.ts` or a new post-processing step, parse `TEXT_MESSAGE_CONTENT` chunks for `chart-highlight` code blocks
  - When detected, emit a `CHART_HIGHLIGHT` chunk and strip the code block from the text content
  - Alternative: Add a `highlight_chart` tool that the coach can call explicitly

- **Client changes:**
  - In `trainerStreamConnection.ts`, handle `CHART_HIGHLIGHT` chunks
  - In `TrainerChat.tsx`, collect chart highlights and pass them up to the parent
  - In `ActivityChart.tsx`, accept `externalHighlights: { startSeconds, endSeconds, label, color }[]` prop
  - Render highlights as colored overlay bands with labels
  - Highlights are ephemeral (not persisted) but remain visible while the chat is open

- **Alternative approach (simpler):** A `highlight_chart` tool
  ```typescript
  {
    name: "highlight_chart",
    description: "Highlight a time range on the activity chart for the user to see.",
    parameters: {
      type: "object",
      properties: {
        startSeconds: { type: "number", description: "Start time in seconds" },
        endSeconds: { type: "number", description: "End time in seconds" },
        label: { type: "string", description: "Short label for the highlight" }
      },
      required: ["startSeconds", "endSeconds"]
    }
  }
  ```
  - The tool's `display` contains the highlight data
  - Client intercepts `TOOL_RESULT` for `highlight_chart` and renders the overlay
  - Simpler to implement, more explicit, but requires a tool call round-trip

**Files to touch:**
- `packages/shared/src/types.ts` (new `CHART_HIGHLIGHT` chunk type or `highlight_chart` tool types)
- `apps/server/src/lib/trainerToolLoop.ts` (parse chart-highlight blocks or add tool)
- `apps/server/src/lib/tools/highlightChart.ts` (new, if tool approach)
- `apps/server/src/lib/tools/init.ts` (register if tool approach)
- `apps/web/src/lib/trainerStreamConnection.ts` (handle new chunk type)
- `apps/web/src/components/trainer/TrainerChat.tsx` (collect + pass highlights)
- `apps/web/src/components/ActivityChart.tsx` (render highlight overlays)
- `apps/web/src/components/AnalysisView.tsx` (wire highlights through)

**Effort:** ~6-8 hours (tool approach is ~4 hours)

---

## 4. `pedaling_analysis` Tool

**Why:** Cadence patterns, torque effectiveness, and pedal smoothness (if available in FIT) provide insight into technique efficiency.

**What:** Analyze cadence distribution, cadence-power relationship, and pedal metrics if present in the FIT file.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/pedalingAnalysis.ts`
- Tool definition:
  ```typescript
  {
    name: "pedaling_analysis",
    description: "Analyze pedaling technique: cadence distribution, cadence vs power relationship, and pedal smoothness/torque effectiveness if available.",
    parameters: {
      type: "object",
      properties: {
        activityId: { type: "string", description: "Activity ID (defaults to current thread's activity)" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve activity
  2. Cadence distribution: bucket cadence into ranges (0, 50-60, 60-70, 70-80, 80-90, 90-100, 100-110, 110+), compute % time in each
  3. Cadence-power relationship: for each cadence bucket, compute avg power → identify preferred cadence range
  4. Cadence stability: standard deviation of cadence during steady efforts
  5. If FIT file contains `pedal_smoothness` or `torque_effectiveness` fields (check `@garmin/fitsdk` capabilities):
     - Compute avg/range for left/right legs
     - Identify imbalances
  6. Return content: formatted analysis with recommendations
  7. Return display: `{ cadenceDistribution: { range, seconds, percent, avgPower }[], preferredCadence, cadenceStability, pedalSmoothness?, torqueEffectiveness?, leftRightBalance? }`

**Files to touch:**
- `apps/server/src/lib/tools/pedalingAnalysis.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `Gauge`)
- Potentially `apps/web/src/lib/parseFit.ts` (extract additional FIT fields if available)

**Effort:** ~4-6 hours

---

## 5. Multi-Activity Batch Analysis

**Why:** The coach can only look at one activity at a time. For period reviews, the coach should be able to analyze a batch of activities together.

**What:** A tool that loads multiple activities and computes aggregate statistics, trends, and patterns across them.

**Implementation:**

- **New file:** `apps/server/src/lib/tools/batchAnalysis.ts`
- Tool definition:
  ```typescript
  {
    name: "batch_analysis",
    description: "Analyze multiple activities together. Compute aggregate statistics, identify patterns, and compare across a date range.",
    parameters: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format" },
        days: { type: "number", description: "Number of days to look back (alternative to date range)" },
        metrics: { type: "string", description: "Comma-separated metrics to include: summary,peaks,zones,intervals,trends (default 'summary,peaks')" }
      },
      required: []
    }
  }
  ```
- Handler:
  1. Resolve date range
  2. Query all activities in range
  3. Compute per requested metric:
     - **summary**: Aggregate stats (total duration, distance, work, avg power/HR across all rides)
     - **peaks**: Best peak powers in the period, trend of peak20min
     - **zones**: Aggregate zone distribution across all rides
     - **intervals**: Count and categorize intervals across rides
     - **trends**: Week-over-week changes in key metrics
  4. Return content: formatted batch report
  5. Return display: `{ dateRange, activityCount, aggregates: {...}, peaks: {...}, zones: {...}, trends: {...} }`

**Files to touch:**
- `apps/server/src/lib/tools/batchAnalysis.ts` (new)
- `apps/server/src/lib/tools/init.ts` (register)
- `apps/web/src/components/trainer/ToolCallCard.tsx` (add meta entry, icon: `Layers`)

**Effort:** ~5-7 hours

---

## 6. Coach Settings & Goal Persistence

**Why:** The coach currently has no memory of the athlete's goals, FTP, maxHR, event dates, or preferences across sessions. Every conversation starts from scratch.

**What:** Persist athlete profile data (goals, FTP, maxHR, event dates, preferences) in the database and inject it into every system prompt.

**Implementation:**

- **DB schema:** New table `athlete_profile` or extend `user_settings`
  ```sql
  -- Option: extend user_settings
  ALTER TABLE user_settings ADD COLUMN athlete_ftp INTEGER;
  ALTER TABLE user_settings ADD COLUMN athlete_max_hr INTEGER;
  ALTER TABLE user_settings ADD COLUMN athlete_goal_event_date TEXT;
  ALTER TABLE user_settings ADD COLUMN athlete_goal_event_name TEXT;
  ALTER TABLE user_settings ADD COLUMN athlete_goal_description TEXT;
  ALTER TABLE user_settings ADD COLUMN athlete_weekly_hours REAL;
  ALTER TABLE user_settings ADD COLUMN athlete_focus_areas TEXT; -- JSON array
  ```

- **API endpoints:**
  - `GET /api/me/athlete-profile` — return current profile
  - `PATCH /api/me/athlete-profile` — update profile fields

- **System prompt integration:**
  - In `buildTrainerAthleteContext`, include athlete profile section:
    ```
    ## Athlete Profile
    - FTP: 265 W (user-provided)
    - Max HR: 188 bpm
    - Goal Event: Gran Fondo Whistler on 2025-09-15
    - Goal: Complete in under 5 hours
    - Available: 6-8 hours/week, 5 days/week
    - Focus: Endurance, climbing
    ```

- **Coach-initiated profile updates:**
  - The coach can suggest profile updates (e.g., "Based on your recent rides, I'd estimate your FTP at 270 W. Should I update your profile?")
  - Add an `update_profile` tool that the coach can call to set values
  - Or: the user confirms in chat and the client calls the PATCH endpoint

- **Client UI:**
  - Settings page section for athlete profile
  - Or: inline editable fields in the trainer sidebar

**Files to touch:**
- `apps/server/src/db.ts` (schema migration)
- `apps/server/src/routes/me.ts` (new profile endpoints)
- `apps/server/src/lib/trainerSystemPrompt.ts` (include profile section)
- `apps/server/src/lib/tools/updateProfile.ts` (new tool, optional)
- `apps/server/src/lib/tools/init.ts` (register if tool approach)
- `packages/shared/src/types.ts` (new `AthleteProfile` type)
- `apps/web/src/components/Settings.tsx` or new profile component

**Effort:** ~6-8 hours

---

## 7. Coach Notification System

**Why:** The coach is purely reactive. It could proactively notify the athlete about training status, recovery needs, or upcoming events.

**What:** A background job that checks athlete state daily and can push notifications (via web push, email, or in-app).

**Implementation:**

- **Background job** (Bun cron or simple setInterval in server):
  - Runs daily (e.g., 7 AM)
  - Checks each user's:
    - Training load (CTL/ATL/TSB) — warn if TSB < -25
    - Health data (RHR, HRV) — warn if elevated RHR or declining HRV
    - Sleep — warn if <6h average
    - Event countdown — remind at phase transitions (Base→Build, Build→Peak, Taper→Race)
    - Weather — suggest ride type based on forecast
  - Generates a brief coach message
  - Stores it as a system message in a "Daily Briefing" thread

- **Notification delivery:**
  - Phase 1: In-app only — a badge/indicator on the trainer tab
  - Phase 2: Web push notifications (Service Worker + Push API)
  - Phase 3: Email (if user configures it)

- **Client changes:**
  - Trainer sidebar shows unread briefing count
  - "Daily Briefing" thread appears in thread list
  - Briefing messages are rendered with a special "auto-generated" indicator

**Files to touch:**
- `apps/server/src/lib/coachNotifications.ts` (new — background job logic)
- `apps/server/src/index.ts` (start background job)
- `apps/server/src/db.ts` (new `coach_notifications` table or use trainer_messages)
- `apps/web/src/components/trainer/TrainerChat.tsx` (briefing thread support)
- `apps/web/src/components/trainer/ThreadList.tsx` (unread badge)
- `apps/web/src/components/trainer/ChatMessageRow.tsx` (auto-generated indicator)

**Effort:** ~8-12 hours (in-app only ~6 hours)
