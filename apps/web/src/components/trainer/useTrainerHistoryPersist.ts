import { useEffect, useRef } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import { saveTrainerHistory } from "../../lib/api";
import {
	clearTrainerDraft,
	saveTrainerDraft,
} from "../../lib/trainerStreamState";
import { toTrainerMessage } from "./trainerHelpers";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

function persistable(messages: UIMessage[]) {
	return messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map(toTrainerMessage)
		.filter((m) => m.content);
}

export function useTrainerHistoryPersist(
	threadId: string,
	messages: UIMessage[],
	status: ChatStatus,
) {
	const prevStatus = useRef<ChatStatus>(status);

	useEffect(() => {
		const wasStreaming =
			prevStatus.current === "streaming" || prevStatus.current === "submitted";
		const nowReady = status === "ready" || status === "error";
		if (wasStreaming && nowReady) {
			const toSave = persistable(messages);
			if (toSave.length > 0)
				saveTrainerHistory(threadId, toSave).catch(console.error);
			clearTrainerDraft(threadId);
		}
		prevStatus.current = status;
	}, [status, messages, threadId]);

	useEffect(() => {
		if (status === "streaming" || status === "submitted") {
			const id = setTimeout(() => {
				saveTrainerDraft(threadId, messages);
			}, 600);
			return () => clearTimeout(id);
		}
	}, [messages, status, threadId]);
}

export function persistMessagesNow(threadId: string, messages: UIMessage[]) {
	const toSave = persistable(messages);
	if (toSave.length === 0) return;
	saveTrainerHistory(threadId, toSave).catch(console.error);
}
