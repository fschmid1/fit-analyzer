import type { StreamChunk } from "@tanstack/ai";
import type { ConnectionAdapter } from "@tanstack/ai-client";
import type { ToolStreamChunk } from "@fit-analyzer/shared";
import {
	clearActiveTrainerStream,
	loadActiveTrainerStream,
	saveActiveTrainerStream,
} from "./trainerStreamState";
import { randomUUID } from "./randomUUID";

type TrainerChunk = StreamChunk | ToolStreamChunk;

type Deferred = (chunk: TrainerChunk | null) => void;

function createQueue() {
	const buffer: TrainerChunk[] = [];
	let waiters: Deferred[] = [];
	let closed = false;

	return {
		push(chunk: TrainerChunk) {
			if (closed) return;
			const waiter = waiters.shift();
			if (waiter) waiter(chunk);
			else buffer.push(chunk);
		},
		close() {
			if (closed) return;
			closed = true;
			const pending = waiters;
			waiters = [];
			for (const waiter of pending) waiter(null);
		},
		reset() {
			buffer.length = 0;
			const pending = waiters;
			waiters = [];
			for (const waiter of pending) waiter(null);
			closed = false;
		},
		async *subscribe(abortSignal?: AbortSignal): AsyncIterable<TrainerChunk> {
			while (!abortSignal?.aborted) {
				let chunk: TrainerChunk | null;
				if (buffer.length > 0) {
					chunk = buffer.shift() ?? null;
				} else {
					if (closed) {
						chunk = null;
					} else {
						chunk = await new Promise<TrainerChunk | null>((resolve) => {
							const onAbort = () => resolve(null);
							waiters.push((nextChunk) => {
								abortSignal?.removeEventListener("abort", onAbort);
								resolve(nextChunk);
							});
							abortSignal?.addEventListener("abort", onAbort, { once: true });
						});
					}
				}
				if (chunk === null) break;
				yield chunk;
			}
		},
	};
}

async function streamSseResponse(
	response: Response,
	onChunk: (chunk: TrainerChunk) => void,
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
			const lines = event.split("\n");
			let data: string | undefined;
			for (const line of lines) {
				if (line.startsWith("data: ")) {
					data = line.slice(6);
				} else if (line.startsWith("event: ") || line.trim() === "") {
					// Ignore SSE event name / field names and empty lines.
				} else if (line.trim()) {
					// Unknown line: don't mistake an event name line for data.
					data = undefined;
				}
			}
			if (data === undefined) continue;
			if (data === "[DONE]") return "done";
			onChunk(JSON.parse(data) as TrainerChunk);
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
		streamId?: string,
	) => {
		queue.reset();
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
				shouldClearActiveStream = isMissingStream || isAbort;
				if (isAbort && streamId) {
					fetch(`/api/trainer/chat/${streamId}`, {
						method: "DELETE",
						credentials: "same-origin",
					}).catch(() => {});
				}
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
					activeStream.streamId,
				);
			}
			return queue.subscribe(abortSignal) as AsyncIterable<StreamChunk>;
		},
		async send(messages, data, abortSignal) {
			const activeThreadId = getThreadIdFromData(data);
			const streamId = randomUUID();
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
				streamId,
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
				activeStream.streamId,
			);
			return true;
		},
	};
}
