import {
    chat,
    convertMessagesToModelMessages,
    toServerSentEventsResponse,
} from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { Hono } from "hono";
import { env } from "../env.js";
import { db } from "../db.js";
import type { TrainerMessage, SaveTrainerHistoryBody } from "@fit-analyzer/shared";
import { parseCoachingMarkdown } from "../lib/parseCoachingMarkdown.js";

const SYSTEM_PROMPT =
    "You are an expert endurance sports coach specialising in cycling and triathlon. " +
    "You receive structured training data from Garmin FIT files and provide concise, actionable coaching feedback. " +
    "When the user shares their activity summary and interval data, analyse power, heart rate and cadence trends " +
    "and give practical training advice.";

/** Extract authenticated user ID from Authentik proxy headers */
function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
    const userId = c.req.header("x-authentik-username");
    if (!userId) throw new Error("Missing x-authentik-username header");
    return userId;
}

// Prepared statements
const getChatStmt = db.prepare(
    `SELECT id, updated_at as updatedAt
     FROM trainer_chats
     WHERE user_id = ? AND activity_id = ?`
);

const getMessagesStmt = db.prepare(
    `SELECT id, role, content, created_at as createdAt
     FROM trainer_messages
     WHERE chat_id = ?
     ORDER BY created_at ASC`
);

const upsertChatStmt = db.prepare(
    `INSERT INTO trainer_chats (id, activity_id, user_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, activity_id) DO UPDATE SET
       updated_at = datetime('now')`
);

const deleteMessagesStmt = db.prepare(
    `DELETE FROM trainer_messages WHERE chat_id = ?`
);

