import {
	AVAILABLE_MODELS,
	type ActivityListItem,
	type ActivityStats,
	type AthleteProfile,
	type CoachModelSettings,
	type CompareSettings,
	type HealthData,
	type HealthHistoryEntry,
	type HeatmapResponse,
	type HealthAutoExportSettings,
	type HealthSource,
	type Interval,
	type ModelEntry,
	type OpenwearablesSettings,
	type ParsedActivity,
	type StravaClubEvent,
	type StoredRecord,
	type ToolStreamChunk,
	type TrainerChatHistory,
	type TrainerMessage,
	type TrainerThread,
	type UpdateAthleteProfileBody,
	type UIToolCall,
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
	compare: CompareSettings;
	healthAutoExport: HealthAutoExportSettings;
	athleteProfile: AthleteProfile;
	inferredLocation: string | null;
	estimatedFtp: number | null;
	estimatedMaxHr: number | null;
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
	sourceUsed: "openwearables" | "health_auto_export" | null;
	lastSyncAt: string | null;
	history: HealthHistoryEntry[];
	estimatedFtp: number | null;
	estimatedVo2max: number | null;
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

export async function updateCompareSettings(input: {
	compareThreadIds?: string[];
	compareEnabled?: boolean;
}): Promise<CompareSettings> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update compare settings" }));
	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update compare settings",
		);
	}
	return (data as UserSettingsResponse).compare;
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
		analysis?: string | null;
		analysisToolCalls?: UIToolCall[];
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
		analysis: data.analysis ?? null,
		analysisToolCalls: data.analysisToolCalls ?? undefined,
	};
}

export interface StreamActivityAnalysisCallbacks {
	onText?: (text: string) => void;
	onToolChunk?: (chunk: ToolStreamChunk) => void;
	onError?: (error: { message: string }) => void;
	/** Called with the server-assigned stream id when the request starts. */
	onStreamId?: (streamId: string) => void;
}

