import type {
	ActivitySummary,
	Interval,
	LapMarker,
	SaveTrainerHistoryBody,
	StoredRecord,
	TrainerMessage,
	UIToolCall,
} from "@fit-analyzer/shared";
import { AVAILABLE_MODELS } from "@fit-analyzer/shared";
import { convertMessagesToModelMessages } from "@tanstack/ai";
import type { ModelMessage } from "@tanstack/ai";
import { Hono } from "hono";
import { db } from "../db.js";
import { getCoachModelSettings } from "../lib/coachModelSettings.js";
import { recomputeSummaryPeakPowers } from "../lib/tools/activityUtils.js";
import {
	compactMessages,
	messageTokenLength,
} from "../lib/compactionEngine.js";
import { getUserId } from "../lib/getUserId.js";
import { getOllamaModels } from "../lib/ollamaModelCache.js";
import {
	parseCoachingMarkdown,
	serializeCoachingMarkdown,
} from "../lib/parseCoachingMarkdown.js";
import {
	fetchCompactionSummary,
	getKimiRequestMetadata,
	getProviderConfig,
	resolveThreadModel,
	sanitizeMessagesForModel,
} from "../lib/providerConfig.js";
import { messageRepo, serializeToolCalls } from "../lib/messageRepo.js";
import { threadRepo } from "../lib/threadRepo.js";
import { getToolDefinitions } from "../lib/tools/registry.js";
import {
	cancelTrainerStream,
	createTrainerStreamConsumer,
	hasActiveTrainerStream,
	startTrainerStreamProducer,
	verifyStreamOwner,
} from "../lib/trainerStreamRegistry.js";
import { createTrainerToolLoop } from "../lib/trainerToolLoop.js";

const BASE_SYSTEM_PROMPT =
	"You are an expert endurance sports coach specialising in cycling and triathlon. " +
	"You receive structured training data from Garmin FIT files and provide concise, actionable coaching feedback. " +
	"When the user shares their activity summary and interval data, analyse power, heart rate and cadence trends " +
	"and give practical training advice.\n\n" +
	"You have access to tools. Use them proactively and without asking permission. If a relevant tool exists for the question " +
	"or topic at hand, call it immediately rather than answering from memory or asking the user whether you should. " +
	"Never explain that you 'can' look something up, and do not ask 'would you like me to check' — just call the tool.\n\n" +
	"If a thread is linked to an activity, activity-specific tools (highlight_chart, analyze_intervals, zone_analysis, etc.) " +
	"automatically use that activity. In general chat, you MUST provide an explicit activityId parameter to any activity-specific tool. " +
	"If you do not know the activityId, ask the user for it rather than guessing.\n\n" +
	"When you need athlete context (health metrics, profile, training history, sleep, recovery), call the health_data tool. " +
	"Do not assume you already know the athlete's FTP, goals, or recovery status — fetch it via health_data.\n\n" +
	"When analysing a ride, you MUST call the weather_history tool to retrieve the heat and humidity conditions for the " +
	"activity's date and location. Heat, apparent (feels-like) temperature, humidity and dew point strongly influence " +
	"heart rate, cardiac drift, perceived exertion and hydration — a higher-than-expected HR or rising drift is often " +
	"explained by a hot/humid day rather than a fitness change. Pull the weather first, then interpret power, heart rate " +
	"and cardiac-drift data in that context and call out any heat/humidity-related effects in your feedback. " +
	"If the activity has a location, derive lat/lng from its records; otherwise ask the user where they rode. " +
	"Resolve the activity date to an absolute YYYY-MM-DD via current_time if it was given relatively.\n\n" +
	"When the user refers to a date or time (e.g. yesterday, last week, a specific day), you MUST call the current_time tool FIRST " +
	"before any other tool, then compute the absolute YYYY-MM-DD date from the current time before calling date-based tools. " +
	"Never guess the current date.\n\n" +
	"When you reference a specific section of a ride, use the highlight_chart tool to draw the user's attention " +
	"to that time range on the chart. This creates a visual overlay so the user can see exactly which portion " +
	"you are discussing. Call highlight_chart at most once per interval or section you discuss.\n\n" +
	"When the athlete confirms a value you suggested (e.g. FTP, max HR, goal event), use the update_profile tool " +
	"to persist it to their profile. Always ask for confirmation before updating their profile.\n\n" +
	"Prefer making parallel calls in a single round rather than sequential rounds. " +
	"Avoid redundant lookups — if you already retrieved activity data, do not fetch it again.";

