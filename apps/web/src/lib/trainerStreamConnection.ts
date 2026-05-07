import type { StreamChunk } from "@tanstack/ai";
import type { ConnectionAdapter } from "@tanstack/ai-client";
import {
	clearActiveTrainerStream,
	loadActiveTrainerStream,
	saveActiveTrainerStream,
} from "./trainerStreamState";

type Deferred = (chunk: StreamChunk | null) => void;

function createQueue() {
	let buffer: StreamChunk[] = [];
	let waiters: Deferred[] = [];

	return {
		push(chunk: StreamChunk) {
			const waiter = waiters.shift();
			if (waiter) waiter(chunk);
			else buffer.push(chunk);
		},
		close() {
			const pending = waiters;
			waiters = [];
			for (const waiter of pending) waiter(null);
		},
		async *subscribe(abortSignal?: AbortSignal): AsyncIterable<StreamChunk> {
			while (!abortSignal?.aborted) {
				let chunk: StreamChunk | null;
				if (buffer.length > 0) {
					chunk = buffer.shift() ?? null;
				} else {
					chunk = await new Promise<StreamChunk | null>((resolve) => {
						const onAbort = () => resolve(null);
						waiters.push((nextChunk) => {
							abortSignal?.removeEventListener("abort", onAbort);
							resolve(nextChunk);
						});
						abortSignal?.addEventListener("abort", onAbort, { once: true });
					});
				}
				if (chunk === null) break;
				yield chunk;
			}
		},
	};
}

async function streamSseResponse(
	response: Response,
	onChunk: (chunk: StreamChunk) => void,
): Promise<"done" | "incomplete"> {
	if (!response.ok) {
		throw new Error(
			`HTTP error! status: ${response.status} ${response.statusText}`,
		);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("Response body is not readable");

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
			if (data === "[DONE]") return "done";
			onChunk(JSON.parse(data) as StreamChunk);
		}
	}

	return "incomplete";
}

function getThreadIdFromData(data?: Record<string, unknown>): string {
	const threadId = data?.threadId;
	if (typeof threadId !== "string" || !threadId.trim()) {
		throw new Error("Missing threadId for trainer stream");
	}
	return threadId;
}

export type TrainerStreamConnection = ConnectionAdapter & {
	resumeActiveStream: (abortSignal?: AbortSignal) => boolean;
};

export function createTrainerStreamConnection(
	threadId: string,
): TrainerStreamConnection {
	const queue = createQueue();
	let resumeStarted = false;

	const runStream = async (
		request: Promise<Response>,
		activeThreadId: string,
	) => {
		let shouldClearActiveStream = false;
		try {
			const response = await request;
			const completionState = await streamSseResponse(response, (chunk) =>
				queue.push(chunk),
			);
			shouldClearActiveStream = completionState === "done";
		} catch (error) {
			if (error instanceof Error) {
				const isAbort = error.name === "AbortError";
				const isMissingStream = error.message.includes("404");
				shouldClearActiveStream = isMissingStream;
				if (!isAbort) throw error;
				return;
			}
			throw error;
		} finally {
			if (shouldClearActiveStream) {
				clearActiveTrainerStream(activeThreadId);
			}
			queue.close();
		}
	};

	return {
		subscribe(abortSignal?: AbortSignal) {
			const activeStream = loadActiveTrainerStream(threadId);
			if (activeStream && !resumeStarted) {
				resumeStarted = true;
				void runStream(
					fetch(`/api/trainer/chat/${activeStream.streamId}`, {
						method: "GET",
						credentials: "same-origin",
						signal: abortSignal,
					}),
					threadId,
				);
			}
			return queue.subscribe(abortSignal);
		},
		async send(messages, data, abortSignal) {
			const activeThreadId = getThreadIdFromData(data);
			const streamId = crypto.randomUUID();
			saveActiveTrainerStream(activeThreadId, streamId);

			await runStream(
				fetch("/api/trainer/chat", {
					method: "POST",
					credentials: "same-origin",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						messages,
						...data,
						streamId,
					}),
					signal: abortSignal,
				}),
				activeThreadId,
			);
		},
		resumeActiveStream(abortSignal?: AbortSignal) {
			const activeStream = loadActiveTrainerStream(threadId);
			if (!activeStream || resumeStarted) return false;
			resumeStarted = true;
			void runStream(
				fetch(`/api/trainer/chat/${activeStream.streamId}`, {
					method: "GET",
					credentials: "same-origin",
					signal: abortSignal,
				}),
				threadId,
			);
			return true;
		},
	};
}
