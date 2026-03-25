import type {
  ActivityListItem,
  Interval,
  ParsedActivity,
  StoredRecord,
} from "@fit-analyzer/shared";

const API_BASE = "/api";

/** Fetch all activities (summary only, no records) */
export async function fetchActivities(): Promise<ActivityListItem[]> {
  const res = await fetch(`${API_BASE}/activities`);
  if (!res.ok) throw new Error("Failed to fetch activities");
  const data = await res.json();
  return data.activities;
}

/** Fetch a single activity with full records */
export async function fetchActivity(
  id: string
): Promise<
  ParsedActivity & {
    id: string;
    intervals: Interval[];
    intervalMinutes: string;
    customRanges: [number, number][];
  }
> {
  const res = await fetch(`${API_BASE}/activities/${id}`);
  if (!res.ok) throw new Error("Failed to fetch activity");
  const data = await res.json();

  // Convert stored records (ISO string timestamps) back to Date objects
  return {
    id: data.id,
    records: data.records.map((r: StoredRecord) => ({
      ...r,
      timestamp: new Date(r.timestamp),
    })),
    summary: data.summary,
    laps: data.laps,
    intervals: data.intervals ?? [],
    intervalMinutes: data.intervalMinutes ?? "",
    customRanges: data.customRanges ?? [],
  };
}

/** Save a parsed activity to the server, returns the new ID */
export async function saveActivityToServer(
  activity: ParsedActivity
): Promise<string> {
  const body = {
    summary: activity.summary,
    records: activity.records.map((r) => ({
      ...r,
      timestamp: r.timestamp.toISOString(),
    })),
    laps: activity.laps,
  };

  const res = await fetch(`${API_BASE}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Failed to save activity");
  const data = await res.json();
  return data.id;
}

/** Update intervals for an activity */
export async function updateIntervals(
  id: string,
  intervals: Interval[],
  intervalMinutes: string,
  customRanges: [number, number][]
): Promise<void> {
  const res = await fetch(`${API_BASE}/activities/${id}/intervals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intervals, intervalMinutes, customRanges }),
  });
  if (!res.ok) throw new Error("Failed to update intervals");
}

/** Delete an activity by ID */
export async function deleteActivity(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/activities/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) throw new Error("Failed to delete activity");
}