async function buildSystemPrompt(
	_userId: string,
	_activityId?: string,
): Promise<string> {
	return BASE_SYSTEM_PROMPT;
}

// Active compaction requests by user/thread. Prevents duplicate concurrent
// compactions and gives the UI a way to know that work is in progress.
const activeCompactions = new Map<string, Promise<unknown>>();
function compactionKey(userId: string, threadId: string) {
	return `${userId}:${threadId}`;
}

type TrainerChatRequestBody = {
	messages?: Parameters<typeof convertMessagesToModelMessages>[0];
	threadId?: unknown;
	conversationId?: unknown;
	streamId?: unknown;
};

function getStringBodyValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const trainer = new Hono();

// ─── Inline activity analysis ───────────────────────────────────────────────
// These two statements are activity-analysis specific and stay in the route
// until plan 10 extracts an activityRepo. They are not trainer-concern SQL.

const updateActivityAnalysisStmt = db.prepare(
	"UPDATE activities SET analysis = ?, analysis_tool_calls = ? WHERE id = ? AND user_id = ?",
);

const getActivityStmt = db.prepare(
	`SELECT id, summary, records, laps, intervals, interval_minutes, custom_ranges, analysis, analysis_tool_calls
   FROM activities WHERE id = ? AND user_id = ?`,
);

const ANALYSIS_SYSTEM_PROMPT =
	"You are an expert endurance sports coach specialising in cycling. " +
	"Analyze the provided ride and produce a structured markdown report. " +
	"You have access to tools that can enrich the analysis: " +
	"use zone_analysis for power/heart-rate zone distribution, " +
	"power_curve for the rider's power-duration profile, " +
	"cardiac_drift for aerobic-decoupling trends, " +
	"training_load for recent training context, " +
	"and activity_lookup to compare with similar past rides. " +
	"For any activity-specific tool call, pass the exact activityId provided by the user. " +
	"Call the tools that are relevant to this ride, then base your report on their combined output. " +
	"Use exactly these sections in this order:\n\n" +
	"## Overview\n" +
	"Brief summary of the ride: duration, distance (if available), key metrics.\n\n" +
	"## Intensity Distribution\n" +
	"Describe how power/heart rate was distributed across the ride. Include time-in-zones and reference peak values where relevant.\n\n" +
	"## Key Efforts\n" +
	"Highlight the most notable intervals, climbs, sprints, or sustained efforts. Be specific with durations and watts/HR where available.\n\n" +
	"## Highlights\n" +
	"Mention anything that stands out positively: consistency, pacing, breakthroughs, strong finishes.\n\n" +
	"## Suggestions\n" +
	"Give 2-4 concise, actionable training suggestions based on the data, including recovery and next-workout ideas.\n\n" +
	"Keep the report factual, encouraging, and actionable. Use markdown formatting only.";

