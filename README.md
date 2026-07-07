# FIT Analyzer

A web app for analyzing Garmin FIT activity files with interactive charts, interval analysis, Strava integration, and an AI coaching assistant. Built for cyclists who want deep insight into their training data.

## Features

### Activity Analysis
- **Drag-and-drop FIT file upload** with validation and error handling via the official Garmin FIT SDK
- **Interactive chart** showing power, heart rate, cadence, speed, and gradient over time with zoom and pan
- **Click-and-drag selection** on the chart to inspect any time range with instant stats
- **Peak power calculations** for 1-minute and 5-minute rolling windows
- **Interval analysis** — auto-generated from FIT file laps or manually created by selecting ranges on the chart
- **Copyable activity summary** with key metrics and interval data, ready to paste into a training log
- **Direct URL links** to any saved activity for easy sharing

### Activity History
- **Persistent server-side storage** in SQLite — activities survive across devices and sessions
- **Activity list** with smooth spring animations and touch gestures
- **Swipe-to-delete** with a confirmation dialog to prevent accidental removal
- **User-scoped data** via Authentik authentication — each user sees only their own activities

### Strava Integration
- **One-click OAuth connect** to import your Strava ride history
- **Automatic token refresh** so the connection stays alive
- **Manual sync** of recent activities (choose how many days back to pull)
- **Real-time auto-import** via Strava webhooks — new rides appear as soon as you save them
- **Full stream data import** — power, heart rate, cadence, speed, and grade streams are all fetched and analyzed
- **Custom summary computation** from raw stream data, matching Garmin's own calculations

### AI Trainer / Coach
- **Streaming AI chat** that analyzes your activity data and gives actionable coaching feedback
- **Multiple model providers** — OpenRouter (Kimi, Claude, GPT-4o, DeepSeek, etc.), local Ollama, or Ollama Cloud
- **Per-thread model selection** — pick the best model for each conversation
- **Thread management** — create, rename, and delete coaching conversations tied to specific activities
- **Thread forking** — copy a conversation to explore different coaching angles without losing the original
- **Thread compaction** — summarize older messages into a compressed context summary to keep long conversations focused
- **Chat history persistence** — all messages are stored in the database
- **Markdown coaching responses** parsed into rich, readable cards with headers, lists, and highlights
- **Import ChatGPT exports** — bring existing coaching conversations into FIT Analyzer
- **Message actions** — copy, delete, or retry any individual message

### Maintenance & Settings
- **Waxed chain reminders** — track when you last waxed your chain and get reminded after a set distance
- **Settings page** for managing Strava connections, chain reminders, and AI model preferences
- **PWA install prompt** for adding the app to your home screen

## Tech Stack

- React 18 + TypeScript
- Vite 6
- Tailwind CSS 4
- Recharts 3
- Hono (Bun server)
- SQLite (libSQL/Turso)
- Garmin FIT SDK (`@garmin/fitsdk`)
- Strava API + Webhooks
- OpenRouter / Ollama AI APIs
- Authentik SSO

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) or Node.js 18+
- Strava API credentials (optional, for Strava sync)
- OpenRouter or Ollama API key (optional, for AI trainer)
- Authentik instance (for authentication)

### Install & Run

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
bun run build
bun run preview
```

### Docker

```bash
docker compose up
```

Accessible at [http://localhost:3000](http://localhost:3000).

## Project Structure

```
apps/
├── web/
│   ├── src/                 # React app source
│   └── public/              # Source static assets: manifest, icons, screenshots
└── server/
    └── src/                 # Bun API server and static file host
        ├── routes/
        │   ├── activities.ts   # Activity CRUD and interval management
        │   ├── strava.ts       # Strava OAuth, sync, and webhooks
        │   ├── trainer.ts      # AI coach streaming and thread management
        │   └── me.ts           # Current user info
        ├── lib/
        │   ├── trainerStream.ts           # OpenRouter AI streaming
        │   ├── ollamaTrainerStream.ts     # Ollama Cloud AI streaming
        │   ├── parseCoachingMarkdown.ts   # Markdown coaching response parser
        │   ├── coachModelSettings.ts      # AI model preference storage
        │   └── waxedChainReminders.ts     # Chain maintenance reminders
        └── db.ts              # SQLite schema and connection
packages/
└── shared/
    └── src/                   # Shared types and coach model definitions
```

`apps/server/public` is generated at build time by copying `apps/web/dist` and should not be committed.

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required For | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | Always | SQLite database path |
| `STRAVA_CLIENT_ID` | Strava sync | Strava API client ID |
| `STRAVA_CLIENT_SECRET` | Strava sync | Strava API client secret |
| `STRAVA_REDIRECT_URI` | Strava OAuth | Callback URL (e.g. `https://your-domain.com/api/strava/callback`) |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Strava webhooks | Random token for webhook verification |
| `WAHOO_CLIENT_ID` | Wahoo sync | Wahoo API client ID |
| `WAHOO_CLIENT_SECRET` | Wahoo sync | Wahoo API client secret |
| `WAHOO_REDIRECT_URI` | Wahoo OAuth | Callback URL (e.g. `https://your-domain.com/api/wahoo/callback`) |
| `WAHOO_WEBHOOK_TOKEN` | Wahoo webhooks | Random token for webhook authentication |
| `OPENROUTER_KEY` | AI trainer (OpenRouter) | OpenRouter API key |
| `OLLAMA_CLOUD_KEY` | AI trainer (Ollama Cloud) | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | AI trainer (local Ollama) | Local Ollama instance URL |
