import { Hono } from "hono";
import { db } from "../db.js";
import type {
  ActivityListItem,
  StoredActivity,
  CreateActivityBody,
} from "@fit-analyzer/shared";

const activities = new Hono();

// GET /activities — list all activities (summary only, no records)
activities.get("/", (c) => {
  const rows = db
    .prepare(
      `SELECT id, date, summary, created_at as createdAt
       FROM activities
       ORDER BY date DESC, created_at DESC`
    )
    .all() as { id: string; date: string; summary: string; createdAt: string }[];

  const items: ActivityListItem[] = rows.map((row) => ({
    id: row.id,
    date: row.date,
    summary: JSON.parse(row.summary),
    createdAt: row.createdAt,
  }));

  return c.json({ activities: items });
});

// GET /activities/:id — full activity with records + laps
activities.get("/:id", (c) => {
  const { id } = c.req.param();

  const row = db
    .prepare(
      `SELECT id, date, summary, records, laps, created_at as createdAt
       FROM activities
       WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        date: string;
        summary: string;
        records: string;
        laps: string;
        createdAt: string;
      }
    | undefined;

  if (!row) {
    return c.json({ error: "Activity not found" }, 404);
  }

  const activity: StoredActivity = {
    id: row.id,
    date: row.date,
    summary: JSON.parse(row.summary),
    records: JSON.parse(row.records),
    laps: JSON.parse(row.laps),
    createdAt: row.createdAt,
  };

  return c.json(activity);
});

// POST /activities — save a new activity
activities.post("/", async (c) => {
  const body = await c.req.json<CreateActivityBody>();

  if (!body.summary || !body.records || !body.laps) {
    return c.json({ error: "Missing required fields: summary, records, laps" }, 400);
  }

  const id = crypto.randomUUID();
  const date = body.summary.date;

  db.prepare(
    `INSERT INTO activities (id, date, summary, records, laps)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    date,
    JSON.stringify(body.summary),
    JSON.stringify(body.records),
    JSON.stringify(body.laps)
  );

  return c.json({ id }, 201);
});

// DELETE /activities/:id — delete an activity
activities.delete("/:id", (c) => {
  const { id } = c.req.param();

  const result = db.prepare("DELETE FROM activities WHERE id = ?").run(id);

  if (result.changes === 0) {
    return c.json({ error: "Activity not found" }, 404);
  }

  return c.body(null, 204);
});

export { activities };
