import type { ModelMessage } from "@tanstack/ai";
import type { TrainerMessage, UIToolCall } from "@fit-analyzer/shared";
import { GENERAL_ACTIVITY_ID, GENERAL_THREAD_NAME } from "@fit-analyzer/shared";
import { getProviderConfig, resolveThreadModel } from "./providerConfig.js";
import { getToolDefinitions } from "./tools/registry.js";
import { createTrainerToolLoop } from "./trainerToolLoop.js";
import {
	accumulateChunk,
	createLoopAccumulator,
} from "./trainerLoopAccumulator.js";
import { messageRepo } from "./messageRepo.js";
import { threadRepo } from "./threadRepo.js";
import { buildCalendarGuidance } from "./calendarGuidance.js";
import {
	BASE_SYSTEM_PROMPT,
	buildCurrentTimeText,
} from "./trainerBasePrompt.js";
import { planWeekFor } from "@fit-analyzer/shared";

/**
 * The unattended Plan refresh run (ADR-0003): drive the trainer tool loop
 * directly — no SSE, no client — to regenerate the forward plan and Plan-sync
 * it to the calendar, then append the coach's narrative to the athlete's
 * newest general trainer thread.
 *
 * The model is resolved exactly as interactive chat resolves it (the thread's
 * own override wins, else the user's global coach-model setting).
 */

const REFRESH_INSTRUCTION_HEADER = "Weekly plan refresh (scheduled).";
const ADD_WORKOUTS_TOOL = "add_workouts_to_calendar";

/** How many assistant messages of the general thread to replay as context. */
const CONTEXT_MESSAGE_LIMIT = 12;

export interface PlanRefreshRunResult {
	ok: boolean;
	weekKey: string;
	/** Assistant message id persisted on success. */
	messageId: string | null;
	/** Workouts created or updated by the sync (0 means the plan was unchanged). */
	scheduledCount: number;
	error: string | null;
}

function findOrCreateGeneralThread(userId: string): string {
	const threads = threadRepo.listByActivity(userId, GENERAL_ACTIVITY_ID);
	if (threads.length > 0) {
		const newest = threads.reduce((latest, t) =>
			new Date(t.updatedAt) > new Date(latest.updatedAt) ? t : latest,
		);
		return newest.id;
	}
	return threadRepo.create(
		userId,
		GENERAL_ACTIVITY_ID,
		GENERAL_THREAD_NAME,
		null,
	).id;
}

/** Replay prior thread messages as text context for the coach. */
function historyToModelMessages(messages: TrainerMessage[]): ModelMessage[] {
	const recent = messages.slice(-CONTEXT_MESSAGE_LIMIT);
	const modelMessages: ModelMessage[] = [];
	for (const m of recent) {
		const content = m.content.trim();
		if (!content) continue;
		modelMessages.push({ role: m.role, content });
	}
	return modelMessages;
}

function syncDisplay(tc: UIToolCall): {
	created?: unknown[];
	updated?: unknown[];
	errors?: string[];
} | null {
	if (tc.name !== ADD_WORKOUTS_TOOL || !tc.result) return null;
	return tc.result.display as {
		created?: unknown[];
		updated?: unknown[];
		errors?: string[];
	} | null;
}

/** A Plan refresh outcome derived purely from the tool calls and reply text. */
export type RefreshOutcome =
	| { ok: true; scheduledCount: number }
	| { ok: false; error: string };

/**
 * Decide whether a Plan refresh succeeded, from the accumulated tool calls and
 * assistant text — no I/O, so the caller can persist only on success and tests
 * can pin the semantics.
 *
 * A refresh succeeds only when it actually wrote to the calendar: the coach
 * must have called add_workouts_to_calendar, the call must not have errored, and
 * the sync's per-event `errors` (which the handler swallows into the display)
 * must be empty. An unchanged plan is still a success — it is an idempotent
 * no-op write, and `scheduledCount === 0` lets the caller stay silent.
 */
