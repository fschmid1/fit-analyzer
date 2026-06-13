import { useEffect, useRef } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerMessage } from "@fit-analyzer/shared";
import { saveTrainerHistory } from "../../lib/api";
import {
	clearTrainerDraft,
	saveTrainerDraft,
} from "../../lib/trainerStreamState";
import { toTrainerMessage } from "./trainerHelpers";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

function persistable(messages: UIMessage[]): TrainerMessage[] {
	return messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map(toTrainerMessage)
		.filter(
			(m) =>
				m.content ||
				(m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0),
		);
}

export function useTrainerHistoryPersist(
	threadId: string,
	messages: UIMessage[],
	status: ChatStatus,
	ensureFullHistory?: (current: UIMessage[]) => Promise<UIMessage[]>,
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
				const toSave = persistable(full);
				if (toSave.length > 0)
					saveTrainerHistory(threadId, toSave).catch(console.error);
				clearTrainerDraft(threadId);
			};
			void save();
		}
		prevStatus.current = status;
	}, [status, messages, threadId, ensureFullHistory]);

	useEffect(() => {
		if (status === "streaming" || status === "submitted") {
			const id = setTimeout(() => {
				saveTrainerDraft(threadId, messages);
			}, 600);
			return () => clearTimeout(id);
		}
	}, [messages, status, threadId]);
}
