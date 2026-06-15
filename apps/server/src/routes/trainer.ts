import type {
	ActivitySummary,
	Interval,
	LapMarker,
	SaveTrainerHistoryBody,
	StoredRecord,
	TrainerMessage,
	UIToolCall,
} from "@fit-analyzer/shared";
import {
	APPROX_CHARS_PER_TOKEN,
	AVAILABLE_MODELS,
	getModelProvider,
} from "@fit-analyzer/shared";
import { convertMessagesToModelMessages } from "@tanstack/ai";
import type { ModelMessage, UIMessage } from "@tanstack/ai";
import { Hono } from "hono";
import { db } from "../db.js";
import { env } from "../env.js";
import { getCoachModelSettings } from "../lib/coachModelSettings.js";
import { getOllamaModels } from "../lib/ollamaModelCache.js";
import {
	parseCoachingMarkdown,
	serializeCoachingMarkdown,
} from "../lib/parseCoachingMarkdown.js";
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
	"If a thread is linked to an activity, activity-specific tools (highlight_chart, analyze_intervals, zone_analysis, etc.) " +
	"automatically use that activity. In general chat, you MUST provide an explicit activityId parameter to any activity-specific tool. " +
	"If you do not know the activityId, ask the user for it rather than guessing.\n\n" +
	"When you need athlete context (health metrics, profile, training history, sleep, recovery), call the health_data tool. " +
	"Do not assume you already know the athlete's FTP, goals, or recovery status — fetch it via health_data.\n\n" +
	"When the user refers to a date or time (e.g. yesterday, last week, a specific day), you MUST call the current_time tool FIRST " +
	"before any other tool, then compute the absolute YYYY-MM-DD date from the current time before calling date-based tools. " +
	"Never guess the current date.\n\n" +
	"When you reference a specific section of a ride, use the highlight_chart tool to draw the user's attention " +
	"to that time range on the chart. This creates a visual overlay so the user can see exactly which portion " +
	"you are discussing. Call highlight_chart at most once per interval or section you discuss.\n\n" +
	"When the athlete confirms a value you suggested (e.g. FTP, max HR, goal event), use the update_profile tool " +
	"to persist it to their profile. Always ask for confirmation before updating their profile.\n\n" +
	"Be efficient with tool calls. Prefer making parallel calls in a single round rather than sequential rounds. " +
	"Avoid redundant lookups — if you already retrieved activity data, do not fetch it again.";

async function buildSystemPrompt(
	_userId: string,
	_activityId?: string,
): Promise<string> {
	return BASE_SYSTEM_PROMPT;
}

/**
 * Strip `display` fields from tool-call part outputs before converting to
 * ModelMessages.  The `display` blob is purely for UI rendering and can
 * contain thousands of per-second data points (records, lat/lng, etc.).
 * Keeping it out of the LLM context prevents immediate context bloat.
 */
function sanitizeMessagesForModel(
	messages: Array<UIMessage | ModelMessage>,
): Array<UIMessage | ModelMessage> {
	return messages.map((msg) => {
		if ("parts" in msg && Array.isArray(msg.parts)) {
			const parts = msg.parts.map((part) => {
				if (
					part.type === "tool-call" &&
					part.output &&
					typeof part.output === "object"
				) {
					const output = { ...part.output } as Record<string, unknown>;
					if (output.result && typeof output.result === "object") {
						const result = { ...output.result } as Record<string, unknown>;
						const { display: _, ...resultWithoutDisplay } = result;
						output.result = resultWithoutDisplay;
					}
					return { ...part, output };
				}
				return part;
			});
			return { ...msg, parts };
		}
		return msg;
	});
}

const COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE = 4;

// The Ollama backend supports 262144 tokens. We target a compacted fork that
// fits comfortably, reserving generous space for the system prompt, tool
// definitions, and the user's next message.
const COMPACTION_MAX_CONTEXT_TOKENS = 200_000;
const COMPACTION_RESERVE_TOKENS = 62_144;
const COMPACTION_KEPT_BUDGET_TOKENS =
	COMPACTION_MAX_CONTEXT_TOKENS - COMPACTION_RESERVE_TOKENS;
