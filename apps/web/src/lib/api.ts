import {
	AVAILABLE_MODELS,
	type ActivityListItem,
	type ActivityStats,
	type CoachModelSettings,
	type HealthData,
	type HeatmapResponse,
	type Interval,
	type ModelEntry,
	type OpenwearablesSettings,
	type ParsedActivity,
	type StravaClubEvent,
	type StoredRecord,
	type TrainerChatHistory,
	type TrainerMessage,
	type TrainerThread,
	type WaxedChainReminderSettings,
} from "@fit-analyzer/shared";

const API_BASE = "/api";

export interface UserInfo {
	username: string;
	email: string;
	name: string;
}

export interface UserSettingsResponse {
	waxedChainReminder: WaxedChainReminderSettings;
	coachModel: CoachModelSettings;
	favoriteModels: string[];
	openwearables: OpenwearablesSettings;
}

export async function fetchCurrentUser(): Promise<UserInfo | null> {
	try {
		const res = await fetch(`${API_BASE}/me`);
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

export interface StatsResponse {
	health: HealthData | null;
	activityStats: ActivityStats;
}

export async function fetchStats(
	startDate: string,
	endDate: string,
): Promise<StatsResponse> {
	const res = await fetch(
		`${API_BASE}/health?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
	);
	if (!res.ok) throw new Error("Failed to fetch stats");
	return res.json();
}

export async function fetchHeatmap(
	startDate: string,
	endDate: string,
): Promise<HeatmapResponse> {
	const res = await fetch(
		`${API_BASE}/heatmap?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
	);
	if (!res.ok) throw new Error("Failed to fetch heatmap data");
	return res.json();
}

export async function fetchUserSettings(): Promise<UserSettingsResponse> {
	const res = await fetch(`${API_BASE}/me/settings`);
	if (!res.ok) throw new Error("Failed to fetch settings");
	return res.json();
}

export async function updateWaxedChainReminderSettings(input: {
	enabled: boolean;
	thresholdKm: number;
	ntfyTopic: string;
}): Promise<WaxedChainReminderSettings> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});

	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update settings" }));

	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update settings",
		);
	}

	return (data as UserSettingsResponse).waxedChainReminder;
}

export async function updateCoachModelSettings(input: {
	coachModel: string;
}): Promise<CoachModelSettings> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ coachModel: input.coachModel }),
	});

	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update settings" }));

	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update settings",
		);
	}

	return (data as UserSettingsResponse).coachModel;
}

export async function updateFavoriteModels(
	favoriteModels: string[],
): Promise<string[]> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ favoriteModels }),
	});

	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update favorites" }));

	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update favorites",
		);
	}

	return (data as UserSettingsResponse).favoriteModels;
}

export async function resetWaxedChainReminderProgress(): Promise<WaxedChainReminderSettings> {
	const res = await fetch(`${API_BASE}/me/settings/waxed-chain/reset`, {
		method: "POST",
	});

	const data = await res
		.json()
		.catch(() => ({ error: "Failed to reset reminder progress" }));

	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to reset reminder progress",
		);
	}

	return (data as UserSettingsResponse).waxedChainReminder;
}

export async function sendWaxedChainReminderTest(): Promise<void> {
	const res = await fetch(`${API_BASE}/me/settings/waxed-chain/send-test`, {
		method: "POST",
	});

	const data = await res
		.json()
		.catch(() => ({ error: "Failed to send test notification" }));

	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to send test notification",
		);
	}
}

export async function updateOpenwearablesSettings(input: {
	owUserId: string;
}): Promise<OpenwearablesSettings> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ owUserId: input.owUserId }),
	});

	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update settings" }));

	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update settings",
		);
	}

	return (data as UserSettingsResponse).openwearables;
}

export async function fetchActivities(): Promise<ActivityListItem[]> {
	const res = await fetch(`${API_BASE}/activities`);
	if (!res.ok) throw new Error("Failed to fetch activities");
	const data = await res.json();
	return data.activities;
}

export async function fetchActivity(id: string): Promise<
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

export async function saveActivityToServer(
	activity: ParsedActivity,
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

export async function updateIntervals(
	id: string,
	intervals: Interval[],
	intervalMinutes: string,
	customRanges: [number, number][],
): Promise<void> {
	const res = await fetch(`${API_BASE}/activities/${id}/intervals`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intervals, intervalMinutes, customRanges }),
	});
	if (!res.ok) throw new Error("Failed to update intervals");
}

export async function deleteActivity(id: string): Promise<void> {
	const res = await fetch(`${API_BASE}/activities/${id}`, { method: "DELETE" });
	if (!res.ok && res.status !== 404)
		throw new Error("Failed to delete activity");
}

// ─── Threads ─────────────────────────────────────────────────────────────────

export async function fetchThreads(
	activityId: string,
): Promise<TrainerThread[]> {
	const res = await fetch(`${API_BASE}/trainer/threads/${activityId}`);
	if (!res.ok) return [];
	const data = await res.json();
	return data.threads ?? [];
}

