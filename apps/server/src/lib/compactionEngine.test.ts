import {
	COMPACTION_MAX_PROMPT_TOKENS__FOR_TESTS as COMPACTION_MAX_PROMPT_TOKENS,
	MAX_KEPT_MESSAGE_TOKENS__FOR_TESTS as MAX_KEPT_MESSAGE_TOKENS,
	buildCompactionPrompt,
	compactMessages,
	computeRecentKeepWindow,
	estimateTokenLength,
	formatMessageForCompaction,
	messageTokenLength,
	summarizeBatch,
	truncateSummary,
} from "./compactionEngine.js";
import type { TrainerMessage, UIToolCall } from "@fit-analyzer/shared";
import { APPROX_CHARS_PER_TOKEN } from "@fit-analyzer/shared";
import { describe, expect, it, mock } from "bun:test";

// ─── helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
	idCounter += 1;
	return `msg-${idCounter}`;
}

function makeMessage(
	role: "user" | "assistant",
	content: string,
	createdAt = "2025-01-01T00:00:00.000Z",
): TrainerMessage {
	return { id: nextId(), role, content, createdAt };
}

function makeToolCall(name: string, args: Record<string, unknown>): UIToolCall {
	return {
		id: nextId(),
		name,
		arguments: args,
		status: "done",
		result: {
			id: nextId(),
			name,
			content: "tool-result-content",
			display: null,
		},
	};
}

/** Build an alternating user/assistant conversation with `count` messages. */
function alternatingConversation(count: number): TrainerMessage[] {
	const msgs: TrainerMessage[] = [];
	for (let i = 0; i < count; i++) {
		const createdAt = new Date(2025, 0, 1, 0, 0, i).toISOString();
		msgs.push(
			makeMessage(
				i % 2 === 0 ? "user" : "assistant",
				`message ${i}`,
				createdAt,
			),
		);
	}
	return msgs;
}

/** A fake `fetchSummary` that records every prompt and returns canned text. */
function recordingFetchSummary(returnValue = "SUMMARY"): {
	fn: (prompt: string, abortSignal?: AbortSignal) => Promise<string>;
	calls: string[];
	abortSignals: (AbortSignal | undefined)[];
} {
	const calls: string[] = [];
	const abortSignals: (AbortSignal | undefined)[] = [];
	const fn = mock((prompt: string, abortSignal?: AbortSignal) => {
		calls.push(prompt);
		abortSignals.push(abortSignal);
		return Promise.resolve(returnValue);
	});
	return { fn, calls, abortSignals };
}

// ─── messageTokenLength ─────────────────────────────────────────────────────────

describe("messageTokenLength", () => {
	it("estimates tokens from content length alone when there are no tool calls", () => {
		const m = makeMessage("user", "a".repeat(APPROX_CHARS_PER_TOKEN * 10));
		expect(messageTokenLength(m)).toBe(10);
	});

	it("rounds up partial tokens", () => {
		const m = makeMessage("user", "abc");
		expect(messageTokenLength(m)).toBe(1);
	});

	it("includes tool-call name, arguments, and result sizes", () => {
		const toolCall = makeToolCall("zone_analysis", { activityId: "abc" });
		const msg: TrainerMessage = {
			...makeMessage("assistant", "x"),
			toolCalls: [toolCall],
		};
		const expectedName = Math.ceil(
			toolCall.name.length / APPROX_CHARS_PER_TOKEN,
		);
		const expectedArgs = Math.ceil(
			JSON.stringify(toolCall.arguments).length / APPROX_CHARS_PER_TOKEN,
		);
		const expectedResult = Math.ceil(
			JSON.stringify(toolCall.result).length / APPROX_CHARS_PER_TOKEN,
		);
		const contentTokens = Math.ceil(1 / APPROX_CHARS_PER_TOKEN);
		expect(messageTokenLength(msg)).toBe(
			contentTokens + expectedName + expectedArgs + expectedResult,
		);
	});

	it("handles empty content", () => {
		expect(messageTokenLength(makeMessage("user", ""))).toBe(0);
	});

	it("handles a message with toolCalls but no result", () => {
		const msg: TrainerMessage = {
			...makeMessage("assistant", "x"),
			toolCalls: [
				{ id: "t1", name: "zone_analysis", arguments: {}, status: "executing" },
			],
		};
		// Only content + name + args tokens; no result.
		const expected =
			Math.ceil(1 / APPROX_CHARS_PER_TOKEN) +
			Math.ceil("zone_analysis".length / APPROX_CHARS_PER_TOKEN) +
			Math.ceil("{}".length / APPROX_CHARS_PER_TOKEN);
		expect(messageTokenLength(msg)).toBe(expected);
	});
});