function formatRideContext(
	activityId: string,
	activity: {
		summary: ActivitySummary;
		records: StoredRecord[];
		laps: LapMarker[];
		intervals: Interval[];
	},
): string {
	const { summary, records, laps, intervals } = activity;
	const durationMin = Math.round(summary.totalTimerTime / 60);
	let text = `Activity ID: ${activityId}\n`;
	text += `Ride date: ${summary.date}\n`;
	text += `Duration: ${durationMin} minutes\n`;
	if (summary.totalDistanceKm != null)
		text += `Distance: ${summary.totalDistanceKm.toFixed(1)} km\n`;
	if (summary.avgPower != null)
		text += `Average power: ${summary.avgPower} W\n`;
	if (summary.normalizedPower != null)
		text += `Normalized power: ${summary.normalizedPower} W\n`;
	if (summary.maxPower != null) text += `Max power: ${summary.maxPower} W\n`;
	if (summary.avgHeartRate != null)
		text += `Average heart rate: ${summary.avgHeartRate} bpm\n`;
	if (summary.maxHeartRate != null)
		text += `Max heart rate: ${summary.maxHeartRate} bpm\n`;
	if (summary.avgCadence != null)
		text += `Average cadence: ${summary.avgCadence} rpm\n`;
	if (summary.totalWork != null)
		text += `Total work: ${summary.totalWork} kJ\n`;
	if (summary.peak1minPower != null)
		text += `Peak 1 min power: ${summary.peak1minPower} W\n`;
	if (summary.peak5minPower != null)
		text += `Peak 5 min power: ${summary.peak5minPower} W\n`;
	if (summary.peak20minPower != null)
		text += `Peak 20 min power: ${summary.peak20minPower} W\n`;

	text += `\nRecords: ${records.length} data points.\n`;

	if (laps.length > 0) {
		text += `\nLaps (${laps.length}):\n`;
		for (const [i, lap] of laps.entries()) {
			const lapMin = Math.round((lap.endSeconds - lap.startSeconds) / 60);
			text += `- Lap ${i + 1}: ${lapMin} min`;
			if (lap.avgPower != null) text += `, avg ${lap.avgPower} W`;
			if (lap.avgHeartRate != null) text += `, avg HR ${lap.avgHeartRate} bpm`;
			text += "\n";
		}
	}

	if (intervals.length > 0) {
		text += `\nDetected intervals (${intervals.length}):\n`;
		for (const [i, int] of intervals.entries()) {
			const intMin = Math.round(int.duration / 60);
			text += `- Interval ${i + 1}: ${intMin} min`;
			if (int.avgPower != null) text += `, avg ${int.avgPower} W`;
			if (int.normalizedPower != null) text += `, NP ${int.normalizedPower} W`;
			if (int.avgHeartRate != null) text += `, avg HR ${int.avgHeartRate} bpm`;
			text += "\n";
		}
	}

	return text;
}

trainer.post("/analyze/:activityId", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized — missing x-authentik-username header" },
			401,
		);
	}

	const { activityId } = c.req.param();
	const row = getActivityStmt.get(activityId, userId) as {
		id: string;
		summary: string;
		records: string;
		laps: string;
		intervals: string;
		interval_minutes: string;
		custom_ranges: string;
		analysis_tool_calls: string | null;
	} | null;

	if (!row) {
		return c.json({ error: "Activity not found" }, 404);
	}

	const activity = {
		summary: recomputeSummaryPeakPowers(
			JSON.parse(row.summary) as ActivitySummary,
			JSON.parse(row.records) as StoredRecord[],
		),
		records: JSON.parse(row.records) as StoredRecord[],
		laps: JSON.parse(row.laps),
		intervals: JSON.parse(row.intervals || "[]") as Interval[],
	};

	const model = await getCoachModelSettings(userId).then((s) => s.coachModel);
	const providerConfig = await getProviderConfig(model);

	if (!providerConfig.apiKey) {
		return c.json(
			{ error: `${providerConfig.apiKeyEnvName} is not configured` },
			500,
		);
	}

	const systemPrompt = ANALYSIS_SYSTEM_PROMPT;
	const rideContext = formatRideContext(activityId, activity);
	const messages: ModelMessage[] = [
		{
			role: "user",
			content: `Analyze this ride (activityId: ${activityId}).\n\n${rideContext}`,
		},
	];

	const streamId =
		c.req.header("x-stream-id") ??
		c.req.query("streamId") ??
		crypto.randomUUID();
	const existingStreamId =
		c.req.header("x-stream-id") || c.req.query("streamId");

	if (hasActiveTrainerStream(streamId)) {
		if (!verifyStreamOwner(streamId, userId)) {
			return c.json({ error: "Stream not found or already completed" }, 404);
		}
	} else if (!existingStreamId) {
		const stream = createTrainerToolLoop({
			baseUrl: providerConfig.baseUrl,
			apiKey: providerConfig.apiKey,
			model,
			systemPrompt,
			messages,
			provider: providerConfig.provider,
			includeReasoning: providerConfig.includeReasoning,
			threadId: undefined,
			userId,
			tools: getToolDefinitions(),
			abortSignal: c.req.raw.signal,
		});

		let fullText = "";
		const analysisToolCalls: UIToolCall[] = [];
		const wrappedStream = (async function* () {
			try {
				for await (const chunk of stream) {
					if (chunk.type === "TEXT_MESSAGE_CONTENT") {
						const delta =
							"delta" in chunk && typeof chunk.delta === "string"
								? chunk.delta
								: "content" in chunk && typeof chunk.content === "string"
									? chunk.content
									: "";
						fullText += delta;
					} else if (chunk.type === "TOOL_RESULT") {
						const toolChunk = chunk;
						const existing = analysisToolCalls.find(
							(t) => t.id === toolChunk.toolCallId,
						);
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
						const idx = analysisToolCalls.findIndex(
							(t) => t.id === incoming.id,
						);
						if (idx === -1) {
							analysisToolCalls.push(incoming);
						} else {
							analysisToolCalls[idx] = incoming;
						}
					}
					yield chunk;
				}
			} catch (error) {
				console.error(
					`[analyze] Stream error for activity ${activityId}:`,
					error,
				);
				yield {
					type: "RUN_ERROR" as const,
					timestamp: Date.now(),
					error: {
						message: error instanceof Error ? error.message : "Analysis failed",
					},
				};
			} finally {
				if (fullText.trim()) {
					try {
						updateActivityAnalysisStmt.run(
							fullText.trim(),
							serializeToolCalls(analysisToolCalls),
							activityId,
							userId,
						);
					} catch (err) {
						console.error(
							`[analyze] Failed to persist analysis for activity ${activityId}:`,
							err,
						);
					}
				}
			}
		})();

		startTrainerStreamProducer(
			streamId,
			wrappedStream,
			userId,
			undefined,
			c.req.raw.signal,
		);
	}

	return new Response(createTrainerStreamConsumer(streamId), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Stream-Id": streamId,
		},
	});
});

