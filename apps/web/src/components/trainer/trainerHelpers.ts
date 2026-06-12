import type { UIMessage } from "@tanstack/ai-react";
import type { StreamChunk } from "@tanstack/ai";
import type {
	ToolStreamChunk,
	TrainerMessage,
	UIToolCall,
} from "@fit-analyzer/shared";
import { randomUUID } from "../../lib/randomUUID";

export function getTextContent(msg: UIMessage): string {
	return msg.parts
		.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
		.map((p) => p.content)
		.join("");
}

export function getThinkingContent(msg: UIMessage): string {
	return msg.parts
		.filter(
			(p): p is Extract<typeof p, { type: "thinking" }> =>
				p.type === "thinking",
		)
		.map((p) => p.content)
		.join("");
}

// ─── Tool call helpers ────────────────────────────────────────────────────

export function isToolChunk(
	chunk: StreamChunk | ToolStreamChunk,
): chunk is ToolStreamChunk {
	return chunk.type === "TOOL_RESULT";
}

function upsertToolCall(
	toolCalls: UIToolCall[],
	next: UIToolCall,
): UIToolCall[] {
	const idx = toolCalls.findIndex((t) => t.id === next.id);
	if (idx === -1) return [...toolCalls, next];
	const copy = toolCalls.slice();
	copy[idx] = next;
	return copy;
}

export function applyToolChunks(
	toolCalls: UIToolCall[],
	chunk: ToolStreamChunk,
): UIToolCall[] {
	// TOOL_CALL_START/ARGS/END are handled inside the @tanstack/ai
	// stream processor; we just patch in the result here so the UI
	// card can flip from "executing" to "done"/"error".
	const existing = toolCalls.find((t) => t.id === chunk.toolCallId);
	const incoming: UIToolCall = {
		id: chunk.toolCallId,
		name: chunk.toolName,
		arguments: existing?.arguments ?? {},
		status: chunk.error ? "error" : "done",
		result: {
			id: chunk.toolCallId,
			name: chunk.toolName,
			content: chunk.content,
			display: chunk.display,
			error: chunk.error,
		},
	};
	return upsertToolCall(toolCalls, incoming);
}

/**
 * Group tool calls by which assistant message they precede. Tool calls
 * are returned as a single bucket attached to the most recent assistant
 * message; if no assistant message exists yet, they float at the end.
 */
export interface ToolCallGroup {
	beforeMessageId: string | null;
	calls: UIToolCall[];
}

export function groupToolCalls(
	messages: UIMessage[],
	toolCalls: UIToolCall[],
): ToolCallGroup[] {
	if (toolCalls.length === 0) return [];
	let lastAssistantId: string | null = null;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") {
			lastAssistantId = messages[i].id;
			break;
		}
	}
	return [{ beforeMessageId: lastAssistantId, calls: toolCalls }];
}

/**
 * Convenience: find the tool calls that should render above a given
 * message id, based on the grouping produced by {@link groupToolCalls}.
 */
export function toolCallsForMessage(
	messages: UIMessage[],
	toolCalls: UIToolCall[],
	messageId: string,
): UIToolCall[] {
	return groupToolCalls(messages, toolCalls)
		.filter((g) => g.beforeMessageId === messageId)
		.flatMap((g) => g.calls);
}

/**
 * Convenience: tool calls that don't yet have an assistant message to
 * attach to (rendered standalone at the end of the list).
 */
export function trailingToolCalls(
	messages: UIMessage[],
	toolCalls: UIToolCall[],
): UIToolCall[] {
	return groupToolCalls(messages, toolCalls)
		.filter((g) => g.beforeMessageId === null)
		.flatMap((g) => g.calls);
}

export function toUIMessage(m: TrainerMessage): UIMessage {
	return {
		id: m.id,
		role: m.role,
		parts: [{ type: "text" as const, content: m.content }],
		createdAt: new Date(m.createdAt),
	};
}

export function toTrainerMessage(m: UIMessage): TrainerMessage {
	return {
		id: m.id,
		role: m.role as "user" | "assistant",
		content: getTextContent(m),
		createdAt: (m.createdAt ?? new Date()).toISOString(),
	};
}