export async function streamActivityAnalysis(
	activityId: string,
	callbacks: StreamActivityAnalysisCallbacks,
	signal?: AbortSignal,
	resumeStreamId?: string,
): Promise<{ text: string; toolCalls: UIToolCall[] }> {
	const headers: Record<string, string> = {};
	if (resumeStreamId) {
		headers["x-stream-id"] = resumeStreamId;
	}
	const res = await fetch(`${API_BASE}/trainer/analyze/${activityId}`, {
		method: "POST",
		signal,
		headers,
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({ error: "Analysis failed" }));
		throw new Error((data as { error?: string }).error ?? "Analysis failed");
	}

	const streamId = res.headers.get("x-stream-id") ?? undefined;
	if (streamId) {
		callbacks.onStreamId?.(streamId);
	}

	const reader = res.body?.getReader();
	if (!reader) throw new Error("Analysis response body is not readable");

	const decoder = new TextDecoder();
	let buffer = "";
	let accumulated = "";
	const toolCalls: UIToolCall[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const events = buffer.split("\n\n");
		buffer = events.pop() ?? "";

		for (const event of events) {
			const dataLine = event
				.split("\n")
				.find((line) => line.startsWith("data: "));
			if (!dataLine) continue;
			const payload = dataLine.slice(6).trim();
			if (payload === "[DONE]") {
				callbacks.onText?.(accumulated);
				return { text: accumulated, toolCalls };
			}
			if (!payload) continue;
			try {
				const chunk = JSON.parse(payload) as
					| {
							type: string;
							delta?: string;
							content?: string;
							error?: { message?: string };
					  }
					| ToolStreamChunk;

				if (chunk.type === "RUN_ERROR") {
					const message =
						"error" in chunk && chunk.error?.message
							? chunk.error.message
							: "Analysis stream reported an error";
					callbacks.onError?.({ message });
					throw new Error(message);
				}

				if (chunk.type === "TEXT_MESSAGE_CONTENT") {
					const delta =
						typeof (chunk as { delta?: string }).delta === "string"
							? (chunk as { delta: string }).delta
							: typeof (chunk as { content?: string }).content === "string"
								? (chunk as { content: string }).content
								: "";
					accumulated += delta;
					callbacks.onText?.(accumulated);
				}

				if (chunk.type === "TOOL_RESULT") {
					const toolChunk = chunk as ToolStreamChunk;
					callbacks.onToolChunk?.(toolChunk);
					const existing = toolCalls.find((t) => t.id === toolChunk.toolCallId);
					const incoming: UIToolCall = {
						id: toolChunk.toolCallId,
						name: toolChunk.toolName,
						arguments: existing?.arguments ?? {},
						status: toolChunk.error ? "error" : "done",
						result: {
							id: toolChunk.toolCallId,
							name: toolChunk.toolName,
							content: toolChunk.content,
							display: toolChunk.display,
							error: toolChunk.error,
						},
					};
					const idx = toolCalls.findIndex((t) => t.id === incoming.id);
					if (idx === -1) {
						toolCalls.push(incoming);
					} else {
						toolCalls[idx] = incoming;
					}
				}
			} catch {
				// Ignore malformed chunks so the stream stays resilient.
			}
		}
	}

	if (signal?.aborted) {
		throw new Error("Analysis aborted");
	}

	callbacks.onText?.(accumulated);
	return { text: accumulated, toolCalls };
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

import { randomUUID } from "./randomUUID";

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
	coachModel?: string,
): Promise<TrainerThread> {
	const res = await fetch(`${API_BASE}/trainer/threads/${activityId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, coachModel }),
	});
	if (!res.ok) throw new Error("Failed to create thread");
	const data = await res.json();
	return data.thread;
}

export async function appendAnalysisToThread(
	threadId: string,
	analysis: string,
	toolCalls?: UIToolCall[],
): Promise<void> {
	const history = await fetchTrainerHistory(threadId, undefined, { limit: 1 });
	const now = new Date().toISOString();
	const newMessages: TrainerMessage[] = [
		{
			id: randomUUID(),
			role: "user",
			content:
				"Here is the generated analysis for this ride. Let's discuss it and dig deeper where useful.",
			createdAt: now,
		},
		{
			id: randomUUID(),
			role: "assistant",
			content: analysis,
			createdAt: now,
			...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
		},
	];
	await saveTrainerHistory(threadId, [...history.messages, ...newMessages]);
}

export async function createThreadWithAnalysis(
	activityId: string,
	analysis: string,
	toolCalls?: UIToolCall[],
	name = "Analysis follow-up",
	coachModel?: string,
): Promise<TrainerThread> {
	const thread = await createThread(activityId, name, coachModel);
	await appendAnalysisToThread(thread.id, analysis, toolCalls);
	return thread;
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

export async function updateThreadContextTokens(
	threadId: string,
	contextTokens: number,
): Promise<void> {
	await fetch(`${API_BASE}/trainer/threads/${threadId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ contextTokens }),
	});
}

export async function deleteThread(threadId: string): Promise<void> {
	await fetch(`${API_BASE}/trainer/threads/${threadId}`, { method: "DELETE" });
}

export async function getMostRecentThread(
	activityId: string,
): Promise<TrainerThread | null> {
	const threads = await fetchThreads(activityId);
	if (threads.length === 0) return null;
	return threads.reduce((latest, t) =>
		new Date(t.updatedAt) > new Date(latest.updatedAt) ? t : latest,
	);
}

