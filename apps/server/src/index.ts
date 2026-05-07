import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { env } from "./env.js";
import { activities } from "./routes/activities.js";
import { me } from "./routes/me.js";
import { strava } from "./routes/strava.js";
import { trainer } from "./routes/trainer.js";

const app = new Hono();

// Request logging
app.use("*", logger());

// API routes
app.route("/api/activities", activities);
app.route("/api/me", me);
app.route("/api/strava", strava);
app.route("/api/trainer", trainer);

// Serve the built frontend static files (in production, ./public contains the web build)
app.use("/*", serveStatic({ root: "./public" }));
// SPA fallback — serve index.html for any unmatched route
app.get("*", serveStatic({ root: "./public", path: "index.html" }));

const port = env.PORT;

console.log(`Server starting on http://localhost:${port}`);

export default {
	port,
	fetch: app.fetch,
	// Allow long-running requests (e.g. LLM compaction) — 255 is the Bun maximum
	idleTimeout: 255,
};
