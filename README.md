# FIT Analyzer

A web app for analyzing Garmin FIT activity files. Upload a `.fit` file to visualize power, heart rate, and cadence data with interactive charts and interval analysis.

## Features

- **Drag-and-drop FIT file upload** with validation and error handling
- **Interactive chart** showing power, heart rate, and cadence over time
- **Peak power calculations** for 1-minute and 5-minute windows
- **Interval analysis** — auto-generated from laps or manually created via chart selection
- **Copyable activity summary** with key metrics and interval data
- **Persistent storage** — activity data survives page refreshes via localStorage

## Tech Stack

- React 18 + TypeScript
- Vite 6
- Tailwind CSS 4
- Recharts 3
- Garmin FIT SDK (`@garmin/fitsdk`)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) or Node.js 18+

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
src/
├── components/
│   ├── ActivityChart.tsx    # Interactive multi-metric chart
│   ├── FileDropZone.tsx     # FIT file upload interface
│   ├── IntervalList.tsx     # Lap & custom interval management
│   ├── StatsBar.tsx         # Selection stats display
│   ├── SummaryCards.tsx     # Activity summary metrics
│   ├── CopyBox.tsx          # Formatted text export
│   ├── MetricCard.tsx       # Individual metric card
│   └── Header.tsx           # App header
├── lib/
│   ├── parseFit.ts          # FIT file parsing via Garmin SDK
│   ├── stats.ts             # Peak power, averages, interval computation
│   ├── formatters.ts        # Text formatting utilities
│   └── storage.ts           # localStorage persistence
├── types/
│   ├── fit.ts               # Core TypeScript interfaces
│   └── garmin-fitsdk.d.ts   # Garmin SDK type definitions
├── App.tsx                  # Root component & state management
└── main.tsx                 # Entry point
```