// ─── estimateTokenLength ────────────────────────────────────────────────────────

describe("estimateTokenLength", () => {
	it("estimates from string length", () => {
		expect(estimateTokenLength("a".repeat(APPROX_CHARS_PER_TOKEN * 5))).toBe(5);
	});

	it("rounds up", () => {
		expect(estimateTokenLength("a")).toBe(1);
	});

	it("zero for empty string", () => {
		expect(estimateTokenLength("")).toBe(0);
	});
});

// ─── computeRecentKeepWindow ────────────────────────────────────────────────────

describe("computeRecentKeepWindow", () => {
	it("keeps the 4 most recent messages per role", () => {
		const msgs = alternatingConversation(20); // 10 user + 10 assistant
		const { keepEndIds, cutoffIndex } = computeRecentKeepWindow(
			msgs,
			1_000_000,
			0,
		);
		// 4 most-recent user + 4 most-recent assistant = 8 kept
		expect(keepEndIds.size).toBe(8);
		// The cutoff should be the index of the earliest kept message
		const earliestKeptIndex = msgs.findIndex((m) => keepEndIds.has(m.id));
		expect(cutoffIndex).toBe(earliestKeptIndex);
		// Everything from cutoffIndex onward should be in keepEndIds
		for (let i = cutoffIndex; i < msgs.length; i++) {
			expect(keepEndIds.has(msgs[i].id)).toBe(true);
		}
	});

	it("returns cutoffIndex === length when there are fewer than 4 per role (all kept)", () => {
		const msgs = alternatingConversation(4);
		const { keepEndIds, cutoffIndex } = computeRecentKeepWindow(
			msgs,
			1_000_000,
			0,
		);
		expect(keepEndIds.size).toBe(4);
		expect(cutoffIndex).toBe(0);
	});

	it("shrinks the kept tail when it exceeds the tail budget", () => {
		// 6 messages: all qualify for keep-by-recency (3 per role), but we
		// give a tiny budget so the oldest kept messages must be dropped.
		const msgs = alternatingConversation(6);
		// Reserve is subtracted from target; give 0 reserve and a budget that
		// only fits the single most-recent message.
		const mostRecentTokens = messageTokenLength(msgs[msgs.length - 1]);
		const { keepEndIds, cutoffIndex } = computeRecentKeepWindow(
			msgs,
			mostRecentTokens,
			0,
		);
		// The oldest kept messages should have been removed from keepEndIds.
		expect(keepEndIds.size).toBeLessThan(6);
		// cutoffIndex must point to the first still-kept message (or length).
		const earliestKeptIndex = msgs.findIndex((m) => keepEndIds.has(m.id));
		expect(cutoffIndex).toBe(
			earliestKeptIndex === -1 ? msgs.length : earliestKeptIndex,
		);
	});

	it("handles an empty message array", () => {
		const { keepEndIds, cutoffIndex } = computeRecentKeepWindow([], 1000, 0);
		expect(keepEndIds.size).toBe(0);
		expect(cutoffIndex).toBe(0);
	});

	it("keeps everything when all messages are recent enough", () => {
		const msgs = alternatingConversation(8);
		const { keepEndIds, cutoffIndex } = computeRecentKeepWindow(
			msgs,
			1_000_000,
			0,
		);
		expect(keepEndIds.size).toBe(8);
		expect(cutoffIndex).toBe(0);
	});
});

// ─── formatMessageForCompaction ─────────────────────────────────────────────────

