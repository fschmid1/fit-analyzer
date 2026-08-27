# Context Map

## Contexts

- [Shared](./packages/shared/CONTEXT.md) — cross-app contracts: activity records, trainer chat shapes, user settings
- [Server](./apps/server/CONTEXT.md) — Bun HTTP API, SQLite persistence, trainer chat streaming, attachment storage
- [Web](./apps/web/CONTEXT.md) — React/Vite client: FIT parsing, charts, trainer chat UX, attachment capture and viewing

## Relationships

- **Server & Web → Shared**: both apps consume the shared trainer-chat types; the server owns persistence and streaming, the web owns parsing and UX
- **Web → Server**: attachment bytes flow upload-first (`POST /api/trainer/attachments`), chat messages reference attachments by id over the existing SSE chat flow