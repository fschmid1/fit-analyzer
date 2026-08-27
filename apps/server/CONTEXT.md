# Server

Bun HTTP API and production web host. Owns SQLite access, activity persistence, Strava integration, trainer chat streaming, and attachment storage.

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