export function stripTrailingAssistant(messages: UIMessage[]): UIMessage[] {
	if (messages.length === 0) return messages;
	const lastMessage = messages[messages.length - 1];
	if (lastMessage.role !== "assistant") return messages;
	return messages.slice(0, -1);
}

export function ensureAssistantMessage(
	messages: UIMessage[],
	messageId?: string,
): UIMessage[] {
	const lastMessage = messages[messages.length - 1];
	if (lastMessage?.role === "assistant") {
		if (messageId && lastMessage.id !== messageId) {
			return [...messages.slice(0, -1), { ...lastMessage, id: messageId }];
		}
		return messages;
	}

	return [
		...messages,
		{
			id: messageId ?? randomUUID(),
			role: "assistant",
			parts: [],
			createdAt: new Date(),
		},
	];
}

export function applyResumedChunk(
	messages: UIMessage[],
	chunk: StreamChunk,
): UIMessage[] {
	if (
		chunk.type === "RUN_STARTED" ||
		chunk.type === "RUN_FINISHED" ||
		chunk.type === "RUN_ERROR"
	) {
		return messages;
	}

	if (chunk.type === "STEP_STARTED") {
		return ensureAssistantMessage(messages);
	}

	if (chunk.type === "STEP_FINISHED") {
		const nextMessages = ensureAssistantMessage(messages);
		const assistant = nextMessages[nextMessages.length - 1];
		if (!assistant || assistant.role !== "assistant") return nextMessages;

		const existingThinking = assistant.parts.find(
			(part): part is Extract<typeof part, { type: "thinking" }> =>
				part.type === "thinking",
		);
		const nextThinking =
			chunk.content ?? `${existingThinking?.content ?? ""}${chunk.delta ?? ""}`;
		const nextParts = assistant.parts.some((part) => part.type === "thinking")
			? assistant.parts.map((part) =>
					part.type === "thinking" ? { ...part, content: nextThinking } : part,
				)
			: [
					...assistant.parts,
					{ type: "thinking" as const, content: nextThinking },
				];

		return [...nextMessages.slice(0, -1), { ...assistant, parts: nextParts }];
	}

	if (chunk.type === "TEXT_MESSAGE_START") {
		return ensureAssistantMessage(messages, chunk.messageId);
	}

	if (chunk.type === "TEXT_MESSAGE_CONTENT") {
		const nextMessages = ensureAssistantMessage(messages, chunk.messageId);
		const assistant = nextMessages[nextMessages.length - 1];
		if (!assistant || assistant.role !== "assistant") return nextMessages;

		const existingText = assistant.parts.find(
			(part): part is Extract<typeof part, { type: "text" }> =>
				part.type === "text",
		);
		const nextText =
			chunk.content ?? `${existingText?.content ?? ""}${chunk.delta ?? ""}`;
		const nextParts = assistant.parts.some((part) => part.type === "text")
			? assistant.parts.map((part) =>
					part.type === "text" ? { ...part, content: nextText } : part,
				)
			: [...assistant.parts, { type: "text" as const, content: nextText }];

		return [
			...nextMessages.slice(0, -1),
			{ ...assistant, id: chunk.messageId, parts: nextParts },
		];
	}

	return messages;
}

export async function streamResumedChat(
	streamId: string,
	onChunk: (chunk: StreamChunk) => void,
	signal: AbortSignal,
) {
	const response = await fetch(`/api/trainer/chat/${streamId}`, {
		method: "GET",
		credentials: "same-origin",
		signal,
	});

	if (!response.ok) {
		throw new Error(`Resume failed: ${response.status} ${response.statusText}`);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("Resume response body is not readable");

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const events = buffer.split("\n\n");
		buffer = events.pop() ?? "";

		for (const event of events) {
			const line = event
				.split("\n")
				.find((candidate) => candidate.startsWith("data: "));
			if (!line) continue;
			const data = line.slice(6);
			if (data === "[DONE]") return;
			onChunk(JSON.parse(data) as StreamChunk);
		}
	}
}

export function formatTime(date: Date | undefined): string {
	if (!date) return "";
	const now = new Date();
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const time = date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	if (isToday) return time;
	return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}
