import type { ToolStreamChunk, UIToolCall } from "@fit-analyzer/shared";

/**
 * Accumulate a trainer tool-loop stream without a client: collects the assistant
 * text and the tool calls (with their display payloads) so a caller can persist
 * the result. Used by the activity-analysis route and the unattended Plan
 * refresh — both consume createTrainerToolLoop directly rather than over SSE.
 */

export interface LoopAccumulator {
	text: string;
	toolCalls: UIToolCall[];
}

export function createLoopAccumulator(): LoopAccumulator {
	return { text: "", toolCalls: [] };
}

/** Text delta carried by a TEXT_MESSAGE_CONTENT chunk, tolerant of shape. */
function textDelta(chunk: { delta?: unknown; content?: unknown }): string {
	if (typeof chunk.delta === "string") return chunk.delta;
	if (typeof chunk.content === "string") return chunk.content;
	return "";
}

/**
 * Fold one stream chunk into the accumulator. Chunks other than assistant text
 * and tool results are ignored. Returns true when the chunk was recorded.
 *
 * The parameter is deliberately loose: the tool loop yields the provider's
 * StreamChunk union plus our ToolStreamChunk, and this consumer only cares
 * about two of the member shapes.
 */
export function accumulateChunk(acc: LoopAccumulator, chunk: unknown): boolean {
	const type = (chunk as { type?: unknown }).type;
	if (type === "TEXT_MESSAGE_CONTENT") {
		acc.text += textDelta(chunk as { delta?: unknown; content?: unknown });
		return true;
	}
	if (type === "TOOL_RESULT") {
		const tool = chunk as ToolStreamChunk;
		const incoming: UIToolCall = {
			id: tool.toolCallId,
			name: tool.toolName,
			arguments:
				acc.toolCalls.find((t) => t.id === tool.toolCallId)?.arguments ?? {},
			status: tool.error ? "error" : "done",
			result: {
				id: tool.toolCallId,
				name: tool.toolName,
				content: tool.content,
				display: tool.display,
				error: tool.error,
			},
		};
		const idx = acc.toolCalls.findIndex((t) => t.id === incoming.id);
		if (idx === -1) acc.toolCalls.push(incoming);
		else acc.toolCalls[idx] = incoming;
		return true;
	}
	return false;
}
