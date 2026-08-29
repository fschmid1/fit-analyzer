# Shared

Cross-app TypeScript contracts exchanged between the server (Bun API) and the web client, plus lightweight shared definitions. Both apps depend on these types; the server owns the behavior behind them.

## Language

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