# Server

Bun HTTP API and production web host. Owns SQLite access, activity persistence, Strava integration, trainer chat streaming, attachment storage, and the training calendar.

## Language

### Trainer chat

**Attachment**:
An image the user adds to a trainer chat message as visual input for the coach model. Input-only: the coach never generates attachments. Bytes live in SQLite, referenced by id.
_Avoid_: photo, picture, upload (as a noun for the stored object)

**Attachment GC**:
The transactional sweep after a thread's message history is replaced that deletes attachment rows with zero references across the user's messages. Also covers uploads that were never sent.
_Avoid_: orphan cleanup, blob pruning

**Attachment travel rule**:
When building a provider payload, attachments ride with the history slice as-is: every included message carries its own attachments, and compaction ages them out together with the text they belong to. There is no separate image window or replay policy.
_Avoid_: image memory, re-sending images

**Upload-first**:
The flow where attachment bytes are POSTed to a dedicated endpoint before the chat message is sent; the message itself stays JSON and references attachments by id.
_Avoid_: inline upload, multipart chat send

### Training calendar

**Planned workout**:
A future training session the coach prescribes: date, start time, duration, focus, and description. Distinct from an **Activity**. Planned workouts exist as events on the training calendar; the app keeps no separate plan store.
_Avoid_: scheduled ride, appointment, training plan (the plan as a whole)

**Training calendar**:
The dedicated Google Calendar the app creates and owns for planned workouts, separated from the user's personal calendars by construction.
_Avoid_: fitness calendar, subscribed feed

**Calendar connection**:
The per-user authorization that lets the server act on the user's Google Calendar. One per user: connected or not.
_Avoid_: google login, google account link

**Plan sync**:
The whole-plan upsert that makes the training calendar match the plan the coach emits: creates, updates in place, and deletes the app's future planned-workout events. Never touches events that have already started or that the user has edited in Google since the last sync.
_Avoid_: calendar import, one-way export

**Sync key**:
The deterministic key the server computes for each planned workout and stamps into the calendar event, so Plan sync can recognise its own events across runs without duplicating them.
_Avoid_: plan id, workout id (there is no stored plan entity)

**Plan week**:
The Mon–Sun calendar week in the athlete's training timezone; the unit a Plan refresh keeps current.
_Avoid_: rolling week, next 7 days

**Plan refresh**:
The regeneration and Plan sync of the coach's forward plan that makes the upcoming Plan week current, whether it runs on the weekly schedule or on demand. Always a Plan sync, so an unchanged plan writes nothing new.
_Avoid_: replan, reschedule

**Refresh watermark**:
The per-user marker of the Plan week most recently refreshed, which keeps Plan refresh idempotent across ticks and self-heals missed runs. It records when a refresh happened, not what the plan contains — the calendar remains the plan.
_Avoid_: plan version, last sync (that name belongs to health integrations)