// ─── Chat streaming ───────────────────────────────────────────────────────────

trainer.post("/chat", async (c) => {
	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized — missing x-authentik-username header" },
			401,
		);
	}
	const body: TrainerChatRequestBody = await c.req.json();
	const streamId = getStringBodyValue(body.streamId) ?? crypto.randomUUID();
	const modelMessages = convertMessagesToModelMessages(
		sanitizeMessagesForModel(body.messages ?? []),
	);

	const threadId = getStringBodyValue(body.threadId);
	const thread = threadId ? threadRepo.getById(userId, threadId) : null;
	const model = await resolveThreadModel(thread, userId);
	const providerConfig = await getProviderConfig(model);

	if (!providerConfig.apiKey) {
		return c.json(
			{ error: `${providerConfig.apiKeyEnvName} is not configured` },
			500,
		);
	}

	if (hasActiveTrainerStream(streamId)) {
		if (!verifyStreamOwner(streamId, userId)) {
			return c.json({ error: "Stream not found or already completed" }, 404);
		}
	} else {
		const activityId = thread?.activityId ?? undefined;
		const systemPrompt = await buildSystemPrompt(userId, activityId);
		const tools = getToolDefinitions();
		const metadata = providerConfig.includeReasoning
			? getKimiRequestMetadata(
					userId,
					getStringBodyValue(body.threadId),
					getStringBodyValue(body.conversationId),
				)
			: undefined;

		startTrainerStreamProducer(
			streamId,
			createTrainerToolLoop({
				baseUrl: providerConfig.baseUrl,
				apiKey: providerConfig.apiKey,
				model,
				systemPrompt,
				messages: modelMessages,
				provider: providerConfig.provider,
				includeReasoning: providerConfig.includeReasoning,
				metadata,
				threadId: getStringBodyValue(body.threadId),
				userId,
				tools,
				abortSignal: c.req.raw.signal,
			}),
			userId,
			threadId ?? undefined,
			c.req.raw.signal,
		);
	}

	return new Response(createTrainerStreamConsumer(streamId), {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
});

