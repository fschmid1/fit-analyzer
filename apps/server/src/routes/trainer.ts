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

const COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE = 20;

function getUserId(c: { req: { header: (name: string) => string | undefined } }): string {
    const userId = c.req.header("x-authentik-username");
    if (!userId) throw new Error("Missing x-authentik-username header");
    return userId;
}

// ─── Prepared statements ─────────────────────────────────────────────────────

const getThreadsStmt = db.prepare(
    `SELECT c.id, c.name, c.activity_id as activityId,
            c.created_at as createdAt, c.updated_at as updatedAt,
            COUNT(m.id) as messageCount
     FROM trainer_chats c
     LEFT JOIN trainer_messages m ON m.chat_id = c.id
     WHERE c.user_id = ? AND c.activity_id = ?
     GROUP BY c.id
     ORDER BY c.created_at ASC`
);

const getThreadByIdStmt = db.prepare(
    `SELECT id, name, activity_id as activityId, user_id as userId,
            created_at as createdAt, updated_at as updatedAt
     FROM trainer_chats
     WHERE id = ? AND user_id = ?`
);

const getMessagesStmt = db.prepare(
    `SELECT id, role, content, created_at as createdAt
     FROM trainer_messages
     WHERE chat_id = ?
     ORDER BY created_at ASC`
);

const createThreadStmt = db.prepare(
    `INSERT INTO trainer_chats (id, activity_id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
);

const renameThreadStmt = db.prepare(
    `UPDATE trainer_chats SET name = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
);

const deleteThreadStmt = db.prepare(
    `DELETE FROM trainer_chats WHERE id = ? AND user_id = ?`
);

const deleteMessagesStmt = db.prepare(
    `DELETE FROM trainer_messages WHERE chat_id = ?`
);

const touchThreadStmt = db.prepare(
    `UPDATE trainer_chats SET updated_at = datetime('now') WHERE id = ?`
);

const insertMessageStmt = db.prepare(
    `INSERT INTO trainer_messages (id, chat_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
);

const trainer = new Hono();

// ─── Chat streaming ───────────────────────────────────────────────────────────

trainer.post("/chat", async (c) => {
    const apiKey = env.OPENROUTER_KEY;
    if (!apiKey) return c.json({ error: "OPENROUTER_KEY is not configured" }, 500);

    const body = await c.req.json();
    const modelMessages = convertMessagesToModelMessages(body.messages ?? []);
    const adapter = createOpenRouterText("moonshotai/kimi-k2.5", apiKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = chat({ adapter, messages: modelMessages as any, systemPrompts: [SYSTEM_PROMPT] });
    return toServerSentEventsResponse(stream);
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
    const threadId = crypto.randomUUID();
    createThreadStmt.run(threadId, activityId, userId, name);
    const thread = getThreadByIdStmt.get(threadId, userId);
    return c.json({ thread });
});

trainer.patch("/threads/:threadId", async (c) => {
    const userId = getUserId(c);
    const { threadId } = c.req.param();
    const body = await c.req.json();
    const name: string = (body.name as string | undefined)?.trim() ?? "";
    if (!name) return c.json({ error: "Name is required" }, 400);
    renameThreadStmt.run(name, threadId, userId);
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
        return c.json({ threadId, messages: [], updatedAt: new Date().toISOString() });
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
    const apiKey = env.OPENROUTER_KEY;
    if (!apiKey) return c.json({ error: "OPENROUTER_KEY is not configured" }, 500);

    const userId = getUserId(c);
    const { threadId } = c.req.param();

    const sourceThread = getThreadByIdStmt.get(threadId, userId) as
        | { id: string; name: string; activityId: string }
        | undefined;
    if (!sourceThread) return c.json({ error: "Thread not found" }, 404);

    const allMessages = getMessagesStmt.all(threadId) as TrainerMessage[];

    const keepEndIds = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (msg.role === "user" && userCount < COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE) {
            keepEndIds.add(msg.id);
            userCount++;
        } else if (msg.role === "assistant" && assistantCount < COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE) {
            keepEndIds.add(msg.id);
            assistantCount++;
        }
        if (
            userCount >= COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE &&
            assistantCount >= COMPACTION_KEEP_RECENT_MESSAGES_PER_ROLE
        ) break;
    }

    const cutoffIndex = allMessages.findIndex((m) => keepEndIds.has(m.id));
    const toCompact = allMessages.slice(0, cutoffIndex);

    if (toCompact.length === 0) {
        return c.json({ thread: { ...sourceThread, messageCount: allMessages.length }, messages: allMessages, compacted: false });
    }

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

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "moonshotai/kimi-k2.5", messages: [{ role: "user", content: compactionPrompt }] }),
        signal: AbortSignal.timeout(240_000),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return c.json({ error: "Compaction request failed", details: err }, 500);
    }

    const data = await response.json();
    const summary: string = data.choices?.[0]?.message?.content ?? "*(Summary unavailable)*";

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

    // Give every message a fresh ID — the originals still exist in the source thread
    const newMessages: TrainerMessage[] = [summaryMessage, ...allMessages.slice(cutoffIndex)]
        .map((m) => ({ ...m, id: crypto.randomUUID() }));

    const forkId = crypto.randomUUID();
    const forkName = `${sourceThread.name} · Compacted`;

    db.transaction(() => {
        createThreadStmt.run(forkId, sourceThread.activityId, userId, forkName);
        for (const m of newMessages) {
            insertMessageStmt.run(m.id, forkId, m.role, m.content, m.createdAt);
        }
    })();

    const forkThread = getThreadByIdStmt.get(forkId, userId) as {
        id: string; name: string; activityId: string; createdAt: string; updatedAt: string;
    };

    return c.json({
        thread: { ...forkThread, messageCount: newMessages.length },
        messages: newMessages,
        compacted: true,
        removed: toCompact.length,
    });
});

// ─── Import ───────────────────────────────────────────────────────────────────

trainer.post("/import", async (c) => {
    const userId = getUserId(c);
    const body = await c.req.parseBody();
    const file = body["file"];
    const threadId = body["threadId"] as string | undefined;

    if (!file || typeof file === "string") return c.json({ error: "No file uploaded" }, 400);

    const raw = await (file as File).text();
    if (!raw.trim()) return c.json({ error: "File is empty" }, 400);

    const messages = parseCoachingMarkdown(raw);
    if (messages.length === 0) {
        return c.json({ error: "No messages found — is this a valid ChatGPT markdown export?" }, 400);
    }

    let targetThreadId = threadId;

    if (targetThreadId) {
        const thread = getThreadByIdStmt.get(targetThreadId, userId);
        if (!thread) return c.json({ error: "Thread not found" }, 404);
    } else {
        targetThreadId = crypto.randomUUID();
        createThreadStmt.run(targetThreadId, "general", userId, "Imported Chat");
    }

    db.transaction(() => {
        deleteMessagesStmt.run(targetThreadId!);
        touchThreadStmt.run(targetThreadId!);
        for (const m of messages) {
            insertMessageStmt.run(m.id, targetThreadId, m.role, m.content, m.createdAt);
        }
    })();

    return c.json({ imported: messages.length, threadId: targetThreadId });
});

export { trainer };
