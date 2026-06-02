import type {
	SaveTrainerHistoryBody,
	TrainerMessage,
} from "@fit-analyzer/shared";
import { AVAILABLE_MODELS, getModelProvider } from "@fit-analyzer/shared";
import { convertMessagesToModelMessages } from "@tanstack/ai";
import { Hono } from "hono";
import { db } from "../db.js";
import { env } from "../env.js";
import { getCoachModelSettings } from "../lib/coachModelSettings.js";
import { getOllamaModels } from "../lib/ollamaModelCache.js";
import { createOllamaTrainerStream } from "../lib/ollamaTrainerStream.js";
import { getHealthContext } from "../lib/owClient.js";
import { parseCoachingMarkdown } from "../lib/parseCoachingMarkdown.js";
import { createTrainerStream } from "../lib/trainerStream.js";
import {
	createTrainerStreamConsumer,
	hasActiveTrainerStream,
	startTrainerStreamProducer,
	verifyStreamOwner,
} from "../lib/trainerStreamRegistry.js";

const BASE_SYSTEM_PROMPT =
	"You are an expert endurance sports coach specialising in cycling and triathlon. " +
	"You receive structured training data from Garmin FIT files and provide concise, actionable coaching feedback. " +
	"When the user shares their activity summary and interval data, analyse power, heart rate and cadence trends " +
	"and give practical training advice.";

async function buildSystemPrompt(userId: string): Promise<string> {
	const { text: healthText } = await getHealthContext(userId);
	const now = new Date();
	const dateTimeText = `Current date and time: ${now.toISOString()}`;
	if (!healthText) return `${BASE_SYSTEM_PROMPT}\n${dateTimeText}`;
	return `${BASE_SYSTEM_PROMPT}\n${dateTimeText}\n${healthText}`;
}

const COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE = 20;

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
            COUNT(m.id) as messageCount
     FROM trainer_chats c
     LEFT JOIN trainer_messages m ON m.chat_id = c.id
     WHERE c.user_id = ? AND c.activity_id = ?
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
);

const getThreadByIdStmt = db.prepare(
	`SELECT id, name, activity_id as activityId, coach_model as coachModel, user_id as userId,
            created_at as createdAt, updated_at as updatedAt
     FROM trainer_chats
     WHERE id = ? AND user_id = ?`,
);

