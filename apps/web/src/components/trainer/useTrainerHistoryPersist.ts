import { useEffect, useRef } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerMessage, UIToolCall } from "@fit-analyzer/shared";
import { saveTrainerHistory } from "../../lib/api";
import {
	clearTrainerDraft,
	saveTrainerDraft,
} from "../../lib/trainerStreamState";
import { toTrainerMessage } from "./trainerHelpers";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

function persistable(
	messages: UIMessage[],
	toolCalls: UIToolCall[],
): TrainerMessage[] {
	const toolCallsByMsgId = new Map<string, UIToolCall[]>();
	for (const tc of toolCalls) {
		const lastAssistantId = findLastAssistantId(messages);
		const msgId = lastAssistantId ?? "";
		const existing = toolCallsByMsgId.get(msgId) ?? [];
		existing.push(tc);
		toolCallsByMsgId.set(msgId, existing);
	}

	return messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => {
			const msg = toTrainerMessage(m);
			const tcs = toolCallsByMsgId.get(m.id);
			if (tcs && tcs.length > 0) {
				msg.toolCalls = tcs.map((tc) => ({
					id: tc.id,
					name: tc.name,
					arguments: tc.arguments,
					status: "done" as const,
					result: tc.result,
				}));
			}
			return msg;
		})
		.filter((m) => m.content);
}

function findLastAssistantId(messages: UIMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") return messages[i].id;
	}
	return undefined;
}

export function useTrainerHistoryPersist(
	threadId: string,
	messages: UIMessage[],
	status: ChatStatus,
	ensureFullHistory?: (current: UIMessage[]) => Promise<UIMessage[]>,
	toolCalls?: UIToolCall[],
) {
	const prevStatus = useRef<ChatStatus>(status);

	useEffect(() => {
		const wasStreaming =
			prevStatus.current === "streaming" || prevStatus.current === "submitted";
		const nowReady = status === "ready" || status === "error";
		if (wasStreaming && nowReady) {
			const save = async () => {
				const full = ensureFullHistory
					? await ensureFullHistory(messages)
					: messages;
				const toSave = persistable(full, toolCalls ?? []);
				if (toSave.length > 0)
					saveTrainerHistory(threadId, toSave).catch(console.error);
				clearTrainerDraft(threadId);
			};
			void save();
		}
		prevStatus.current = status;
	}, [status, messages, threadId, ensureFullHistory, toolCalls]);

	useEffect(() => {
		if (status === "streaming" || status === "submitted") {
			const id = setTimeout(() => {
				saveTrainerDraft(threadId, messages);
			}, 600);
			return () => clearTimeout(id);
		}
	}, [messages, status, threadId]);
}
