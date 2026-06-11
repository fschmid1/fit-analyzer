import { Hono } from "hono";
import {
	getUserIdByHaeToken,
	ingestHaePayload,
	clearHaeCache,
	hasHaeToken,
	getHaeLastSync,
} from "../lib/haeClient.js";
import { db } from "../db.js";

const healthAutoExport = new Hono();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) throw new Error("Missing x-authentik-username header");
	return userId;
}

// ─── POST /api/health-auto-export ──── ingest incoming data ─────────────────

healthAutoExport.post("/", async (c) => {
	const apiKey = c.req.header("x-api-key");
	if (!apiKey) {
		return c.json({ error: "Missing X-API-Key header" }, 401);
	}

	const userId = getUserIdByHaeToken(apiKey);
	if (!userId) {
		return c.json({ error: "Invalid API key" }, 401);
	}

	let rawPayload: unknown;
	try {
		rawPayload = await c.req.json();
	} catch (err) {
		console.error("[hae] Failed to parse JSON body:", err);
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	// Health Auto Export sends either {"metrics":[...]} or {"data":{"metrics":[...]}}
	const payload =
		typeof rawPayload === "object" &&
		rawPayload !== null &&
		"data" in rawPayload &&
		typeof (rawPayload as Record<string, unknown>).data === "object" &&
		(rawPayload as Record<string, unknown>).data !== null
			? (rawPayload as Record<string, unknown>).data
			: rawPayload;

	if (
		typeof payload !== "object" ||
		payload === null ||
		!Array.isArray((payload as Record<string, unknown>).metrics)
	) {
		console.error(
			"[hae] Rejected payload (missing metrics array). Raw payload:",
			JSON.stringify(rawPayload).slice(0, 2000),
		);
		return c.json({ error: "Expected JSON with a 'metrics' array" }, 400);
	}

	try {
		const metrics =
			(payload as { metrics?: Array<{ name: string }> }).metrics ?? [];
		const metricNames = metrics.map((m) => m.name);
		console.log(`[hae] Received metric names: ${metricNames.join(", ")}`);
		const result = ingestHaePayload(
			userId,
			payload as {
				metrics?: Array<{
					name: string;
					units: string;
					data: Array<{ date: string; qty: number }>;
				}>;
			},
		);
		console.log(
			`[hae] Ingested ${result.received} metrics for user ${userId}, dates: ${result.dates.join(", ")}`,
		);
		clearHaeCache(userId);
		return c.json(result, 200);
	} catch (err) {
		console.error(`[hae] Ingestion failed for user ${userId}:`, err);
		return c.json(
			{ error: err instanceof Error ? err.message : "Ingestion failed" },
			500,
		);
	}
});

// ─── GET /api/health-auto-export/status ─────────────────────────────────────

healthAutoExport.get("/status", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const configured = hasHaeToken(userId);
	const lastSyncAt = getHaeLastSync(userId);

	const sourceRow = db
		.prepare("SELECT health_source FROM user_settings WHERE user_id = ?")
		.get(userId) as { health_source: string } | undefined;

	return c.json({
		configured,
		lastSyncAt,
		healthSource: sourceRow?.health_source ?? "openwearables",
	});
});

// ─── POST /api/health-auto-export/generate-key ──────────────────────────────

const generateKeyStmt = db.prepare(
	`INSERT INTO user_settings (user_id, hae_api_token) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET hae_api_token = excluded.hae_api_token`,
);

healthAutoExport.post("/generate-key", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const token = crypto.randomUUID().replace(/-/g, "");
	generateKeyStmt.run(userId, token);
	console.log(`[hae] Generated API key for user ${userId}`);

	return c.json({ apiKey: token });
});

// ─── DELETE /api/health-auto-export ──── clear token + history ─────────────

healthAutoExport.delete("/", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}

	db.prepare(
		"UPDATE user_settings SET hae_api_token = NULL, hae_last_sync_at = NULL WHERE user_id = ?",
	).run(userId);
	db.prepare("DELETE FROM hae_health_history WHERE user_id = ?").run(userId);
	clearHaeCache(userId);

	console.log(`[hae] Cleared Health Auto Export data for user ${userId}`);
	return c.json({ ok: true });
});

export { healthAutoExport };