trainer.get("/chat/:streamId", async (c) => {
	const { streamId } = c.req.param();

	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized — missing x-authentik-username header" },
			401,
		);
	}

	if (!verifyStreamOwner(streamId, userId)) {
		return c.json({ error: "Stream not found or already completed" }, 404);
	}

	if (hasActiveTrainerStream(streamId)) {
		return new Response(createTrainerStreamConsumer(streamId), {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	return c.json({ error: "Stream not found or already completed" }, 404);
});

// ─── Cancel active stream ──────────────────────────────────────────────────────

trainer.delete("/chat/:streamId", (c) => {
	const { streamId } = c.req.param();

	let userId: string;
	try {
		userId = getUserId(c);
	} catch {
		return c.json(
			{ error: "Unauthorized — missing x-authentik-username header" },
			401,
		);
	}

	if (!verifyStreamOwner(streamId, userId)) {
		return c.json({ error: "Stream not found or already completed" }, 404);
	}

	const cancelled = cancelTrainerStream(streamId);
	return c.json({ cancelled });
});

// ─── Models ───────────────────────────────────────────────────────────────────

trainer.get("/models", async (c) => {
	const openRouterModels = AVAILABLE_MODELS.filter(
		(m) => m.provider === "openrouter",
	);
	const ollamaModels = await getOllamaModels();
	return c.json({ models: [...openRouterModels, ...ollamaModels] });
});

// ─── Thread CRUD ──────────────────────────────────────────────────────────────

trainer.get("/threads/:activityId", (c) => {
	const userId = getUserId(c);
	const { activityId } = c.req.param();
	const threads = threadRepo.listByActivity(userId, activityId);
	return c.json({ threads });
});

// Query whether a thread is currently being compacted. The UI polls this
// after triggering a compaction so it can show an in-progress indicator.
trainer.get("/compact/:threadId/status", (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	const running = activeCompactions.has(compactionKey(userId, threadId));
	return c.json({ running });
});

trainer.post("/threads/:activityId", async (c) => {
	const userId = getUserId(c);
	const { activityId } = c.req.param();
	const body = await c.req.json().catch(() => ({}));
	const name: string = (body.name as string | undefined)?.trim() || "Thread 1";
	const model: string | undefined = (
		body.coachModel as string | undefined
	)?.trim();
	const known =
		model &&
		(AVAILABLE_MODELS.find((m) => m.id === model) ||
			(await getOllamaModels()).some((m) => m.id === model));
	const coachModel = known ? model : null;
	const thread = threadRepo.create(userId, activityId, name, coachModel);
	return c.json({ thread });
});

trainer.patch("/threads/:threadId", async (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	const body = await c.req.json();
	const name: string | undefined = (body.name as string | undefined)?.trim();
	const model: string | undefined = (
		body.coachModel as string | undefined
	)?.trim();
	const contextTokens: number | undefined =
		typeof body.contextTokens === "number" &&
		Number.isFinite(body.contextTokens)
			? Math.max(0, Math.floor(body.contextTokens))
			: undefined;
	if (!name && !model && contextTokens === undefined)
		return c.json(
			{ error: "Name, coachModel or contextTokens is required" },
			400,
		);
	if (name) threadRepo.rename(userId, threadId, name);
	if (model) {
		const known =
			AVAILABLE_MODELS.find((m) => m.id === model) ||
			(await getOllamaModels()).some((m) => m.id === model);
		const coachModel = known ? model : null;
		threadRepo.updateModel(userId, threadId, coachModel);
	}
	if (contextTokens !== undefined) {
		threadRepo.updateContextTokens(userId, threadId, contextTokens);
	}
	return c.json({ ok: true });
});

trainer.delete("/threads/:threadId", (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	threadRepo.delete(userId, threadId);
	return c.json({ ok: true });
});

// ─── Thread history ───────────────────────────────────────────────────────────

// In-memory cache for thread token counts. We recalculate on demand, but a
// short TTL prevents repeated full-message scans for frequently refreshed UIs.
const threadTokenCache = new Map<
	string,
	{ tokens: number; expiresAt: number }
>();
const TOKEN_CACHE_TTL_MS = 60_000;

function countThreadContextTokens(
	threadId: string,
	messages: TrainerMessage[],
): number {
	const cached = threadTokenCache.get(threadId);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.tokens;
	}
	const tokens = messages.reduce((sum, m) => sum + messageTokenLength(m), 0);
	threadTokenCache.set(threadId, {
		tokens,
		expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
	});
	return tokens;
}

