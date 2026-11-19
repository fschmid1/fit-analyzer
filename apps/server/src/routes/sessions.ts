import { Hono } from "hono";
import { getUserId } from "../lib/getUserId.js";
import { crossTrainingSessionRepo } from "../lib/crossTrainingSessionRepo.js";

/**
 * Cross-training sessions: completed non-ride activities (strength, run, swim,
 * …) imported from intervals.icu as summaries. Read-only — the source of truth
 * is intervals.icu, and the coach never writes here.
 */

const sessions = new Hono();

/** GET /api/sessions — the athlete's sessions, newest first. */
sessions.get("/", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized: missing X-authentik-username header" },
			401,
		);
	}
	return c.json({ sessions: crossTrainingSessionRepo.list(userId) });
});

export { sessions };
