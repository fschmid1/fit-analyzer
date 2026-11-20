# Cross-training sessions are not Activities

Athletes wear a watch all day, and intervals.icu receives everything it records:
gym sessions, runs, swims, yoga. The coach plans a week, not a set of rides, so
it needs the whole week. ADR-0005 imported **rides only**, which left the coach
blind to half the training load — exactly the half that explains a flat ride or
a missed session.

The obvious move, importing every completed activity into `activities`, breaks
the product's shape. An **Activity** is a ride: charts, interval detection,
power curves, heatmaps, TSB from power, `analyze_intervals`, `activity_lookup`.
A strength session has no power stream, no distance, and no intervals to
detect. Stored as an Activity it would appear as an empty chart and a broken
analysis, and every aggregate that walks `activities` would start counting it.

## Decision

Keep the two kinds of recorded training separate:

- **Activity**: a recorded ride, imported from per-second records and analysed
  by the app (unchanged).
- **Cross-training session**: any other completed activity from intervals.icu
  (strength, run, swim, row, yoga, …), stored **summary-only** in
  `cross_training_sessions`: date, sport, name, moving/elapsed time, distance,
  average and max heart rate, intervals.icu training load, kilograms lifted
  where the provider reports it, plus the athlete's own notes and tags.

Consequences of that split:

- The importer routes each intervals.icu activity: rides go through the existing
  stream importer; everything else goes through the summary adapter. Strava
  relays are skipped for both, for the same terms reason.
- Sessions are **read-only in the app**. intervals.icu owns the data; there is
  no upload, edit or delete path, and disconnecting leaves them in place like
  imported rides.
- The coach gets a **Cross-Training Sessions** block in its athlete context:
  the last sessions (with their notes and tags) plus 7- and 28-day
  duration/load aggregates. The block says explicitly that these are summaries,
  never to be analysed like a ride.
- `training_load` adds the sessions' intervals.icu load to the same daily
  buckets as ride TSS. The scale is comparable and omitting them would
  understate fatigue. If the athlete has no FTP but does have session load, the
  tool still works from the session load alone.
- The athlete sees them in **Activity History** as a Cross-training section,
  separate from the ride list. Mobile stays first: no new page, same scroll.
- **Planning** opens up with the same model: a planned workout may carry any of
  the supported sports (`Ride`, `WeightTraining`, `Run`, `Swim`, `Rowing`,
  `Yoga`, `Walk`, `Hike`, `Crossfit`, `VirtualRide`). Structured steps remain
  endurance-only; a strength session is prose in the description. intervals.icu
  receives the sport as the event `type`; Google Calendar stores it in a private
  extended property and uses a sport marker in the title.

## Considered options

- **Import every activity as an Activity with null power** — rejected: charts,
  interval detection, peak powers, heatmaps and activity analysis all assume a
  ride. Nulls would spread through every aggregate and every tool to serve one
  context need.
- **Store sessions only in the prompt, not in SQLite** — rejected: the coach
  would re-fetch intervals.icu on every message, the history UI could not show
  them, and the weekly refresh would depend on a live third-party call.
- **Fetch session streams too** — rejected: a strength session's heart-rate
  trace adds little to planning, and the app has no analysis surface for it.
- **Separate UI page for sessions** — rejected for v1: one scroll in Activity
  History keeps behaviour mobile-friendly and the feature discoverable.

## Consequences

- `activities` keeps a single meaning; every existing tool, chart and aggregate
  stays correct without a sport filter.
- The coach is responsible for the distinction: sessions inform load, recovery
  and scheduling, never ride analysis. The prompt states this.
- A session with no heart rate and no load (some watches) is still stored; it
  contributes duration to the aggregates and nothing else.
- Cross-training sessions do not yet contribute to `ActivityStats`, FTP or
  VO₂max estimates — deliberately: those are cycling metrics.