const insertMessageStmt = db.prepare(
    `INSERT INTO trainer_messages (id, chat_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
);

const trainer = new Hono();

/** POST /chat — stream a response from Kimi 2.5 via OpenRouter */
trainer.post("/chat", async (c) => {
    const apiKey = env.OPENROUTER_KEY;
    if (!apiKey) {
        return c.json({ error: "OPENROUTER_KEY is not configured" }, 500);
    }

    const body = await c.req.json();
    const modelMessages = convertMessagesToModelMessages(body.messages ?? []);

    const adapter = createOpenRouterText("moonshotai/kimi-k2.5", apiKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = chat({
        adapter,
        messages: modelMessages as any,
        systemPrompts: [SYSTEM_PROMPT],
    });

    return toServerSentEventsResponse(stream);
});

/** GET /history/:activityId — load persisted chat history for an activity */
trainer.get("/history/:activityId", (c) => {
    const userId = getUserId(c);
    const { activityId } = c.req.param();

    const chat = getChatStmt.get(userId, activityId) as
        | { id: string; updatedAt: string }
        | undefined;

    if (!chat) {
        return c.json({ activityId, messages: [], updatedAt: new Date().toISOString() });
    }

    const messages = getMessagesStmt.all(chat.id) as TrainerMessage[];
    return c.json({ activityId, messages, updatedAt: chat.updatedAt });
});

/** PUT /history/:activityId — replace chat history for an activity */
trainer.put("/history/:activityId", async (c) => {
    const userId = getUserId(c);
    const { activityId } = c.req.param();
    const body: SaveTrainerHistoryBody = await c.req.json();

    const chatId = `${userId}:${activityId}`;
    const messages: TrainerMessage[] = body.messages ?? [];

    db.transaction(() => {
        upsertChatStmt.run(chatId, activityId, userId);
        deleteMessagesStmt.run(chatId);
        for (const m of messages) {
            insertMessageStmt.run(m.id, chatId, m.role, m.content, m.createdAt);
        }
    })();

    return c.json({ ok: true });
});

/** POST /compact/:activityId — compact old messages using Kimi K2.5 and save result */
trainer.post("/compact/:activityId", async (c) => {
    const apiKey = env.OPENROUTER_KEY;
    if (!apiKey) {
        return c.json({ error: "OPENROUTER_KEY is not configured" }, 500);
    }

    const userId = getUserId(c);
    const { activityId } = c.req.param();

    // Load current history
    const chatRow = getChatStmt.get(userId, activityId) as { id: string; updatedAt: string } | undefined;
    if (!chatRow) {
        return c.json({ messages: [], compacted: false });
    }

    const allMessages = getMessagesStmt.all(chatRow.id) as TrainerMessage[];

    // Collect last 10 user + 10 assistant messages (preserved verbatim)
    const keepEndIds = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (msg.role === "user" && userCount < 10) {
            keepEndIds.add(msg.id);
            userCount++;
        } else if (msg.role === "assistant" && assistantCount < 10) {
            keepEndIds.add(msg.id);
            assistantCount++;
        }
        if (userCount >= 10 && assistantCount >= 10) break;
    }

    // Cutoff: index of the earliest message in the "keep end" set
    const cutoffIndex = allMessages.findIndex((m) => keepEndIds.has(m.id));

    // Everything before the cutoff gets compacted (summary replaces all of it)
    const toCompact = allMessages.slice(0, cutoffIndex);

    if (toCompact.length === 0) {
        return c.json({ messages: allMessages, compacted: false });
    }

    // Build the compaction prompt
    const messagesText = toCompact
        .map((m) => `**${m.role === "user" ? "Athlete" : "Coach"}:** ${m.content}`)
        .join("\n\n---\n\n");

    const compactionPrompt =
        "You are summarizing an older portion of a sports coaching conversation. " +
        "Compress the following exchange into a concise but complete context summary using markdown. " +
        "Preserve ALL important details:\n\n" +
        "- Training data (power, HR, cadence, intervals, zones)\n" +
        "- Coaching advice and recommendations given\n" +
        "- Athlete goals, profile, and background\n" +
        "- Issues discussed and solutions provided\n" +
        "- Training plans, workouts, or progressions mentioned\n" +
        "- Key insights and patterns identified\n\n" +
        "Use markdown headers (`##`, `###`), bullet points, and **bold text** to highlight the most important information. " +
        "Be thorough — this summary replaces the original messages.\n\n" +
        "Messages to summarize:\n\n---\n\n" +
        messagesText;

    // Call OpenRouter directly (non-streaming), with a 4-minute hard timeout
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "moonshotai/kimi-k2.5",
            messages: [{ role: "user", content: compactionPrompt }],
        }),
        signal: AbortSignal.timeout(240_000),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return c.json({ error: "Compaction request failed", details: err }, 500);
    }

    const data = await response.json();
    const summary: string = data.choices?.[0]?.message?.content ?? "*(Summary unavailable)*";

    // Timestamp the summary 1 ms before the first kept message so it sorts first
    const firstKeptAt = new Date(allMessages[cutoffIndex].createdAt).getTime();
    const summaryMessage: TrainerMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
            "## 📋 Context Summary\n\n" +
            "*The following is a compressed summary of the earlier conversation to preserve context:*\n\n" +
            summary,
        createdAt: new Date(firstKeptAt - 1).toISOString(),
    };

    // Summary replaces all compacted messages; recent tail is kept verbatim
    const newMessages: TrainerMessage[] = [
        summaryMessage,
        ...allMessages.slice(cutoffIndex),
    ];

    // Persist to DB
    const chatId = `${userId}:${activityId}`;
    db.transaction(() => {
        upsertChatStmt.run(chatId, activityId, userId);
        deleteMessagesStmt.run(chatId);
        for (const m of newMessages) {
            insertMessageStmt.run(m.id, chatId, m.role, m.content, m.createdAt);
        }
    })();

    return c.json({ messages: newMessages, compacted: true, removed: toCompact.length });
});

/** POST /import — parse a ChatGPT-style markdown export and store as chat history */
trainer.post("/import", async (c) => {
    const userId = getUserId(c);

    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || typeof file === "string") {
        return c.json({ error: "No file uploaded" }, 400);
    }

    const raw = await (file as File).text();
    if (!raw.trim()) {
        return c.json({ error: "File is empty" }, 400);
    }

    const messages = parseCoachingMarkdown(raw);
    if (messages.length === 0) {
        return c.json({ error: "No messages found — is this a valid ChatGPT markdown export?" }, 400);
    }

    const chatId = `${userId}:general`;

    db.transaction(() => {
        upsertChatStmt.run(chatId, "general", userId);
        deleteMessagesStmt.run(chatId);
        for (const m of messages) {
            insertMessageStmt.run(m.id, chatId, m.role, m.content, m.createdAt);
        }
    })();

    return c.json({ imported: messages.length, chatId });
});

export { trainer };
