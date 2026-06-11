import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { env } from "./env.js";
import { activities } from "./routes/activities.js";
import { health } from "./routes/health.js";
import { healthAutoExport } from "./routes/healthAutoExport.js";
import { heatmap } from "./routes/heatmap.js";
import { me } from "./routes/me.js";
import { strava } from "./routes/strava.js";
import { trainer } from "./routes/trainer.js";

const app = new Hono();

// Request logging
app.use("*", logger());

// API routes
app.route("/api/activities", activities);
app.route("/api/health", health);
app.route("/api/health-auto-export", healthAutoExport);
app.route("/api/heatmap", heatmap);
app.route("/api/me", me);
app.route("/api/strava", strava);
app.route("/api/trainer", trainer);

// Serve the built frontend static files (in production, ./public contains the web build)
app.use("/*", serveStatic({ root: "./public" }));
// SPA fallback — serve index.html for any unmatched route
app.get("*", serveStatic({ root: "./public", path: "index.html" }));

const port = env.PORT;

const hostname = "0.0.0.0";

console.log(`Server starting on http://${hostname}:${port}`);

export default {
	port,
	hostname,
	fetch: app.fetch,
	// Allow long-running requests (e.g. LLM compaction) — 255 is the Bun maximum
	idleTimeout: 255,
};
