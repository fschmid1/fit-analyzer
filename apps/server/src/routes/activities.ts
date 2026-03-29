import { Hono } from "hono";
import { db } from "../db.js";
import type {
  ActivityListItem,
  StoredActivity,
  CreateActivityBody,
  UpdateIntervalsBody,
} from "@fit-analyzer/shared";

const activities = new Hono();

/** Extract the authenticated user ID from Authentik proxy headers */
function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
  const userId = c.req.header("x-authentik-username");
  if (!userId) {
    throw new Error("Missing X-authentik-username header");
  }
  return userId;
}

// Prepared statements for performance — now scoped by user_id
const listStmt = db.prepare(
  `SELECT id, date, summary, created_at as createdAt
   FROM activities
   WHERE user_id = ?
   ORDER BY date DESC, created_at DESC`
);

const getStmt = db.prepare(
  `SELECT id, date, summary, records, laps, intervals, interval_minutes, custom_ranges, created_at as createdAt
   FROM activities
   WHERE id = ? AND user_id = ?`
);

const insertStmt = db.prepare(
  `INSERT INTO activities (id, date, summary, records, laps, intervals, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const updateIntervalsStmt = db.prepare(
  `UPDATE activities SET intervals = ?, interval_minutes = ?, custom_ranges = ? WHERE id = ? AND user_id = ?`
);

const deleteStmt = db.prepare("DELETE FROM activities WHERE id = ? AND user_id = ?");

// GET /activities — list all activities for the current user (summary only, no records)
activities.get("/", (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized: missing X-authentik-username header" }, 401);
  }

  const rows = listStmt.all(userId) as {
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

// GET /activities/:id — full activity with records + laps (scoped to current user)
activities.get("/:id", (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized: missing X-authentik-username header" }, 401);
  }

  const { id } = c.req.param();

  const row = getStmt.get(id, userId) as
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

// POST /activities — save a new activity for the current user
activities.post("/", async (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized: missing X-authentik-username header" }, 401);
  }

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
    JSON.stringify(body.intervals ?? []),
    userId
  );

  return c.json({ id }, 201);
});

// PATCH /activities/:id/intervals — update intervals for an activity (scoped to current user)
activities.patch("/:id/intervals", async (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized: missing X-authentik-username header" }, 401);
  }

  const { id } = c.req.param();
  const body = await c.req.json<UpdateIntervalsBody>();

  if (!Array.isArray(body.intervals)) {
    return c.json({ error: "Missing required field: intervals" }, 400);
  }

  const result = updateIntervalsStmt.run(
    JSON.stringify(body.intervals),
    body.intervalMinutes ?? "",
    JSON.stringify(body.customRanges ?? []),
    id,
    userId
  );

  if (result.changes === 0) {
    return c.json({ error: "Activity not found" }, 404);
  }

  return c.json({ ok: true });
});

// DELETE /activities/:id — delete an activity (scoped to current user)
activities.delete("/:id", (c) => {
  let userId: string;
  try {
    userId = getUserId(c);
  } catch {
    return c.json({ error: "Unauthorized: missing X-authentik-username header" }, 401);
  }

  const { id } = c.req.param();

  const result = deleteStmt.run(id, userId);

  if (result.changes === 0) {
    return c.json({ error: "Activity not found" }, 404);
  }

  return c.body(null, 204);
});

export { activities };