// Do not summarize more than this many tokens in one LLM call; chunk if needed.
const COMPACTION_MAX_PROMPT_TOKENS = 24_000;
// If a single message exceeds this, it must be summarized rather than kept
// verbatim. Set to a fraction of the kept budget so a few large messages
// can still fit.
const MAX_KEPT_MESSAGE_TOKENS = COMPACTION_KEPT_BUDGET_TOKENS / 4;
// Cap any summary we insert so the compacted fork cannot bloat back up.
const COMPACTION_MAX_SUMMARY_TOKENS = 4_000;

// Active compaction requests by user/thread. Prevents duplicate concurrent
// compactions and gives the UI a way to know that work is in progress.
const activeCompactions = new Map<string, Promise<unknown>>();
function compactionKey(userId: string, threadId: string) {
	return `${userId}:${threadId}`;
}

async function getProviderConfig(modelId: string) {
	const staticProvider = getModelProvider(modelId);
	if (staticProvider === "ollama-cloud") {
		return {
			provider: "ollama-cloud" as const,
			apiKey: env.OLLAMA_CLOUD_KEY,
			apiKeyEnvName: "OLLAMA_CLOUD_KEY",
			baseUrl: env.OLLAMA_BASE_URL,
			includeReasoning: false,
			metadata: undefined,
		};
	}
	if (staticProvider === "openrouter") {
		return {
			provider: "openrouter" as const,
			apiKey: env.OPENROUTER_KEY,
			apiKeyEnvName: "OPENROUTER_KEY",
			baseUrl: "https://openrouter.ai/api/v1",
			includeReasoning: true,
			metadata: undefined,
		};
	}

	// Check dynamic Ollama cache
	const ollamaModels = await getOllamaModels();
	if (ollamaModels.some((m) => m.id === modelId)) {
		return {
			provider: "ollama-cloud" as const,
			apiKey: env.OLLAMA_CLOUD_KEY,
			apiKeyEnvName: "OLLAMA_CLOUD_KEY",
			baseUrl: env.OLLAMA_BASE_URL,
			includeReasoning: false,
			metadata: undefined,
		};
	}

	// Default: openrouter
	return {
		provider: "openrouter" as const,
		apiKey: env.OPENROUTER_KEY,
		apiKeyEnvName: "OPENROUTER_KEY",
		baseUrl: "https://openrouter.ai/api/v1",
		includeReasoning: true,
		metadata: undefined,
	};
}

function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) throw new Error("Missing x-authentik-username header");
	return userId;
}

function parseToolCalls(raw: unknown): UIToolCall[] | undefined {
	if (raw == null || raw === "") return undefined;
	if (typeof raw !== "string") return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return undefined;
		return parsed as UIToolCall[];
	} catch {
		return undefined;
	}
}

function serializeToolCalls(
	toolCalls: UIToolCall[] | undefined,
): string | null {
	if (!toolCalls || toolCalls.length === 0) return null;
	return JSON.stringify(toolCalls);
}

interface MessageRow {
	id: string;
	role: string;
	content: string;
	createdAt: string;
	toolCalls: unknown;
}

