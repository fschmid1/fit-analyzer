# Training plan lives in Google Calendar, not in the database

The coach's training plans have no structured home — plans are chat prose. To give the user their plan on a calendar we decided the **calendar is the plan**: no `training_plans`/`planned_workouts` tables, no plan editor. The coach pushes a whole plan via a tool that idempotently syncs (create/update/delete) a dedicated Google Calendar ("Training") which the app creates on connect, substituting the app's brand of plan-of-record for a plan entity. Sync keys are derived server-side (date + start time + kind, stamped into event extended properties — model-supplied keys rejected as corruptingly unstable) so re-syncs update in place, delete plan-absent future events, skip events the user edited in Google, and never touch started events. Tokens ride the existing `OAuth2Flow` (`google_tokens` table, Strava pattern); scope is broad `calendar` so the app can create its own calendar.

## Considered Options

- **ICS webcal feed** — rejected: Google subscribed calendars are read-only and polled ~daily, killing same-day schedule revisions; OAuth's cost was low because `OAuth2Flow` already existed.
- **User-picks-an-existing-calendar with `calendar.events` scope** — rejected for v1: broader scope buys one-click setup and a calendar owned by the app; a manual-ID, events-only reduction stays available as a fallback.
- **Persisted plan entity + calendar as projection** (cf. `plans/03` item 2) — deferred: a plan-editor project, not a calendar one; upsert-by-key events survive that migration if it happens.

## Consequences

- Google is the plan's storage: deleting the calendar or revoking access loses the plan-of-record (events themselves stay, since disconnect never deletes the calendar).
- The GCP app must stay published in production **without verification** — in Testing mode refresh tokens die after 7 days; unverified production shows a one-time warning screen instead.
- "The user's day" requires a stored IANA timezone (captured from the browser at connect, kept alongside the Calendar connection) — the server has no other notion of the user's local time.