describe("formatMessageForCompaction", () => {
	it("labels user messages as Athlete", () => {
		const text = formatMessageForCompaction(makeMessage("user", "hello"));
		expect(text).toContain("**Athlete:** hello");
	});

	it("labels assistant messages as Coach", () => {
		const text = formatMessageForCompaction(makeMessage("assistant", "hi"));
		expect(text).toContain("**Coach:** hi");
	});

	it("appends a tool list when toolCalls are present", () => {
		const msg: TrainerMessage = {
			...makeMessage("assistant", "checking"),
			toolCalls: [makeToolCall("zone_analysis", { activityId: "act-1" })],
		};
		const text = formatMessageForCompaction(msg);
		expect(text).toContain("_tools used_");
		expect(text).toContain("**zone_analysis**");
		expect(text).toContain('"activityId":"act-1"');
	});

	it("truncates large tool results to 1000 chars", () => {
		const bigResult = "x".repeat(2_000);
		const msg: TrainerMessage = {
			...makeMessage("assistant", "checking"),
			toolCalls: [
				{
					id: "t1",
					name: "health_data",
					arguments: {},
					status: "done",
					result: {
						id: "r1",
						name: "health_data",
						content: bigResult,
						display: null,
					},
				},
			],
		};
		const text = formatMessageForCompaction(msg);
		// The full 2000-char run must NOT appear — the result JSON is
		// truncated to 1000 chars by formatMessageForCompaction.
		expect(text).not.toContain("x".repeat(2_000));
		// The truncated result JSON slice is at most 1000 chars long.
		const resultJson = text.split("→ ")[1];
		expect(resultJson.length).toBeLessThanOrEqual(1_000);
	});

	it("omits the tool list when toolCalls is empty", () => {
		const text = formatMessageForCompaction({
			...makeMessage("assistant", "hi"),
			toolCalls: [],
		});
		expect(text).not.toContain("_tools used_");
	});
});

// ─── buildCompactionPrompt ──────────────────────────────────────────────────────

describe("buildCompactionPrompt", () => {
	it("wraps the messages text with instructions", () => {
		const prompt = buildCompactionPrompt("THE MESSAGES");
		expect(prompt).toContain("THE MESSAGES");
		expect(prompt).toContain("summarizing");
		expect(prompt).toContain("---");
	});

	it("preserves the messages text verbatim", () => {
		const weird = "line1\nline2\twith\ttabs\n\n## header";
		expect(buildCompactionPrompt(weird)).toContain(weird);
	});
});

// ─── truncateSummary ────────────────────────────────────────────────────────────

describe("truncateSummary", () => {
	it("returns short text unchanged", () => {
		expect(truncateSummary("short")).toBe("short");
	});

	it("truncates text exceeding the max summary token budget", () => {
		const maxChars = 4_000 * APPROX_CHARS_PER_TOKEN;
		const long = "a".repeat(maxChars + 500);
		const truncated = truncateSummary(long);
		expect(truncated.length).toBe(maxChars + 1); // +1 for the ellipsis
		expect(truncated.endsWith("…")).toBe(true);
	});

	it("does not truncate text exactly at the boundary", () => {
		const maxChars = 4_000 * APPROX_CHARS_PER_TOKEN;
		const exact = "a".repeat(maxChars);
		expect(truncateSummary(exact)).toBe(exact);
	});
});

// ─── summarizeBatch ─────────────────────────────────────────────────────────────

describe("summarizeBatch", () => {
	it("makes a single fetchSummary call when the prompt fits under the limit", async () => {
		const { fn, calls } = recordingFetchSummary("ok");
		const msgs = alternatingConversation(4);
		await summarizeBatch(msgs, fn);
		expect(calls.length).toBe(1);
		expect(calls[0]).toContain("message 0");
		expect(calls[0]).toContain("message 3");
	});

	it("chunks and merges when the batch exceeds the prompt-token limit", async () => {
		const { fn, calls } = recordingFetchSummary("chunk-summary");
		// Build messages whose combined formatted text far exceeds
		// COMPACTION_MAX_PROMPT_TOKENS so we force chunking.
		const hugeContent = "x".repeat(
			(COMPACTION_MAX_PROMPT_TOKENS + 5_000) * APPROX_CHARS_PER_TOKEN,
		);
		const msgs = [
			makeMessage("user", hugeContent),
			makeMessage("assistant", hugeContent),
		];
		await summarizeBatch(msgs, fn);
		// We expect: one call per chunk + one final merge call.
		expect(calls.length).toBeGreaterThanOrEqual(3);
		// The last call should be the merge prompt.
		expect(calls[calls.length - 1]).toContain(
			"merging several partial summaries",
		);
	});

	it("returns the fetchSummary output for a single-call batch", async () => {
		const { fn } = recordingFetchSummary("THE SUMMARY");
		const result = await summarizeBatch(alternatingConversation(3), fn);
		expect(result).toBe("THE SUMMARY");
	});

	it("propagates fetchSummary errors", async () => {
		const fn = () => Promise.reject(new Error("boom"));
		await expect(
			summarizeBatch(alternatingConversation(4), fn),
		).rejects.toThrow("boom");
	});
});