function rowToTrainerMessage(row: MessageRow): TrainerMessage {
	const msg: TrainerMessage = {
		id: row.id,
		role: row.role as "user" | "assistant",
		content: row.content,
		createdAt: row.createdAt,
	};
	const toolCalls = parseToolCalls(row.toolCalls);
	if (toolCalls && toolCalls.length > 0) {
		msg.toolCalls = toolCalls;
	}
	return msg;
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

function getKimiRequestMetadata(body: TrainerChatRequestBody, userId: string) {
	const threadId = getStringBodyValue(body.threadId);
	const conversationId = getStringBodyValue(body.conversationId) ?? threadId;

	return {
		app: "fit-analyzer",
		feature: "trainer-chat",
		context_cache: "openrouter-moonshot-automatic",
		user_id: userId,
		...(threadId ? { thread_id: threadId } : {}),
		...(conversationId ? { conversation_id: conversationId } : {}),
	};
}

// ─── Prepared statements ─────────────────────────────────────────────────────

const getThreadsStmt = db.prepare(
	`SELECT c.id, c.name, c.activity_id as activityId, c.coach_model as coachModel,
            c.created_at as createdAt, c.updated_at as updatedAt,
            COUNT(m.id) as messageCount,
            COALESCE(c.context_tokens, SUM(LENGTH(m.content)) / ${APPROX_CHARS_PER_TOKEN}, 0) as contextTokens
     FROM trainer_chats c
     LEFT JOIN trainer_messages m ON m.chat_id = c.id
     WHERE c.user_id = ? AND c.activity_id = ?
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
);

const getThreadByIdStmt = db.prepare(
	`SELECT id, name, activity_id as activityId, coach_model as coachModel, user_id as userId,
            context_tokens as contextTokens, created_at as createdAt, updated_at as updatedAt
     FROM trainer_chats
     WHERE id = ? AND user_id = ?`,
);

const getMessagesStmt = db.prepare(
	`SELECT id, role, content, created_at as createdAt, tool_calls as toolCalls
     FROM trainer_messages
     WHERE chat_id = ?
     ORDER BY created_at ASC, id ASC`,
);

const getMessagesPageStmt = db.prepare(
	`SELECT id, role, content, created_at as createdAt, tool_calls as toolCalls
     FROM trainer_messages
     WHERE chat_id = ?
       AND (created_at < ? OR (created_at = ? AND id < ?))
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
);

const getMessagesLatestStmt = db.prepare(
	`SELECT id, role, content, created_at as createdAt, tool_calls as toolCalls
     FROM trainer_messages
     WHERE chat_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
);

const countMessagesStmt = db.prepare(
	"SELECT COUNT(*) as c FROM trainer_messages WHERE chat_id = ?",
);

const createThreadStmt = db.prepare(
	`INSERT INTO trainer_chats (id, activity_id, user_id, name, coach_model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
);

const renameThreadStmt = db.prepare(
	`UPDATE trainer_chats SET name = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
);

const updateThreadModelStmt = db.prepare(
	`UPDATE trainer_chats SET coach_model = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
);

const updateThreadContextTokensStmt = db.prepare(
	`UPDATE trainer_chats SET context_tokens = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
);

const deleteThreadStmt = db.prepare(
	"DELETE FROM trainer_chats WHERE id = ? AND user_id = ?",
);

const deleteMessagesStmt = db.prepare(
	"DELETE FROM trainer_messages WHERE chat_id = ?",
);

const touchThreadStmt = db.prepare(
	`UPDATE trainer_chats SET updated_at = datetime('now') WHERE id = ?`,
);

const insertMessageStmt = db.prepare(
	`INSERT INTO trainer_messages (id, chat_id, role, content, created_at, tool_calls)
     VALUES (?, ?, ?, ?, ?, ?)`,
);

async function resolveThreadModel(
	thread: { coachModel: string | null } | undefined,
	userId: string,
): Promise<string> {
	if (thread?.coachModel) {
		const known = AVAILABLE_MODELS.find((m) => m.id === thread.coachModel);
		if (known) return known.id;
		const ollamaModels = await getOllamaModels();
		if (ollamaModels.some((m) => m.id === thread.coachModel)) {
			return thread.coachModel;
		}
	}
	const settings = await getCoachModelSettings(userId);
	return settings.coachModel;
}

const trainer = new Hono();

const updateActivityAnalysisStmt = db.prepare(
	"UPDATE activities SET analysis = ? WHERE id = ? AND user_id = ?",
);

const getActivityStmt = db.prepare(
	`SELECT id, summary, records, laps, intervals, interval_minutes, custom_ranges, analysis
   FROM activities WHERE id = ? AND user_id = ?`,
);

// ─── Inline activity analysis ───────────────────────────────────────────────

const ANALYSIS_SYSTEM_PROMPT =
	"You are an expert endurance sports coach specialising in cycling. " +
	"Analyze the provided ride and produce a structured markdown report. " +
	"Use exactly these sections in this order:\n\n" +
	"## Overview\n" +
	"Brief summary of the ride: duration, distance (if available), key metrics.\n\n" +
	"## Intensity Distribution\n" +
	"Describe how power/heart rate was distributed across the ride. Reference peak values where relevant.\n\n" +
	"## Key Efforts\n" +
	"Highlight the most notable intervals, climbs, sprints, or sustained efforts. Be specific with durations and watts/HR where available.\n\n" +
	"## Highlights\n" +
	"Mention anything that stands out positively: consistency, pacing, breakthroughs, strong finishes.\n\n" +
	"## Suggestions\n" +
	"Give 2-4 concise, actionable training suggestions based on the data.\n\n" +
	"Keep the report factual, encouraging, and actionable. Use markdown formatting only.";

function formatRideContext(activity: {
	summary: ActivitySummary;
	records: StoredRecord[];
	laps: LapMarker[];
	intervals: Interval[];
}): string {
	const { summary, records, laps, intervals } = activity;
	const durationMin = Math.round(summary.totalTimerTime / 60);
	let text = `Ride date: ${summary.date}\n`;
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
		analysis: string | null;
	} | null;

	if (!row) {
		return c.json({ error: "Activity not found" }, 404);
	}

	const activity = {
		summary: JSON.parse(row.summary) as ActivitySummary,
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
	const rideContext = formatRideContext(activity);
	const messages: ModelMessage[] = [
		{ role: "user", content: `Analyze this ride.\n\n${rideContext}` },
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
						updateActivityAnalysisStmt.run(fullText.trim(), activityId, userId);
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
	const thread = threadId
		? (getThreadByIdStmt.get(threadId, userId) as
				| { coachModel: string | null; activityId: string }
				| undefined)
		: undefined;
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
		const activityId = thread
			? ((thread as { activityId?: string }).activityId ?? undefined)
			: undefined;
		const systemPrompt = await buildSystemPrompt(userId, activityId);
		const tools = getToolDefinitions();
		const metadata = providerConfig.includeReasoning
			? getKimiRequestMetadata(body, userId)
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
	const threads = (
		getThreadsStmt.all(userId, activityId) as Array<{
			id: string;
			name: string;
			activityId: string;
			coachModel: string | null;
			createdAt: string;
			updatedAt: string;
			messageCount: number;
			contextTokens: number | null;
		}>
	).map((t) => ({
		...t,
		messageCount: t.messageCount ?? 0,
		contextTokens: Math.ceil(t.contextTokens ?? 0),
	}));
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
	const threadId = crypto.randomUUID();
	const known =
		model &&
		(AVAILABLE_MODELS.find((m) => m.id === model) ||
			(await getOllamaModels()).some((m) => m.id === model));
	const coachModel = known ? model : null;
	createThreadStmt.run(threadId, activityId, userId, name, coachModel);
	const thread = getThreadByIdStmt.get(threadId, userId);
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
	if (name) renameThreadStmt.run(name, threadId, userId);
	if (model) {
		const known =
			AVAILABLE_MODELS.find((m) => m.id === model) ||
			(await getOllamaModels()).some((m) => m.id === model);
		const coachModel = known ? model : null;
		updateThreadModelStmt.run(coachModel, threadId, userId);
	}
	if (contextTokens !== undefined) {
		updateThreadContextTokensStmt.run(contextTokens, threadId, userId);
	}
	return c.json({ ok: true });
});

trainer.delete("/threads/:threadId", (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	db.transaction(() => {
		deleteMessagesStmt.run(threadId);
		deleteThreadStmt.run(threadId, userId);
	})();
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
	const thread = getThreadByIdStmt.get(threadId, userId) as
		| { id: string; updatedAt: string; contextTokens: number | null }
		| undefined;
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
	const cursor = c.req.query("cursor");

	let page: MessageRow[];
	if (cursor) {
		const sep = cursor.indexOf("|");
		const cursorCreatedAt = sep === -1 ? cursor : cursor.slice(0, sep);
		const cursorId = sep === -1 ? "" : cursor.slice(sep + 1);
		// SQLite returns UTC ISO strings; keep as-is for the comparison.
		page = getMessagesPageStmt.all(
			thread.id,
			cursorCreatedAt,
			cursorCreatedAt,
			cursorId,
			limit + 1,
		) as MessageRow[];
	} else {
		page = getMessagesLatestStmt.all(thread.id, limit + 1) as MessageRow[];
	}

	const hasMore = page.length > limit;
	const trimmed = hasMore ? page.slice(0, limit) : page;
	// We pulled most-recent-first; flip back to ascending so the chat renders oldest → newest.
	const messages = trimmed.reverse().map(rowToTrainerMessage);

	let nextCursor: string | null = null;
	if (hasMore) {
		const oldest = trimmed[0];
		nextCursor = `${oldest.createdAt}|${oldest.id}`;
	}

	const { c: total } = countMessagesStmt.get(thread.id) as { c: number };
	const contextTokens =
		thread.contextTokens != null
			? thread.contextTokens
			: countThreadContextTokens(thread.id, messages);

	return c.json({
		threadId,
		messages,
		updatedAt: thread.updatedAt,
		nextCursor,
		hasMore,
		total,
		contextTokens,
	});
});

trainer.put("/history/:threadId", async (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	const thread = getThreadByIdStmt.get(threadId, userId);
	if (!thread) return c.json({ error: "Thread not found" }, 404);

	const body: SaveTrainerHistoryBody = await c.req.json();
	const messages: TrainerMessage[] = body.messages ?? [];

	db.transaction(() => {
		deleteMessagesStmt.run(threadId);
		touchThreadStmt.run(threadId);
		for (const m of messages) {
			insertMessageStmt.run(
				m.id,
				threadId,
				m.role,
				m.content,
				m.createdAt,
				serializeToolCalls(m.toolCalls),
			);
		}
	})();

	return c.json({ ok: true });
});

function messageTokenLength(m: TrainerMessage): number {
	let n = Math.ceil(m.content.length / APPROX_CHARS_PER_TOKEN);
	if (m.toolCalls && m.toolCalls.length > 0) {
		for (const tc of m.toolCalls) {
			n += Math.ceil(tc.name.length / APPROX_CHARS_PER_TOKEN);
			n += Math.ceil(
				JSON.stringify(tc.arguments).length / APPROX_CHARS_PER_TOKEN,
			);
			n += tc.result
				? Math.ceil(JSON.stringify(tc.result).length / APPROX_CHARS_PER_TOKEN)
				: 0;
		}
	}
	return n;
}

function estimateTokenLength(text: string): number {
	return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

function computeRecentKeepWindow(
	allMessages: TrainerMessage[],
	targetContextTokens: number,
	reserveTokens: number,
): { keepEndIds: Set<string>; cutoffIndex: number } {
	const keepEndIds = new Set<string>();

	// First pass: keep the most recent N per role.
	let userCount = 0;
	let assistantCount = 0;
	for (let i = allMessages.length - 1; i >= 0; i--) {
		const msg = allMessages[i];
		if (
			msg.role === "user" &&
			userCount < COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE
		) {
			keepEndIds.add(msg.id);
			userCount++;
		} else if (
			msg.role === "assistant" &&
			assistantCount < COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE
		) {
			keepEndIds.add(msg.id);
			assistantCount++;
		}
		if (
			userCount >= COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE &&
			assistantCount >= COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE
		)
			break;
	}

	let cutoffIndex = allMessages.findIndex((m) => keepEndIds.has(m.id));
	if (cutoffIndex === -1) cutoffIndex = allMessages.length;

	// Shrink the kept tail if it alone is already over budget. This handles
	// threads where even the last few messages are enormous (e.g. huge pasted
	// FIT data). We drop oldest first until the budget is met. If the tail
	// still exceeds the budget after dropping everything, the oversized
	// message check in the compaction endpoint will summarize the remaining
	// messages individually.
	const budgetForTail = targetContextTokens - reserveTokens;
	let tailTokens = 0;
	const keptTail: TrainerMessage[] = [];
	for (let i = cutoffIndex; i < allMessages.length; i++) {
		const m = allMessages[i];
		if (!keepEndIds.has(m.id)) continue;
		tailTokens += messageTokenLength(m);
		keptTail.push(m);
	}
	while (tailTokens > budgetForTail && keptTail.length > 0) {
		const removed = keptTail.shift();
		if (!removed) break;
		keepEndIds.delete(removed.id);
		tailTokens -= messageTokenLength(removed);
	}
	cutoffIndex = allMessages.findIndex((m) => keepEndIds.has(m.id));
	if (cutoffIndex === -1) cutoffIndex = allMessages.length;

	return { keepEndIds, cutoffIndex };
}

function formatMessageForCompaction(m: TrainerMessage): string {
	const roleLabel = m.role === "user" ? "Athlete" : "Coach";
	let text = `**${roleLabel}:** ${m.content}`;
	if (m.toolCalls && m.toolCalls.length > 0) {
		text += "\n\n_tools used_";
		for (const tc of m.toolCalls) {
			text += `\n- **${tc.name}**: ${JSON.stringify(tc.arguments)}`;
			if (tc.result) {
				text += ` → ${JSON.stringify(tc.result).slice(0, 1_000)}`;
			}
		}
	}
	return text;
}

function buildCompactionPrompt(messagesText: string): string {
	return `You are summarizing an older portion of a sports coaching conversation. Compress the exchange into a concise but complete context summary using markdown. Preserve ALL important details:

- Training data (power, HR, cadence, intervals, zones)
- Coaching advice and recommendations given
- Athlete goals, profile, and background
- Issues discussed and solutions provided
- Training plans, workouts, or progressions mentioned
- Key insights and patterns identified

Use markdown headers (\`##\`, \`###\`), bullet points, and **bold text** to highlight the most important information. Be thorough - this summary replaces the original messages.

Messages to summarize:

---

${messagesText}`;
}

function truncateSummary(text: string): string {
	const maxChars = COMPACTION_MAX_SUMMARY_TOKENS * APPROX_CHARS_PER_TOKEN;
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}…`;
}

async function fetchCompactionSummary(
	providerConfig: Awaited<ReturnType<typeof getProviderConfig>>,
	model: string,
	prompt: string,
): Promise<string> {
	let response: Response;

	if (providerConfig.provider === "ollama-cloud") {
		response = await fetch(`${providerConfig.baseUrl}/api/chat`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${providerConfig.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: prompt }],
				stream: false,
			}),
			signal: AbortSignal.timeout(240_000),
		});
	} else {
		response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${providerConfig.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: prompt }],
			}),
			signal: AbortSignal.timeout(240_000),
		});
	}

	if (!response.ok) {
		const err = await response.json().catch(() => ({}));
		throw new Error(`Compaction request failed: ${JSON.stringify(err)}`);
	}

	const data = await response.json();
	if (providerConfig.provider === "ollama-cloud") {
		return data.message?.content ?? "*(Summary unavailable)*";
	}
	return data.choices?.[0]?.message?.content ?? "*(Summary unavailable)*";
}

/**
 * Summarize a batch of old messages without exceeding a single LLM prompt.
 * If the batch is too large, split it into chunks, summarize each chunk, then
 * merge the chunk summaries into one final summary.
 */
async function summarizeBatch(
	toCompact: TrainerMessage[],
	providerConfig: Awaited<ReturnType<typeof getProviderConfig>>,
	model: string,
): Promise<string> {
	const messagesText = toCompact
		.map(formatMessageForCompaction)
		.join("\n\n---\n\n");

	const prompt = buildCompactionPrompt(messagesText);
	const promptTokens = estimateTokenLength(prompt);
	if (promptTokens <= COMPACTION_MAX_PROMPT_TOKENS) {
		return fetchCompactionSummary(providerConfig, model, prompt);
	}

	// Split into chunks whose prompts fit under the limit. We leave room for
	// the prompt wrapper so we measure the messages text, not the full prompt.
	const wrapperTokens = estimateTokenLength(buildCompactionPrompt(""));
	const chunkTextTokenBudget = COMPACTION_MAX_PROMPT_TOKENS - wrapperTokens;
	const chunks: TrainerMessage[][] = [];
	let currentChunk: TrainerMessage[] = [];
	let currentChunkTokens = 0;
	for (const msg of toCompact) {
		const msgTokens = estimateTokenLength(formatMessageForCompaction(msg));
		if (
			currentChunkTokens + msgTokens > chunkTextTokenBudget &&
			currentChunk.length > 0
		) {
			chunks.push(currentChunk);
			currentChunk = [msg];
			currentChunkTokens = msgTokens;
		} else {
			currentChunk.push(msg);
			currentChunkTokens += msgTokens;
		}
	}
	if (currentChunk.length > 0) chunks.push(currentChunk);

	const chunkSummaries: string[] = [];
	for (const chunk of chunks) {
		const chunkText = chunk.map(formatMessageForCompaction).join("\n\n---\n\n");
		const chunkPrompt = buildCompactionPrompt(chunkText);
		const summary = await fetchCompactionSummary(
			providerConfig,
			model,
			chunkPrompt,
		);
		chunkSummaries.push(summary);
	}

	const mergedPrompt = `You are merging several partial summaries of a long sports coaching conversation into one coherent, concise context summary. Preserve ALL important details and remove redundancy.

${chunkSummaries.map((s, i) => `## Partial summary ${i + 1}\n\n${s}`).join("\n\n---\n\n")}`;
	return fetchCompactionSummary(providerConfig, model, mergedPrompt);
}

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

	const sourceThread = getThreadByIdStmt.get(threadId, userId) as
		| {
				id: string;
				name: string;
				activityId: string;
				coachModel: string | null;
		  }
		| undefined;
	if (!sourceThread) return c.json({ error: "Thread not found" }, 404);

	const allMessages = (getMessagesStmt.all(threadId) as MessageRow[]).map(
		rowToTrainerMessage,
	);

	const { keepEndIds, cutoffIndex } = computeRecentKeepWindow(
		allMessages,
		COMPACTION_KEPT_BUDGET_TOKENS,
		0,
	);
	const toCompact = cutoffIndex === 0 ? [] : allMessages.slice(0, cutoffIndex);

	if (toCompact.length === 0) {
		return c.json({
			thread: { ...sourceThread, messageCount: allMessages.length },
			messages: allMessages,
			compacted: false,
		});
	}

	const model = await resolveThreadModel(sourceThread, userId);
	const providerConfig = await getProviderConfig(model);

	if (!providerConfig.apiKey) {
		return c.json(
			{ error: `${providerConfig.apiKeyEnvName} is not configured` },
			500,
		);
	}

	const compactionPromise = (async () => {
		let summary: string;
		try {
			summary = await summarizeBatch(toCompact, providerConfig, model);
		} catch (err) {
			const details = err instanceof Error ? err.message : String(err);
			throw new Error(`Compaction failed: ${details}`);
		}

		// The tail we kept verbatim must itself fit under the per-message limit.
		// Any message (user or assistant) that exceeds the limit is summarized
		// so the resulting fork never exceeds the LLM context window.
		const keptMessages = allMessages.slice(cutoffIndex);
		let keptTailSummary: string | undefined;
		const oversizedKeptMessages: TrainerMessage[] = [];
		for (const m of keptMessages) {
			if (messageTokenLength(m) > MAX_KEPT_MESSAGE_TOKENS) {
				oversizedKeptMessages.push(m);
			}
		}
		if (oversizedKeptMessages.length > 0) {
			const keptText = oversizedKeptMessages
				.map(formatMessageForCompaction)
				.join("\n\n---\n\n");
			keptTailSummary = await summarizeBatch(
				[
					{
						id: crypto.randomUUID(),
						role: "user",
						content: keptText,
						createdAt: oversizedKeptMessages[0].createdAt,
					},
				],
				providerConfig,
				model,
			);
		}

		const firstKeptAt =
			cutoffIndex < allMessages.length
				? new Date(allMessages[cutoffIndex].createdAt).getTime()
				: Date.now();

		const newMessages: TrainerMessage[] = [];
		if (summary) {
			newMessages.push({
				id: crypto.randomUUID(),
				role: "assistant",
				content: `## Context Summary\n\n*The following is a compressed summary of the earlier conversation to preserve context:*\n\n${truncateSummary(summary)}`,
				createdAt: new Date(firstKeptAt - 2).toISOString(),
			});
		}
		if (keptTailSummary) {
			newMessages.push({
				id: crypto.randomUUID(),
				role: "assistant",
				content: `## Earlier Message Summary\n\n*A large message from earlier in the thread was also summarized to keep the conversation within the model's context window:*\n\n${truncateSummary(keptTailSummary)}`,
				createdAt: new Date(firstKeptAt - 1).toISOString(),
			});
		}

		for (const m of keptMessages) {
			if (oversizedKeptMessages.includes(m) && keptTailSummary) {
				continue;
			}
			newMessages.push({ ...m, id: crypto.randomUUID() });
		}

		const forkId = crypto.randomUUID();
		const forkName = `${sourceThread.name} · Compacted`;

		db.transaction(() => {
			createThreadStmt.run(
				forkId,
				sourceThread.activityId,
				userId,
				forkName,
				sourceThread.coachModel,
			);
			for (const m of newMessages) {
				insertMessageStmt.run(
					m.id,
					forkId,
					m.role,
					m.content,
					m.createdAt,
					serializeToolCalls(m.toolCalls),
				);
			}
		})();

		const forkThread = getThreadByIdStmt.get(forkId, userId) as {
			id: string;
			name: string;
			activityId: string;
			createdAt: string;
			updatedAt: string;
		};

		return {
			thread: { ...forkThread, messageCount: newMessages.length },
			messages: newMessages,
			compacted: true,
			removed: toCompact.length,
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

	const sourceThread = getThreadByIdStmt.get(threadId, userId) as
		| {
				id: string;
				name: string;
				activityId: string;
				coachModel: string | null;
		  }
		| undefined;
	if (!sourceThread) return c.json({ error: "Thread not found" }, 404);

	const allMessages = (getMessagesStmt.all(threadId) as MessageRow[]).map(
		rowToTrainerMessage,
	);

	const forkId = crypto.randomUUID();
	const forkName = `${sourceThread.name} \u00b7 Copy`;

	// Give every message a fresh ID so the fork can diverge independently
	const newMessages = allMessages.map((m) => ({
		...m,
		id: crypto.randomUUID(),
	}));

	db.transaction(() => {
		createThreadStmt.run(
			forkId,
			sourceThread.activityId,
			userId,
			forkName,
			sourceThread.coachModel,
		);
		for (const m of newMessages) {
			insertMessageStmt.run(
				m.id,
				forkId,
				m.role,
				m.content,
				m.createdAt,
				serializeToolCalls(m.toolCalls),
			);
		}
	})();

	const forkThread = getThreadByIdStmt.get(forkId, userId) as {
		id: string;
		name: string;
		activityId: string;
		coachModel: string | null;
		createdAt: string;
		updatedAt: string;
	};

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
		const thread = getThreadByIdStmt.get(targetThreadId, userId);
		if (!thread) return c.json({ error: "Thread not found" }, 404);
	} else {
		targetThreadId = crypto.randomUUID();
		createThreadStmt.run(
			targetThreadId,
			"general",
			userId,
			"Imported Chat",
			null,
		);
	}

	if (!targetThreadId) {
		return c.json({ error: "Thread not found" }, 404);
	}

	db.transaction(() => {
		deleteMessagesStmt.run(targetThreadId);
		touchThreadStmt.run(targetThreadId);
		for (const m of messages) {
			insertMessageStmt.run(
				m.id,
				targetThreadId,
				m.role,
				m.content,
				m.createdAt,
				serializeToolCalls(m.toolCalls),
			);
		}
	})();

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

	const thread = getThreadByIdStmt.get(threadId, userId) as
		| {
				id: string;
				name: string;
				coachModel: string | null;
				createdAt: string;
		  }
		| undefined;
	if (!thread) return c.json({ error: "Thread not found" }, 404);

	const messages = (getMessagesStmt.all(threadId) as MessageRow[]).map(
		rowToTrainerMessage,
	);
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
