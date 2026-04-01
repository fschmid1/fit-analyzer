import {
    chat,
    convertMessagesToModelMessages,
    toServerSentEventsResponse,
} from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { Hono } from "hono";
import { env } from "../env";

const SYSTEM_PROMPT =
    "You are an expert endurance sports coach specialising in cycling." +
    "You receive structured training data from Garmin FIT files and provide concise, actionable coaching feedback. " +
    "When the user shares their activity summary and interval data, analyse power, heart rate and cadence trends " +
    "and give practical training advice.";

const trainer = new Hono();

trainer.post("/chat", async (c) => {
    const apiKey = env.OPENROUTER_KEY;
    if (!apiKey) {
        return c.json({ error: "OPENROUTER_API_KEY is not configured" }, 500);
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

export { trainer };