// ─── compactMessages ────────────────────────────────────────────────────────────

describe("compactMessages", () => {
	it("returns compacted:false when there is nothing to summarize", async () => {
		const { fn, calls } = recordingFetchSummary();
		// 8 messages → all fit in the 4-per-role keep window → nothing to compact.
		const msgs = alternatingConversation(8);
		const result = await compactMessages(msgs, {
			fetchSummary: fn,
		});
		expect(result.compacted).toBe(false);
		expect(result.removed).toBe(0);
		expect(result.messages).toEqual(msgs);
		expect(calls.length).toBe(0);
	});

	it("returns compacted:false for an empty thread", async () => {
		const { fn, calls } = recordingFetchSummary();
		const result = await compactMessages([], {
			fetchSummary: fn,
		});
		expect(result.compacted).toBe(false);
		expect(result.messages).toEqual([]);
		expect(calls.length).toBe(0);
	});

	it("summarizes old messages and keeps the recent tail with fresh ids", async () => {
		const { fn, calls } = recordingFetchSummary("COMPRESSED");
		// 20 messages: the 4 most-recent per role (8 total) are kept, the
		// first 12 are summarized.
		const msgs = alternatingConversation(20);
		const originalIds = new Set(msgs.map((m) => m.id));
		const result = await compactMessages(msgs, {
			fetchSummary: fn,
		});

		expect(result.compacted).toBe(true);
		expect(result.removed).toBe(12);
		expect(calls.length).toBe(1); // single summary call

		// The first message should be the context summary.
		expect(result.messages[0].role).toBe("assistant");
		expect(result.messages[0].content).toContain("## Context Summary");
		expect(result.messages[0].content).toContain("COMPRESSED");

		// Kept messages get fresh ids (no id collides with an original).
		for (const m of result.messages) {
			expect(originalIds.has(m.id)).toBe(false);
		}

		// The summary's createdAt is before the first kept message's createdAt.
		const firstKept = result.messages.find(
			(m) => !m.content.includes("## Context Summary"),
		);
		expect(firstKept).toBeDefined();
		expect(firstKept).not.toBeNull();
		expect(new Date(result.messages[0].createdAt).getTime()).toBeLessThan(
			new Date(firstKept?.createdAt ?? "").getTime(),
		);
	});

	it("summarizes oversized kept messages in a second pass", async () => {
		// Build a thread where the recent tail fits in the keep window by
		// count, but one kept message is enormous and must be summarized.
		const oversizedContent = "y".repeat(
			(MAX_KEPT_MESSAGE_TOKENS + 5_000) * APPROX_CHARS_PER_TOKEN,
		);
		// 4 user + 4 assistant = 8 recent messages, all kept by recency.
		// We make the most-recent assistant message oversized.
		const msgs: TrainerMessage[] = [];
		for (let i = 0; i < 7; i++) {
			msgs.push(
				makeMessage(
					i % 2 === 0 ? "user" : "assistant",
					`recent ${i}`,
					new Date(2025, 0, 1, 0, 0, i).toISOString(),
				),
			);
		}
		msgs.push({
			id: nextId(),
			role: "assistant",
			content: oversizedContent,
			createdAt: new Date(2025, 0, 1, 0, 0, 7).toISOString(),
		});

		const { fn, calls } = recordingFetchSummary("SUMMARY");
		const result = await compactMessages(msgs, {
			fetchSummary: fn,
		});

		// No head to compact, but the oversized kept message must still be
		// summarized so the fork fits the context window. This is the case
		// the original inlined code missed (it short-circuited before the
		// oversized pass); the extracted module fixes it.
		expect(result.compacted).toBe(true);
		expect(result.removed).toBe(1); // the oversized message
		// The oversized message triggers chunking (it exceeds the prompt
		// limit), so we get 1 chunk call + 1 merge call = 2 calls.
		expect(calls.length).toBe(2);

		// The output starts with the oversized-message summary.
		expect(result.messages[0].content).toContain("## Earlier Message Summary");
		// The oversized content must NOT appear verbatim.
		for (const m of result.messages) {
			expect(m.content).not.toContain(oversizedContent);
		}
	});

	it("summarizes oversized kept messages when there is also a head to compact", async () => {
		// Oversized but still under COMPACTION_MAX_PROMPT_TOKENS so the
		// second-pass batch is a single fetchSummary call.
		const oversizedContent = "z".repeat(
			(MAX_KEPT_MESSAGE_TOKENS + 1_000) * APPROX_CHARS_PER_TOKEN,
		);
		// 12 head messages (will be compacted) + 8 recent tail messages,
		// with the last tail message oversized.
		const msgs: TrainerMessage[] = [];
		for (let i = 0; i < 12; i++) {
			msgs.push(
				makeMessage(
					i % 2 === 0 ? "user" : "assistant",
					`head ${i}`,
					new Date(2025, 0, 1, 0, 0, i).toISOString(),
				),
			);
		}
		for (let i = 0; i < 7; i++) {
			msgs.push(
				makeMessage(
					i % 2 === 0 ? "user" : "assistant",
					`tail ${i}`,
					new Date(2025, 0, 1, 0, 0, 12 + i).toISOString(),
				),
			);
		}
		msgs.push({
			id: nextId(),
			role: "assistant",
			content: oversizedContent,
			createdAt: new Date(2025, 0, 1, 0, 0, 19).toISOString(),
		});

		const { fn, calls } = recordingFetchSummary("SUMMARY");
		const result = await compactMessages(msgs, {
			fetchSummary: fn,
		});

		expect(result.compacted).toBe(true);
		expect(result.removed).toBe(13); // 12 head + 1 oversized kept
		// Head summary (1 call) + oversized-message second pass. The second
		// pass always chunks because MAX_KEPT_MESSAGE_TOKENS > the prompt
		// limit, so it produces 1 chunk call + 1 merge call = 3 total.
		expect(calls.length).toBe(3);

		// The first message is the head context summary, the second is the
		// oversized-message summary.
		expect(result.messages[0].content).toContain("## Context Summary");
		expect(result.messages[1].content).toContain("## Earlier Message Summary");

		// The oversized message should NOT appear verbatim in the output.
		for (const m of result.messages) {
			expect(m.content).not.toContain(oversizedContent);
		}
	});

	it("propagates summary errors with a Compaction failed prefix", async () => {
		const fn = () => Promise.reject(new Error("llm down"));
		const msgs = alternatingConversation(20);
		await expect(compactMessages(msgs, { fetchSummary: fn })).rejects.toThrow(
			"Compaction failed: llm down",
		);
	});

	it("forwards the abort signal to every fetchSummary call", async () => {
		const { fn, abortSignals } = recordingFetchSummary("S");
		const controller = new AbortController();
		const msgs = alternatingConversation(20); // 1 summary call
		await compactMessages(msgs, {
			fetchSummary: fn,
			abortSignal: controller.signal,
		});
		expect(abortSignals.length).toBe(1);
		expect(abortSignals[0]).toBe(controller.signal);
	});

	it("preserves tool calls on kept messages", async () => {
		const { fn } = recordingFetchSummary("S");
		// 8 recent messages; the last assistant one has a tool call.
		const msgs = alternatingConversation(8);
		const lastAssistant = msgs[msgs.length - 1];
		msgs[msgs.length - 1] = {
			...lastAssistant,
			toolCalls: [makeToolCall("zone_analysis", { activityId: "a1" })],
		};

		// All 8 are recent → nothing to compact → returned as-is (no fresh ids).
		const result = await compactMessages(msgs, {
			fetchSummary: fn,
		});
		expect(result.compacted).toBe(false);
		expect(result.messages[result.messages.length - 1].toolCalls?.length).toBe(
			1,
		);
	});

	it("gives fresh ids to kept messages when compacting", async () => {
		const { fn } = recordingFetchSummary("S");
		const msgs = alternatingConversation(20);
		const result = await compactMessages(msgs, {
			fetchSummary: fn,
		});
		expect(result.compacted).toBe(true);
		// No output id should collide with any input id.
		const inputIds = new Set(msgs.map((m) => m.id));
		for (const m of result.messages) {
			expect(inputIds.has(m.id)).toBe(false);
		}
	});
});
