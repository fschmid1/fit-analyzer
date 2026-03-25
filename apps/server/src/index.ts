import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { activities } from "./routes/activities.js";

const app = new Hono();

// Request logging
app.use("*", logger());

// API routes
app.route("/api/activities", activities);

// In production, serve the built frontend static files
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./public" }));
  // SPA fallback — serve index.html for any unmatched route
  app.use("*", serveStatic({ path: "./public/index.html" }));
}

const port = parseInt(process.env.PORT || "3001", 10);

console.log(`Server starting on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