export async function createThread(
	activityId: string,
	name: string,
): Promise<TrainerThread> {
	const res = await fetch(`${API_BASE}/trainer/threads/${activityId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	if (!res.ok) throw new Error("Failed to create thread");
	const data = await res.json();
	return data.thread;
}

export async function renameThread(
	threadId: string,
	name: string,
): Promise<void> {
	await fetch(`${API_BASE}/trainer/threads/${threadId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
}

export async function updateThreadModel(
	threadId: string,
	coachModel: string,
): Promise<void> {
	await fetch(`${API_BASE}/trainer/threads/${threadId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ coachModel }),
	});
}

export async function deleteThread(threadId: string): Promise<void> {
	await fetch(`${API_BASE}/trainer/threads/${threadId}`, { method: "DELETE" });
}

// ─── History ─────────────────────────────────────────────────────────────────

export async function fetchTrainerHistory(
	threadId: string,
): Promise<TrainerChatHistory> {
	const res = await fetch(`${API_BASE}/trainer/history/${threadId}`);
	if (!res.ok)
		return { threadId, messages: [], updatedAt: new Date().toISOString() };
	return res.json();
}

export async function saveTrainerHistory(
	threadId: string,
	messages: TrainerMessage[],
): Promise<void> {
	await fetch(`${API_BASE}/trainer/history/${threadId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messages }),
	});
}

export async function compactTrainerHistory(threadId: string): Promise<{
	thread: TrainerThread;
	messages: TrainerMessage[];
	compacted: boolean;
}> {
	const res = await fetch(`${API_BASE}/trainer/compact/${threadId}`, {
		method: "POST",
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Compaction failed" }));
		throw new Error((err as { error?: string }).error ?? "Compaction failed");
	}
	return res.json();
}

export async function forkThread(threadId: string): Promise<TrainerThread> {
	const res = await fetch(`${API_BASE}/trainer/fork/${threadId}`, {
		method: "POST",
	});
	if (!res.ok) throw new Error("Failed to fork thread");
	const data = await res.json();
	return data.thread;
}

// ─── Strava ───────────────────────────────────────────────────────────────────

export interface StravaStatus {
	connected: boolean;
	athleteId?: number;
	scope?: string;
}

export async function fetchStravaStatus(): Promise<StravaStatus> {
	const res = await fetch(`${API_BASE}/strava/status`);
	if (!res.ok) return { connected: false };
	return res.json();
}

export async function syncStravaActivities(
	daysBack: number | "all" = 30,
): Promise<{ imported: number; updated: number }> {
	const res = await fetch(`${API_BASE}/strava/sync?daysBack=${daysBack}`, {
		method: "POST",
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Sync failed" }));
		throw new Error((err as { error?: string }).error ?? "Sync failed");
	}
	return res.json();
}

export async function disconnectStrava(): Promise<void> {
	await fetch(`${API_BASE}/strava/disconnect`, { method: "DELETE" });
}

export function connectStrava(): void {
	window.location.href = `${API_BASE}/strava/connect`;
}

export async function registerStravaWebhook(): Promise<{ id: number }> {
	const res = await fetch(`${API_BASE}/strava/webhook/subscription`, {
		method: "POST",
	});
	const data = await res.json();
	if (!res.ok)
		throw new Error(
			(data as { error?: string }).error ?? "Registration failed",
		);
	return data;
}

export async function unregisterStravaWebhook(): Promise<void> {
	const res = await fetch(`${API_BASE}/strava/webhook/subscription`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({ error: "Failed" }));
		throw new Error(
			(data as { error?: string }).error ?? "Failed to remove webhook",
		);
	}
}

export async function fetchStravaEvents(): Promise<StravaClubEvent[]> {
	const res = await fetch(`${API_BASE}/strava/events`);
	if (!res.ok) return [];
	const data = (await res.json()) as { events?: StravaClubEvent[] };
	return data.events ?? [];
}

export async function fetchRouteGpx(
	routeId: string,
): Promise<[number, number][]> {
	const res = await fetch(`${API_BASE}/strava/routes/${routeId}/gpx`);
	if (!res.ok) return [];
	const data = (await res.json()) as {
		coordinates?: [number, number][];
	};
	return data.coordinates ?? [];
}

// ─── Trainer ─────────────────────────────────────────────────────────────────

export async function fetchAvailableModels(): Promise<ModelEntry[]> {
	const res = await fetch(`${API_BASE}/trainer/models`);
	if (!res.ok) return [...AVAILABLE_MODELS];
	const data = (await res.json()) as { models?: ModelEntry[] };
	return data.models ?? [...AVAILABLE_MODELS];
}

export async function importTrainerChat(
	file: File,
	threadId?: string,
): Promise<{ imported: number; threadId: string }> {
	const form = new FormData();
	form.append("file", file);
	if (threadId) form.append("threadId", threadId);
	const res = await fetch(`${API_BASE}/trainer/import`, {
		method: "POST",
		body: form,
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Upload failed" }));
		throw new Error((err as { error?: string }).error ?? "Upload failed");
	}
	return res.json();
}
