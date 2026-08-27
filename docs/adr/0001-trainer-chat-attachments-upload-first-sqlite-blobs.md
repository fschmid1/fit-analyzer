# Trainer chat attachments: upload-first, bytes in SQLite

Attachments are uploaded to a dedicated endpoint before the chat message is sent; the message itself stays JSON and references attachments by id. Image bytes live in SQLite (metadata row + blob), not on the filesystem or object storage.

Why upload-first: the chat send rides the existing SSE flow as small JSON, so a flaky mobile connection retries a tiny message instead of megabytes, and a dropped send can't strand a half-multipart chat request. Why SQLite: this is a self-hosted, single-user-per-database app — one-file backups and transactional consistency with the rest of chat data beat the theoretical scaling benefits of filesystem/object storage, at the size caps we enforce (~10MB hard cap, ~300KB after client-side processing).

Attachments are served scoped to the requesting user (Authentik proxy header) with immutable caching, since attachment bytes never change.