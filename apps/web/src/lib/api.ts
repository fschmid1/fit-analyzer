import type {
  ActivityListItem,
  Interval,
  ParsedActivity,
  StoredRecord,
  TrainerMessage,
  TrainerChatHistory,
} from "@fit-analyzer/shared";

const API_BASE = "/api";

export interface UserInfo {
  username: string;
  email: string;
  name: string;
}

/** Fetch the current authenticated user info */
export async function fetchCurrentUser(): Promise<UserInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/me`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

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

/** Fetch persisted trainer chat history for an activity */
export async function fetchTrainerHistory(
  activityId: string
): Promise<TrainerChatHistory> {
  const res = await fetch(`${API_BASE}/trainer/history/${activityId}`);
  if (!res.ok) return { activityId, messages: [], updatedAt: new Date().toISOString() };
  return res.json();
}

/** Persist trainer chat messages for an activity (upsert) */
export async function saveTrainerHistory(
  activityId: string,
  messages: TrainerMessage[]
): Promise<void> {
  await fetch(`${API_BASE}/trainer/history/${activityId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

/** Compact old messages in a trainer chat using Kimi K2.5 and save the result */
export async function compactTrainerHistory(
  activityId: string
): Promise<{ messages: TrainerMessage[]; compacted: boolean; removed?: number }> {
  const res = await fetch(`${API_BASE}/trainer/compact/${activityId}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Compaction failed" }));
    throw new Error(err.error ?? "Compaction failed");
  }
  return res.json();
}

/** Upload a ChatGPT-style markdown export and import it as the general coaching chat */
export async function importTrainerChat(
  file: File
): Promise<{ imported: number; chatId: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/trainer/import`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
  }
  return res.json();
}