export function evaluateRefreshOutcome(
	toolCalls: UIToolCall[],
	text: string,
): RefreshOutcome {
	const syncError = toolCalls.find(
		(t) => t.name === ADD_WORKOUTS_TOOL && t.status === "error",
	);
	if (syncError) {
		return {
			ok: false,
			error: syncError.result?.error ?? "Calendar sync failed",
		};
	}

	if (!toolCalls.some((t) => t.name === ADD_WORKOUTS_TOOL)) {
		return { ok: false, error: "Plan refresh did not write to the calendar" };
	}

	let scheduledCount = 0;
	const errors: string[] = [];
	for (const tc of toolCalls) {
		const display = syncDisplay(tc);
		if (!display) continue;
		scheduledCount +=
			(display.created?.length ?? 0) + (display.updated?.length ?? 0);
		errors.push(...(display.errors ?? []));
	}
	if (errors.length > 0) {
		return { ok: false, error: `Calendar sync failed: ${errors.join(" | ")}` };
	}

	if (!text.trim()) {
		return { ok: false, error: "Plan refresh produced no message" };
	}

	return { ok: true, scheduledCount };
}

/**
 * Run one Plan refresh for `weekKey`. Never throws: failures are surfaced in
 * the result so the caller can update the Refresh watermark and notify.
 */
export async function runPlanRefresh(
	userId: string,
	weekKey: string,
	weekStart: string,
): Promise<PlanRefreshRunResult> {
	const fail = (error: string): PlanRefreshRunResult => ({
		ok: false,
		weekKey,
		messageId: null,
		scheduledCount: 0,
		error,
	});

	try {
		const threadId = findOrCreateGeneralThread(userId);
		const thread = threadRepo.getById(userId, threadId);
		const model = await resolveThreadModel(thread, userId);
		const providerConfig = await getProviderConfig(model);

		if (!providerConfig.apiKey) {
			return fail(`${providerConfig.apiKeyEnvName} is not configured`);
		}

		const calendarGuidance = await buildCalendarGuidance(userId);
		if (!calendarGuidance) return fail("Google Calendar not connected");

		const systemPrompt = `${BASE_SYSTEM_PROMPT}${calendarGuidance}\n\n${buildCurrentTimeText(new Date())}`;

		const week = planWeekFor(weekStart);

		const existing = messageRepo.getAll(threadId);
		const messages: ModelMessage[] = [
			...historyToModelMessages(existing),
			{
				role: "user",
				content: [
					REFRESH_INSTRUCTION_HEADER,
					`It is time for the weekly plan refresh. Make the upcoming Plan week (${week.start} to ${week.end}) fully populated on the Training calendar.`,
					"Review the athlete's recent activities, health, and the conversation above; revise workouts only where warranted, and keep the rest of the forward plan as it is.",
					"Then ALWAYS call add_workouts_to_calendar with the COMPLETE forward plan — an unchanged plan is a valid, idempotent outcome.",
					"Finish with a short summary message for the athlete: what the week ahead holds and anything they should know.",
				].join(" "),
			},
		];

		const accumulated = createLoopAccumulator();

		const stream = createTrainerToolLoop({
			baseUrl: providerConfig.baseUrl,
			apiKey: providerConfig.apiKey,
			model,
			systemPrompt,
			messages,
			provider: providerConfig.provider,
			includeReasoning: false,
			threadId,
			userId,
			tools: getToolDefinitions(),
		});

		for await (const chunk of stream) {
			accumulateChunk(accumulated, chunk);
			if (chunk.type === "RUN_ERROR") {
				return fail(chunk.error?.message ?? "Plan refresh model error");
			}
		}

		const { text: fullText, toolCalls } = accumulated;

		const outcome = evaluateRefreshOutcome(toolCalls, fullText);
		if (!outcome.ok) return fail(outcome.error);

		const messageId = crypto.randomUUID();
		messageRepo.insertMany(threadId, [
			{
				id: messageId,
				role: "assistant",
				content: fullText.trim(),
				createdAt: new Date().toISOString(),
				...(toolCalls.length > 0 ? { toolCalls } : {}),
			},
		]);
		// insertMany deliberately skips the parent-thread touch (it is built for
		// forks/imports); bump it here so the refreshed thread surfaces as newest.
		threadRepo.touch(threadId);

		return {
			ok: true,
			weekKey,
			messageId,
			scheduledCount: outcome.scheduledCount,
			error: null,
		};
	} catch (err) {
		return fail(err instanceof Error ? err.message : String(err));
	}
}