trainer.get("/history/:threadId", (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	const thread = threadRepo.getById(userId, threadId);
	if (!thread) {
		return c.json({
			threadId,
			messages: [],
			updatedAt: new Date().toISOString(),
			nextCursor: null,
			hasMore: false,
			total: 0,
		});
	}

	const DEFAULT_PAGE_SIZE = 20;
	const MAX_PAGE_SIZE = 100;
	const rawLimit = Number(c.req.query("limit"));
	const limit =
		Number.isFinite(rawLimit) && rawLimit > 0
			? Math.min(MAX_PAGE_SIZE, Math.floor(rawLimit))
			: DEFAULT_PAGE_SIZE;
	const cursor = c.req.query("cursor") ?? null;

	const page = messageRepo.getPage(thread.id, cursor, limit);
	const contextTokens =
		thread.contextTokens != null
			? thread.contextTokens
			: countThreadContextTokens(thread.id, page.messages);

	return c.json({
		threadId,
		messages: page.messages,
		updatedAt: thread.updatedAt,
		nextCursor: page.nextCursor,
		hasMore: page.hasMore,
		total: page.total,
		contextTokens,
	});
});

trainer.put("/history/:threadId", async (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	const thread = threadRepo.getById(userId, threadId);
	if (!thread) return c.json({ error: "Thread not found" }, 404);

	const body: SaveTrainerHistoryBody = await c.req.json();
	const messages: TrainerMessage[] = body.messages ?? [];

	messageRepo.replaceAll(threadId, messages);

	return c.json({ ok: true });
});

// ─── Compact / fork ───────────────────────────────────────────────────────────

trainer.post("/compact/:threadId", async (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();

	// Prevent duplicate concurrent compaction for the same user/thread.
	const key = compactionKey(userId, threadId);
	const existing = activeCompactions.get(key);
	if (existing) {
		try {
			await existing;
		} catch {
			/* ignore previous errors */
		}
	}

	const sourceThread = threadRepo.getById(userId, threadId);
	if (!sourceThread) return c.json({ error: "Thread not found" }, 404);

	const allMessages = messageRepo.getAll(threadId);

	const model = await resolveThreadModel(sourceThread, userId);
	const providerConfig = await getProviderConfig(model);

	if (!providerConfig.apiKey) {
		return c.json(
			{ error: `${providerConfig.apiKeyEnvName} is not configured` },
			500,
		);
	}

	const compactionPromise = (async () => {
		const result = await compactMessages(allMessages, {
			fetchSummary: (prompt, abortSignal) =>
				fetchCompactionSummary(providerConfig, model, prompt, abortSignal),
			abortSignal: c.req.raw.signal,
		});

		if (!result.compacted) {
			return {
				thread: { ...sourceThread, messageCount: allMessages.length },
				messages: allMessages,
				compacted: false as const,
			};
		}

		const forkId = crypto.randomUUID();
		const forkName = `${sourceThread.name} · Compacted`;

		threadRepo.transaction(() => {
			threadRepo.insertWithId(
				forkId,
				userId,
				sourceThread.activityId,
				forkName,
				sourceThread.coachModel,
			);
			messageRepo.insertMany(forkId, result.messages);
		});

		const forkThread = threadRepo.getById(userId, forkId);
		if (!forkThread) throw new Error("Compaction fork thread vanished");

		return {
			thread: { ...forkThread, messageCount: result.messages.length },
			messages: result.messages,
			compacted: true as const,
			removed: result.removed,
		};
	})();

	activeCompactions.set(key, compactionPromise);
	try {
		const result = await compactionPromise;
		return c.json(result);
	} catch (err) {
		const details = err instanceof Error ? err.message : String(err);
		return c.json({ error: "Compaction failed", details }, 500);
	} finally {
		activeCompactions.delete(key);
	}
});

// ─── Fork ─────────────────────────────────────────────────────────────────────

