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

export { trainer };