const getMessagesStmt = db.prepare(
	`SELECT id, role, content, created_at as createdAt
     FROM trainer_messages
     WHERE chat_id = ?
     ORDER BY created_at ASC`,
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
	`INSERT INTO trainer_messages (id, chat_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
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
	const modelMessages = convertMessagesToModelMessages(body.messages ?? []);

	const threadId = getStringBodyValue(body.threadId);
	const thread = threadId
		? (getThreadByIdStmt.get(threadId, userId) as
				| { coachModel: string | null }
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

	if (!hasActiveTrainerStream(streamId)) {
		const systemPrompt = await buildSystemPrompt(userId);

		if (providerConfig.provider === "ollama-cloud") {
			startTrainerStreamProducer(
				streamId,
				createOllamaTrainerStream({
					baseUrl: providerConfig.baseUrl,
					apiKey: providerConfig.apiKey,
					model,
					systemPrompt,
					messages: modelMessages,
					threadId: getStringBodyValue(body.threadId),
				}),
				userId,
			);
		} else {
			const metadata = providerConfig.includeReasoning
				? getKimiRequestMetadata(body, userId)
				: undefined;

			startTrainerStreamProducer(
				streamId,
				createTrainerStream({
					baseUrl: providerConfig.baseUrl,
					apiKey: providerConfig.apiKey,
					model,
					systemPrompt,
					messages: modelMessages,
					includeReasoning: providerConfig.includeReasoning,
					metadata,
					threadId: getStringBodyValue(body.threadId),
				}),
				userId,
			);
		}
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
		console.log("resuming stream");
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
	const threads = getThreadsStmt.all(userId, activityId);
	return c.json({ threads });
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
	if (!name && !model)
		return c.json({ error: "Name or coachModel is required" }, 400);
	if (name) renameThreadStmt.run(name, threadId, userId);
	if (model) {
		const known =
			AVAILABLE_MODELS.find((m) => m.id === model) ||
			(await getOllamaModels()).some((m) => m.id === model);
		const coachModel = known ? model : null;
		updateThreadModelStmt.run(coachModel, threadId, userId);
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

trainer.get("/history/:threadId", (c) => {
	const userId = getUserId(c);
	const { threadId } = c.req.param();
	const thread = getThreadByIdStmt.get(threadId, userId) as
		| { id: string; updatedAt: string }
		| undefined;
	if (!thread) {
		return c.json({
			threadId,
			messages: [],
			updatedAt: new Date().toISOString(),
		});
	}
	const messages = getMessagesStmt.all(thread.id) as TrainerMessage[];
	return c.json({ threadId, messages, updatedAt: thread.updatedAt });
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
			insertMessageStmt.run(m.id, threadId, m.role, m.content, m.createdAt);
		}
	})();

	return c.json({ ok: true });
});

// ─── Compact / fork ───────────────────────────────────────────────────────────

trainer.post("/compact/:threadId", async (c) => {
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

	const allMessages = getMessagesStmt.all(threadId) as TrainerMessage[];

	const keepEndIds = new Set<string>();
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

	const cutoffIndex = allMessages.findIndex((m) => keepEndIds.has(m.id));
	const toCompact = cutoffIndex === -1 ? [] : allMessages.slice(0, cutoffIndex);

	if (toCompact.length === 0) {
		return c.json({
			thread: { ...sourceThread, messageCount: allMessages.length },
			messages: allMessages,
			compacted: false,
		});
	}

	const messagesText = toCompact
		.map((m) => `**${m.role === "user" ? "Athlete" : "Coach"}:** ${m.content}`)
		.join("\n\n---\n\n");

	const compactionPrompt = `You are summarizing an older portion of a sports coaching conversation. Compress the following exchange into a concise but complete context summary using markdown. Preserve ALL important details:

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

	const model = await resolveThreadModel(sourceThread, userId);
	const providerConfig = await getProviderConfig(model);

	if (!providerConfig.apiKey) {
		return c.json(
			{ error: `${providerConfig.apiKeyEnvName} is not configured` },
			500,
		);
	}

	const metadata: Record<string, unknown> | undefined =
		providerConfig.includeReasoning
			? {
					app: "fit-analyzer",
					feature: "trainer-compaction",
					context_cache: "openrouter-moonshot-automatic",
					user_id: userId,
					source_thread_id: threadId,
				}
			: undefined;

	const body: Record<string, unknown> = {
		model,
		messages: [{ role: "user", content: compactionPrompt }],
	};

	if (metadata) {
		body.metadata = metadata;
	}

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
				messages: [{ role: "user", content: compactionPrompt }],
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
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(240_000),
		});
	}

	if (!response.ok) {
		const err = await response.json().catch(() => ({}));
		return c.json({ error: "Compaction request failed", details: err }, 500);
	}

	const data = await response.json();
	let summary: string;

	if (providerConfig.provider === "ollama-cloud") {
		summary = data.message?.content ?? "*(Summary unavailable)*";
	} else {
		summary = data.choices?.[0]?.message?.content ?? "*(Summary unavailable)*";
	}

	const firstKeptAt = new Date(allMessages[cutoffIndex].createdAt).getTime();
	const summaryMessage: TrainerMessage = {
		id: crypto.randomUUID(),
		role: "assistant",
		content: `## Context Summary

*The following is a compressed summary of the earlier conversation to preserve context:*

${summary}`,
		createdAt: new Date(firstKeptAt - 1).toISOString(),
	};

	// Give every message a fresh ID — the originals still exist in the source thread
	const newMessages: TrainerMessage[] = [
		summaryMessage,
		...allMessages.slice(cutoffIndex),
	].map((m) => ({ ...m, id: crypto.randomUUID() }));

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
			insertMessageStmt.run(m.id, forkId, m.role, m.content, m.createdAt);
		}
	})();

	const forkThread = getThreadByIdStmt.get(forkId, userId) as {
		id: string;
		name: string;
		activityId: string;
		createdAt: string;
		updatedAt: string;
	};

	return c.json({
		thread: { ...forkThread, messageCount: newMessages.length },
		messages: newMessages,
		compacted: true,
		removed: toCompact.length,
	});
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

	const allMessages = getMessagesStmt.all(threadId) as TrainerMessage[];

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
			insertMessageStmt.run(m.id, forkId, m.role, m.content, m.createdAt);
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
		createThreadStmt.run(targetThreadId, "general", userId, "Imported Chat");
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
			);
		}
	})();

	return c.json({ imported: messages.length, threadId: targetThreadId });
});

export { trainer };