trainer.post("/fork/:threadId", async (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();

	const sourceThread = threadRepo.getById(userId, threadId);
	if (!sourceThread) return c.json({ error: "Thread not found" }, 404);

	const allMessages = messageRepo.getAll(threadId);

	const forkId = crypto.randomUUID();
	const forkName = `${sourceThread.name} \u00b7 Copy`;

	// Give every message a fresh ID so the fork can diverge independently
	const newMessages = allMessages.map((m) => ({
		...m,
		id: crypto.randomUUID(),
	}));

	threadRepo.transaction(() => {
		threadRepo.insertWithId(
			forkId,
			userId,
			sourceThread.activityId,
			forkName,
			sourceThread.coachModel,
		);
		messageRepo.insertMany(forkId, newMessages);
	});

	const forkThread = threadRepo.getById(userId, forkId);
	if (!forkThread) throw new Error("Fork thread vanished");

	return c.json({
		thread: { ...forkThread, messageCount: newMessages.length },
	});
});

// ─── Import ───────────────────────────────────────────────────────────────────

trainer.post("/import", async (c) => {
	const userId = getUserId(c);
	const body = await c.req.parseBody();
	const file = body.file;
	const threadId = body.threadId as string | undefined;

	if (!file || typeof file === "string")
		return c.json({ error: "No file uploaded" }, 400);

	const raw = await (file as File).text();
	if (!raw.trim()) return c.json({ error: "File is empty" }, 400);

	const messages = parseCoachingMarkdown(raw);
	if (messages.length === 0) {
		return c.json(
			{
				error: "No messages found — is this a valid ChatGPT markdown export?",
			},
			400,
		);
	}

	let targetThreadId = threadId;

	if (targetThreadId) {
		const thread = threadRepo.getById(userId, targetThreadId);
		if (!thread) return c.json({ error: "Thread not found" }, 404);
		messageRepo.replaceAll(targetThreadId, messages);
	} else {
		const newThreadId = crypto.randomUUID();
		// Create the thread and seed its messages atomically — a crash
		// between the two would leave an empty thread.
		threadRepo.transaction(() => {
			threadRepo.insertWithId(
				newThreadId,
				userId,
				"general",
				"Imported Chat",
				null,
			);
			messageRepo.replaceAll(newThreadId, messages);
		});
		targetThreadId = newThreadId;
	}

	return c.json({ imported: messages.length, threadId: targetThreadId });
});

// ─── Export ───────────────────────────────────────────────────────────────────

/** Replace characters disallowed in HTTP `filename="…"` with ASCII fallbacks. */
function toAsciiFilenameBase(name: string): string {
	const ascii = name
		.replace(/[^\x20-\x7e]+/g, "_") // collapse any non-ASCII to underscore
		.replace(/[\\/:*?"<>|]+/g, "_")
		.replace(/\s+/g, "_")
		.slice(0, 80);
	return ascii || "thread";
}

trainer.get("/export/:threadId", async (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();

	const thread = threadRepo.getById(userId, threadId);
	if (!thread) return c.json({ error: "Thread not found" }, 404);

	const messages = messageRepo.getAll(threadId);
	if (messages.length === 0) {
		return c.json({ error: "Thread has no messages to export" }, 400);
	}

	const markdown = serializeCoachingMarkdown(messages, {
		title: thread.name,
		coachModel: thread.coachModel,
		createdAt: thread.createdAt,
	});

	// RFC 6266 + RFC 5987: ship an ASCII fallback in filename="…", and the
	// real (possibly unicode) name in filename*=UTF-8"…". All modern browsers
	// honour filename* when present.
	const safeName = `${thread.name.trim() || "thread"}.md`;
	const asciiBase = toAsciiFilenameBase(`${thread.name.trim() || "thread"}.md`);
	const disposition =
		`attachment; filename="${asciiBase}"; ` +
		`filename*=UTF-8''${encodeURIComponent(safeName)}`;

	return new Response(markdown, {
		headers: {
			"Content-Type": "text/markdown; charset=utf-8",
			"Content-Disposition": disposition,
			"Cache-Control": "no-store",
		},
	});
});

export { trainer };
