# Web

React/Vite client for FIT analysis. Owns FIT file parsing in the browser, charting and interval UX, activity history, trainer chat UI, Strava connect flows, and user-facing settings.

## Language

### Coach

**Coach**:
The model whose replies the web renders as markdown in trainer chat and activity analysis. The athlete picks which model plays the coach in Settings.
_Avoid_: trainer, assistant, bot, AI

**Tool card**:
The interactive card the web renders from one coach tool call (zone breakdown, power curve, weather, calendar sync), collapsed to a labelled header until the athlete expands it. The coach's prompt states these are already on screen, so a reply interprets a card instead of restating it.
_Avoid_: tool output, tool result box, widget

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
An image the user adds to a trainer chat message as visual input for the coach model. Input-only: the coach never generates attachments.
_Avoid_: photo, picture, upload (as a noun for the stored object)

**Attachment travel rule**:
When building a provider payload, attachments ride with the history slice as-is: every included message carries its own attachments, and compaction ages them out together with the text they belong to. There is no separate image window or replay policy.
_Avoid_: image memory, re-sending images

**Upload-first**:
The flow where attachment bytes are POSTed to a dedicated endpoint before the chat message is sent; the message itself stays JSON and references attachments by id.
_Avoid_: inline upload, multipart chat send