export async function fetchTrainerHistory(
	threadId: string,
	signal?: AbortSignal,
	options?: { cursor?: string | null; limit?: number },
): Promise<TrainerChatHistory> {
	const params = new URLSearchParams();
	if (options?.cursor) params.set("cursor", options.cursor);
	if (options?.limit) params.set("limit", String(options.limit));
	const qs = params.toString();
	const url = `${API_BASE}/trainer/history/${threadId}${qs ? `?${qs}` : ""}`;
	const res = await fetch(url, { signal });
	if (!res.ok)
		return {
			threadId,
			messages: [],
			updatedAt: new Date().toISOString(),
			nextCursor: null,
			hasMore: false,
			total: 0,
		};
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

export async function compactTrainerHistory(
	threadId: string,
	signal?: AbortSignal,
): Promise<{
	thread: TrainerThread;
	messages: TrainerMessage[];
	compacted: boolean;
}> {
	const res = await fetch(`${API_BASE}/trainer/compact/${threadId}`, {
		method: "POST",
		signal,
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Compaction failed" }));
		throw new Error((err as { error?: string }).error ?? "Compaction failed");
	}
	return res.json();
}

export async function getCompactionStatus(
	threadId: string,
): Promise<{ running: boolean }> {
	const res = await fetch(`${API_BASE}/trainer/compact/${threadId}/status`);
	if (!res.ok) return { running: false };
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

export interface StravaEventsPage {
	events: StravaClubEvent[];
	hasMore: boolean;
	total: number;
}

export async function fetchStravaEvents(
	page = 1,
	perPage = 20,
): Promise<StravaEventsPage> {
	const res = await fetch(
		`${API_BASE}/strava/events?page=${page}&perPage=${perPage}`,
	);
	if (!res.ok) {
		const data = await res.json().catch(() => ({ error: "Failed" }));
		throw new Error(
			(data as { error?: string }).error ?? "Failed to fetch Strava events",
		);
	}
	const data = (await res.json()) as StravaEventsPage;
	return data;
}

export async function fetchRouteGpx(routeId: string): Promise<{
	coordinates: ([number, number] | [number, number, number])[];
	gpx: string | null;
}> {
	const res = await fetch(`${API_BASE}/strava/routes/${routeId}/gpx`);
	if (!res.ok) return { coordinates: [], gpx: null };
	const data = (await res.json()) as {
		coordinates?: ([number, number] | [number, number, number])[];
		gpx?: string | null;
	};
	return {
		coordinates: data.coordinates ?? [],
		gpx: data.gpx ?? null,
	};
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

/** Extract a filename from a `Content-Disposition: attachment; filename="…"` header. */
function parseContentDispositionFilename(header: string | null): string | null {
	if (!header) return null;
	const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export async function exportTrainerThread(
	threadId: string,
): Promise<{ filename: string; markdown: string }> {
	const res = await fetch(`${API_BASE}/trainer/export/${threadId}`);
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Export failed" }));
		throw new Error((err as { error?: string }).error ?? "Export failed");
	}
	const filename =
		parseContentDispositionFilename(res.headers.get("Content-Disposition")) ??
		`thread-${threadId}.md`;
	const markdown = await res.text();
	return { filename, markdown };
}

// ─── Health Auto Export ────────────────────────────────────────────────────

export async function fetchHaeStatus(): Promise<{
	configured: boolean;
	lastSyncAt?: string | null;
	healthSource?: HealthSource;
}> {
	const res = await fetch(`${API_BASE}/health-auto-export/status`);
	if (!res.ok) throw new Error("Failed to fetch HAE status");
	return res.json();
}

export async function generateHaeKey(): Promise<{ apiKey: string }> {
	const res = await fetch(`${API_BASE}/health-auto-export/generate-key`, {
		method: "POST",
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Failed" }));
		throw new Error(
			(err as { error?: string }).error ?? "Failed to generate key",
		);
	}
	return res.json();
}

export async function clearHaeSettings(): Promise<void> {
	const res = await fetch(`${API_BASE}/health-auto-export`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Failed" }));
		throw new Error((err as { error?: string }).error ?? "Failed to clear");
	}
}

export async function updateHealthSource(
	healthSource: HealthSource,
): Promise<HealthAutoExportSettings> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ healthSource }),
	});
	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update health source" }));
	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update health source",
		);
	}
	return (data as UserSettingsResponse).healthAutoExport;
}

export async function updateAthleteProfile(
	input: UpdateAthleteProfileBody,
): Promise<AthleteProfile> {
	const res = await fetch(`${API_BASE}/me/settings`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await res
		.json()
		.catch(() => ({ error: "Failed to update athlete profile" }));
	if (!res.ok) {
		throw new Error(
			(data as { error?: string }).error ?? "Failed to update athlete profile",
		);
	}
	return (data as UserSettingsResponse).athleteProfile;
}
