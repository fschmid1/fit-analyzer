import type { TrainerMessage, UIToolCall } from "@fit-analyzer/shared";
import {
	APPROX_CHARS_PER_TOKEN,
	APPROX_TOKENS_PER_IMAGE,
} from "@fit-analyzer/shared";

// ─── Budget constants ─────────────────────────────────────────────────────────

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

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Options for compacting a thread's messages.
 *
 * `fetchSummary` is injected so the pure compaction logic can be tested
 * without a live LLM or network. In production the route wires it up to
 * the provider-specific chat-completion helper.
 */
export interface CompactionOptions {
	/**
	 * Summarize the given prompt and return the resulting text. The
	 * implementation is responsible for provider routing, timeouts, and
	 * error handling. The optional `AbortSignal` MUST be forwarded to the
	 * underlying fetch so a cancelled compaction aborts the LLM call.
	 */
	fetchSummary: (prompt: string, abortSignal?: AbortSignal) => Promise<string>;
	/** Optional abort signal forwarded to every summarization call. */
	abortSignal?: AbortSignal;
}

export interface CompactionResult {
	compacted: boolean;
	/** New message stream to persist into the forked thread. */
	messages: TrainerMessage[];
	/** Number of original messages rolled into the context summary. */
	removed: number;
}

/**
 * Compact a thread's message history.
 *
 * The most recent messages are kept verbatim (with fresh ids); everything
 * older is summarized into a single context-summary message. Kept messages
 * that individually exceed the per-message budget are also summarized so the
 * resulting fork never exceeds the model's context window.
 *
 * Returns `{ compacted: false }` when there is nothing to summarize (e.g.
 * the thread already fits within the keep window). The caller is then
 * responsible for short-circuiting the HTTP response.
 */
export async function compactMessages(
	allMessages: TrainerMessage[],
	options: CompactionOptions,
): Promise<CompactionResult> {
	const { fetchSummary, abortSignal } = options;

	const { keepEndIds, cutoffIndex } = computeRecentKeepWindow(
		allMessages,
		COMPACTION_KEPT_BUDGET_TOKENS,
		0,
	);
	const toCompact = cutoffIndex === 0 ? [] : allMessages.slice(0, cutoffIndex);
	const keptMessages = allMessages.slice(cutoffIndex);

	// The tail we kept verbatim must itself fit under the per-message limit.
	// Any message (user or assistant) that exceeds the limit is summarized so
	// the resulting fork never exceeds the LLM context window. This runs
	// even when there is no head to compact — a thread whose only problem is
	// a single gigantic recent message still needs that message summarized.
	const oversizedKeptMessages: TrainerMessage[] = [];
	for (const m of keptMessages) {
		if (messageTokenLength(m) > MAX_KEPT_MESSAGE_TOKENS) {
			oversizedKeptMessages.push(m);
		}
	}

	// Nothing to do: no old messages to summarize AND no oversized kept
	// messages. Return the original stream untouched.
	if (toCompact.length === 0 && oversizedKeptMessages.length === 0) {
		return { compacted: false, messages: allMessages, removed: 0 };
	}

	let summary: string | undefined;
	if (toCompact.length > 0) {
		try {
			summary = await summarizeBatch(toCompact, fetchSummary, abortSignal);
		} catch (err) {
			const details = err instanceof Error ? err.message : String(err);
			throw new Error(`Compaction failed: ${details}`);
		}
	}

	let keptTailSummary: string | undefined;
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
			fetchSummary,
			abortSignal,
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

	return {
		compacted: true,
		messages: newMessages,
		removed: toCompact.length + oversizedKeptMessages.length,
	};
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

export function messageTokenLength(m: TrainerMessage): number {
	let n = Math.ceil(m.content.length / APPROX_CHARS_PER_TOKEN);
	if (m.attachments && m.attachments.length > 0) {
		n += m.attachments.length * APPROX_TOKENS_PER_IMAGE;
	}
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

export function estimateTokenLength(text: string): number {
	return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function computeRecentKeepWindow(
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
	// message check in compactMessages will summarize the remaining
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

export function formatMessageForCompaction(m: TrainerMessage): string {
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

export function buildCompactionPrompt(messagesText: string): string {
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

export function truncateSummary(text: string): string {
	const maxChars = COMPACTION_MAX_SUMMARY_TOKENS * APPROX_CHARS_PER_TOKEN;
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}…`;
}

/**
 * Summarize a batch of old messages without exceeding a single LLM prompt.
 * If the batch is too large, split it into chunks, summarize each chunk, then
 * merge the chunk summaries into one final summary.
 */
export async function summarizeBatch(
	toCompact: TrainerMessage[],
	fetchSummary: (prompt: string, abortSignal?: AbortSignal) => Promise<string>,
	abortSignal?: AbortSignal,
): Promise<string> {
	const messagesText = toCompact
		.map(formatMessageForCompaction)
		.join("\n\n---\n\n");

	const prompt = buildCompactionPrompt(messagesText);
	const promptTokens = estimateTokenLength(prompt);
	if (promptTokens <= COMPACTION_MAX_PROMPT_TOKENS) {
		return fetchSummary(prompt, abortSignal);
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
		const summary = await fetchSummary(chunkPrompt, abortSignal);
		chunkSummaries.push(summary);
	}

	const mergedPrompt = `You are merging several partial summaries of a long sports coaching conversation into one coherent, concise context summary. Preserve ALL important details and remove redundancy.

${chunkSummaries.map((s, i) => `## Partial summary ${i + 1}\n\n${s}`).join("\n\n---\n\n")}`;
	return fetchSummary(mergedPrompt, abortSignal);
}

// Exposed for tests that need to construct oversized messages or assert
// budget-boundary behavior without hard-coding magic numbers.
export const COMPACTION_KEPT_BUDGET_TOKENS__FOR_TESTS =
	COMPACTION_KEPT_BUDGET_TOKENS;
export const MAX_KEPT_MESSAGE_TOKENS__FOR_TESTS = MAX_KEPT_MESSAGE_TOKENS;
export const COMPACTION_MAX_PROMPT_TOKENS__FOR_TESTS =
	COMPACTION_MAX_PROMPT_TOKENS;
