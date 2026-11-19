# One plan, many plan targets

ADR-0002 made Google Calendar the plan of record. Athletes who train with
intervals.icu already execute their workouts there, so a plan that only exists
in a Google calendar is a copy of the truth: intervals.icu owns the athlete's
calendar, its own analysis, and the device-side execution. This ADR keeps the
"no plan table, the target is the store" shape of ADR-0002 but generalizes it:
**one plan, authored once by the coach, written to every connected plan
target**, with intervals.icu primary when connected and Google Calendar a
projection.

## Decision

- A **plan target** is a destination that stores planned workouts. v1 has two:
  `intervalsIcu` and `google`.
- The coach authors a plan **once** and calls a single tool pair,
  `sync_training_plan` / `remove_planned_workouts`. The server fans the plan out
  to every connected target, in parallel, and reports a per-target outcome.
- **Primary target**: intervals.icu when connected, otherwise Google Calendar.
  The primary target is what the coach reads back and what the plan screen
  shows. Everything else is a projection.
- **Projection semantics**: on a projection, the server re-asserts the plan on
  every sync. An athlete edit made on the projection is overwritten and
  reported back to the coach. On the primary target, athlete edits are
  honoured: the sync leaves them alone and reports them as skipped.
- A workout that has **started** is never created, updated or removed, on any
  target, at any time.
- Workouts carry a **sport** and optional **structured steps** (see the neutral
  step model below). v1 accepts only `Ride`.
- The **training timezone** moves to `user_settings.training_timezone`: it
  belongs to the athlete, not to the calendar that happened to capture it. It
  places workouts, defines the Plan week and drives the weekly refresh on every
  target.
- The weekly unattended refresh (ADR-0003) and the interactive coach share the
  same plan guidance and the same sync tool, so the two cannot drift.

## Structured workouts

The neutral model lives in `packages/shared/src/workoutPlan.ts`:

- a step is `{ kind, durationMinutes, target, note }`, where `kind` is
  `warmup | interval | recovery | cooldown | free`;
- a repeat block is `{ repeat, steps }`, one nesting level;
- a target is `{ metric, pct, range? }` with `metric` `power | hr | pace` and
  `pct` a percentage of the athlete's threshold — **never absolute watts**.

Each target renders the model natively:

- intervals.icu gets an event `workout_doc` with per-step `duration` (seconds)
  and `%ftp` / `%lthr` / `%pace` targets, so the workout is executable there;
- Google Calendar gets readable text in the event body;
- the plan screen shows a compact summary.

The structured model is additive: a workout without `steps` is still valid and
stays prose-only.

## Activity import

The same connection also imports completed rides. Import is per-second streams
plus this app's own interval detection — never the provider's pre-computed
summary or its interval detection — so an imported ride behaves exactly like
one imported from Strava or a FIT upload.

- v1 asks for **rides only**; Strava-sourced activities are skipped because
  intervals.icu serves only a stub for them and Strava's terms forbid
  re-downloading their data through a third party.
- A **five-minute poll** covers completed activities; "Sync now" runs the same
  importer on demand.
- Connecting offers an opt-in **90-day backfill**, run as a background job with
  progress shown in Settings.
- **Same-ride dedupe**: when a ride is already stored from Strava or a FIT
  upload, the intervals.icu id is stamped onto the existing row instead of
  creating a duplicate. Match is same wall-clock start (±2 min, in the training
  timezone) and a similar duration.
- Failures are per-activity and do not abort the pass. A revoked key
  (`401`/`403`) stops the poller instead of hammering the API; a persistently
  failing key produces **one** notification after N consecutive failures.

## Connection

- v1 authenticates with the athlete's **personal API key** (HTTP Basic,
  username `API_KEY`), which intervals.icu blesses for an athlete's own data.
- OAuth is a later, additive path: it needs an app registered per deployment and
  approval, an external and unbounded wait. Webhooks require the OAuth app, so
  they are out of v1 as well; the importer seam does not change when they land.
- **Disconnect forgets the key only.** Planned workouts already on
  intervals.icu stay in place — the same rule as the Google calendar.

## Considered options

- **Keep Google only** — rejected: the athlete executes in intervals.icu, so
  every coach change would need a manual copy, and the plan screen would show a
  plan nobody trains.
- **Two separate tools (`sync_calendar`, `sync_intervals_icu`)** — rejected:
  the same plan would be authored twice and drift immediately; per-target
  outcomes belong in one result, not in two tool calls.
- **Absolute watts in step targets** — rejected: thresholds move, and the
  targets already know the athlete's zones. Percentages keep one plan valid
  across FTP changes and across targets.
- **Provider interval detection** — rejected: the app already analyses rides
  from records; importing the provider's summary would make the same ride look
  different depending on where it came from.
- **A plan table** — still rejected for the reasons in ADR-0002: the target is
  the store, and projections remain disposable.

## Consequences

- A plan read needs a live API call to the primary target; the plan screen and
  the coach's prompt share that read. A read failure degrades to "no plan
  visible" rather than blocking chat.
- intervals.icu has no per-event metadata slot we own, so writes are tracked in
  a small `plan_sync_marks` table (sync key → last write time) purely to tell
  athlete edits apart from our own writes. It is not a plan store.
- Google-only users see no behaviour change: Google stays primary and its
  athlete edits are still honoured.
- Disconnecting intervals.icu leaves the projection stale until the next sync
  or disconnect of the calendar; events are never deleted on disconnect.
