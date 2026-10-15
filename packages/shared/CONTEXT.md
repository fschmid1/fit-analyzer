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
The IANA time zone that places planned workouts in the user's day. Captured when the Calendar connection is made; coach scheduling and Plan sync both use it.
_Avoid_: locale, server time, UTC offset