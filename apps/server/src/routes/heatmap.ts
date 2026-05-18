import { Hono } from "hono";
import { db } from "../db.js";
import type { HeatmapPoint, HeatmapResponse } from "@fit-analyzer/shared";

const heatmap = new Hono();

function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) {
		throw new Error("Missing x-authentik-username header");
	}
	return userId;
}

const recordsStmt = db.prepare(
	`SELECT records FROM activities
   WHERE user_id = ? AND date >= ? AND date <= ?
   ORDER BY date ASC`,
);

function computeHeatmap(
	userId: string,
	startDate: string,
	endDate: string,
): HeatmapResponse {
	const rows = recordsStmt.all(userId, startDate, endDate) as {
		records: string;
	}[];

	const points: HeatmapPoint[] = [];
	const thinBy = 5;

	for (const row of rows) {
		const recs = JSON.parse(row.records) as Array<{
			lat: number | null;
			lng: number | null;
		}>;
		for (let i = 0; i < recs.length; i += thinBy) {
			const r = recs[i];
			if (r.lat != null && r.lng != null) {
				points.push({ lat: r.lat, lng: r.lng });
			}
		}
	}

	return { points };
}

heatmap.get("/", (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized: missing x-authentik-username header" },
			401,
		);
	}

	const startDate = c.req.query("startDate");
	const endDate = c.req.query("endDate");

	if (!startDate || !endDate) {
		return c.json(
			{ error: "Missing required query params: startDate, endDate" },
			400,
		);
	}

	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
		!/^\d{4}-\d{2}-\d{2}$/.test(endDate)
	) {
		return c.json(
			{ error: "startDate and endDate must be in YYYY-MM-DD format" },
			400,
		);
	}

	const data = computeHeatmap(userId, startDate, endDate);
	return c.json(data);
});

export { heatmap };
