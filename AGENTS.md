# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Bun HTTP API and production web host. Owns SQLite access, activity persistence, Strava integration, trainer/chat streaming, and serving the built web app from `apps/server/public`.
- `apps/web`: React/Vite client for FIT analysis. Owns FIT file parsing in the browser, charting and interval UX, activity history, trainer UI, Strava connect flows, and user-facing settings.
- `packages/shared`: Shared TypeScript types exchanged between server and web, including activity records, summaries, interval payloads, trainer chat shapes, and user settings. Keep this package focused on cross-app contracts and lightweight shared definitions.

Prefer keeping domain logic in the package that owns the behavior. Move code into `packages/shared` only when both apps truly depend on the same types or logic.
