import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { activities } from "./routes/activities.js";
import { me } from "./routes/me.js";

const app = new Hono();

// Request logging
app.use("*", logger());

// API routes
app.route("/api/activities", activities);
app.route("/api/me", me);

// Serve the built frontend static files (in production, ./public contains the web build)
app.use("/*", serveStatic({ root: "./public" }));
// SPA fallback — serve index.html for any unmatched route
app.get("*", serveStatic({ root: "./public", path: "index.html" }));

const port = parseInt(process.env.PORT || "3001", 10);

console.log(`Server starting on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
