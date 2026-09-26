# Weekly unattended plan refresh

The coach's plan is the Google Calendar (ADR-0002) and was only ever written when the athlete happened to chat. We decided the server refreshes the forward plan on a schedule, with no user present: an hourly tick (the only reason to run sub-daily is per-timezone and DST correctness) runs each opted-in user's refresh when their local clock crosses Sunday 18:00, so the upcoming Mon–Sun Plan week is populated before it starts. Every refresh is an unattended model call that reads the current forward plan back off the calendar, ensures the next week is filled, revises only where recent activity, health, or feedback warrants, and always calls `add_workouts_to_calendar` with the complete forward plan — an idempotent Plan sync, so an unchanged plan is a no-op write. A per-user Refresh watermark makes ticks idempotent and self-heals missed runs: any tick, or startup, where the stored watermark is behind runs a catch-up, and a failed sync leaves the watermark unadvanced so the next tick retries. The refresh reads the user's newest general trainer thread for feedback context and appends the plan narrative there, and a notification fires when a new plan lands (or once when retries are exhausted) rather than silently.

## Considered Options

- **Lazy-on-open or manual-only** — rejected: "definitely every week" must not depend on the athlete showing up.
- **Cron-per-user** — rejected: a fixed cron cannot serve per-user timezones or DST; one hourly tick plus a cheap due-check is simpler and correct.
- **Store the plan and re-assert it without the model** — rejected: ADR-0002 keeps the calendar as the plan, so there is no plan entity to re-write, and a no-model re-assert could not extend the horizon.
- **Reuse the streaming producer for the background run** — rejected: it is built around a client-attached SSE stream and request abort signals; the job drives the tool loop directly and persists the resulting message and tool call.

## Consequences

- A model call happens every week per opted-in user, whether or not the plan changes; that cost is deliberate and should be visible in settings.
- The refresh is opt-in, requires a connected Calendar, and reuses the general trainer thread rather than creating a thread per week.
- The Refresh watermark records when a refresh happened, not what the plan contains — losing it costs an extra refresh, never a lost plan.
