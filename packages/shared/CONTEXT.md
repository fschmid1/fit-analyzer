# Shared

Cross-app TypeScript contracts exchanged between the server (Bun API) and the web client, plus lightweight shared definitions. Both apps depend on these types; the server owns the behavior behind them.

## Language

### Coach

**Coach**:
The model that writes for the athlete: it answers in trainer chat, produces an activity analysis, and writes the plan-refresh summary. It reads the athlete's training context and replies; the athlete reads the reply.
_Avoid_: trainer, assistant, bot, AI ("trainer" is the feature surface — trainer chat — not the model)

**Verbosity**:
The athlete's chosen level of detail for every coach reply — Concise, Standard or Detailed. It scales the reply shape (bullets, rationale, extra sections) and never changes an activity analysis's fixed sections.
_Avoid_: length, brevity, tone, detail level

### Athlete and activity

**Athlete**:
The person the coach trains and writes for. Distinct from the **Coach**, which writes: the athlete reads the replies, wears the sensors, and owns the profile, zones and goals.
_Avoid_: rider, client, trainee

**Activity**:
A recorded ride: the FIT-derived summary, records, laps and intervals the app stores and analyses. Distinct from a **Planned workout**, which is prescribed rather than recorded.
_Avoid_: session, workout (that word belongs to a Planned workout)

**Cross-training session**:
A completed non-ride training session — strength, run, swim, yoga — the server imports from intervals.icu as a summary: date, sport, duration, heart rate, training load, kilograms lifted, notes and tags. Never records, never charted. Distinct from an **Activity**, which is a ride, and from a **Planned workout**, which is prescribed.
_Avoid_: activity, workout, gym log

**Interval**:
A detected effort block inside an **Activity**: a contiguous stretch at or above a threshold, carrying its own averages. Distinct from a **lap**, which the recording device defines, and from **IntervalsIcu**, the external platform.
_Avoid_: segment, effort block, rep (a rep is one interval within a set)

### Trainer chat

**Attachment**:
An image the user adds to a trainer chat message as visual input for the coach model. Input-only: the coach never generates attachments. Typed by kind, so other file types may join later.
_Avoid_: photo, picture, upload (as a noun for the stored object)

**Attachment ref**:
The lightweight reference a message holds to an attachment (id, kind, dimensions, media type) — never the bytes. A message has text content plus zero or more attachment refs.
_Avoid_: embed, inline image (in the message model)

**Attachment travel rule**:
When building a provider payload, attachments ride with the history slice as-is: every included message carries its own attachments, and compaction ages them out together with the text they belong to. There is no separate image window or replay policy.
_Avoid_: image memory, re-sending images

### Training calendar

**Planned workout**:
A future training session the coach prescribes: date, start time, duration, focus, and description. Distinct from an **Activity**, which is a recorded ride. Planned workouts exist as events on the training calendar; the app keeps no separate plan store.
_Avoid_: scheduled ride, appointment, training plan (the plan as a whole)

**Training timezone**:
The IANA time zone that places planned workouts in the user's day. One athlete-level value, stored in user settings and shared by every plan target; coach scheduling, Plan sync and the weekly refresh all use it. Google captures it once at connect, but it is not owned by a target.
_Avoid_: locale, server time, UTC offset

### Integrations

**Plan target**:
A connected destination that holds the coach's plan for the athlete: a Google **Training calendar** or the athlete's IntervalsIcu calendar. The plan is authored once and synced to every target.
_Avoid_: calendar (the athlete's personal calendars are not plan targets), destination, sink

**IntervalsIcu**:
The external training platform (intervals.icu) that an athlete may connect as a **Plan target** and as a source of completed training: rides become **Activities**, every other completed activity becomes a **Cross-training session**. Written "intervals.icu" in UI copy and `IntervalsIcu` in code; never bare "Intervals", which means detected effort blocks.
_Avoid_: Intervals, ICU, intervals

**Primary plan target**:
The plan target the coach reads back and whose athlete edits are honoured: IntervalsIcu when connected, otherwise the Training calendar. When the primary is disconnected, the next connected target becomes primary.
_Avoid_: source of truth, default calendar

**Projection**:
A plan target that receives the plan but is not read back. It is re-asserted on every Plan sync; an athlete edit made there is reported and then overwritten.
_Avoid_: mirror, replica, export