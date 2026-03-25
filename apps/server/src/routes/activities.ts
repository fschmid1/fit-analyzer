import { Hono } from "hono";
import { db } from "../db.js";
import type {
  ActivityListItem,
  StoredActivity,
  CreateActivityBody,
  UpdateIntervalsBody,
} from "@fit-analyzer/shared";

const activities = new Hono();

// Prepared statements for performance
const listStmt = db.prepare(
  `SELECT id, date, summary, created_at as createdAt
   FROM activities
   ORDER BY date DESC, created_at DESC`
);

const getStmt = db.prepare(
  `SELECT id, date, summary, records, laps, intervals, interval_minutes, custom_ranges, created_at as createdAt
   FROM activities
   WHERE id = ?`
);

const insertStmt = db.prepare(
  `INSERT INTO activities (id, date, summary, records, laps, intervals)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const updateIntervalsStmt = db.prepare(
  `UPDATE activities SET intervals = ?, interval_minutes = ?, custom_ranges = ? WHERE id = ?`
);

const deleteStmt = db.prepare("DELETE FROM activities WHERE id = ?");

// GET /activities — list all activities (summary only, no records)
activities.get("/", (c) => {
  const rows = listStmt.all() as {
    id: string;
    date: string;
    summary: string;
    createdAt: string;
  }[];

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

  const row = getStmt.get(id) as
    | {
        id: string;
        date: string;
        summary: string;
        records: string;
        laps: string;
        intervals: string;
        interval_minutes: string;
        custom_ranges: string;
        createdAt: string;
      }
    | null;

  if (!row) {
    return c.json({ error: "Activity not found" }, 404);
  }

  const activity: StoredActivity = {
    id: row.id,
    date: row.date,
    summary: JSON.parse(row.summary),
    records: JSON.parse(row.records),
    laps: JSON.parse(row.laps),
    intervals: JSON.parse(row.intervals || "[]"),
    intervalMinutes: row.interval_minutes || "",
    customRanges: JSON.parse(row.custom_ranges || "[]"),
    createdAt: row.createdAt,
  };

  return c.json(activity);
});

// POST /activities — save a new activity
activities.post("/", async (c) => {
  const body = await c.req.json<CreateActivityBody>();

  if (!body.summary || !body.records || !body.laps) {
    return c.json(
      { error: "Missing required fields: summary, records, laps" },
      400
    );
  }

  const id = crypto.randomUUID();
  const date = body.summary.date;

  insertStmt.run(
    id,
    date,
    JSON.stringify(body.summary),
    JSON.stringify(body.records),
    JSON.stringify(body.laps),
    JSON.stringify(body.intervals ?? [])
  );

  return c.json({ id }, 201);
});

// PATCH /activities/:id/intervals — update intervals for an activity
activities.patch("/:id/intervals", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<UpdateIntervalsBody>();

  if (!Array.isArray(body.intervals)) {
    return c.json({ error: "Missing required field: intervals" }, 400);
  }

  const result = updateIntervalsStmt.run(
    JSON.stringify(body.intervals),
    body.intervalMinutes ?? "",
    JSON.stringify(body.customRanges ?? []),
    id
  );

  if (result.changes === 0) {
    return c.json({ error: "Activity not found" }, 404);
  }

  return c.json({ ok: true });
});

// DELETE /activities/:id — delete an activity
activities.delete("/:id", (c) => {
  const { id } = c.req.param();

  const result = deleteStmt.run(id);

  if (result.changes === 0) {
    return c.json({ error: "Activity not found" }, 404);
  }

  return c.body(null, 204);
});

export { activities };
