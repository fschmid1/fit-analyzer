import type { StreamChunk } from "@tanstack/ai";
import type { ToolStreamChunk } from "@fit-analyzer/shared";
import { db } from "../db.js";

const updateContextTokensStmt = db.prepare(
	"UPDATE trainer_chats SET context_tokens = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
);

type RegistryEntry = {
	chunks: string[];
	done: boolean;
	waiters: Set<() => void>;
	startedAt: number;
	userId: string | null;
	threadId: string | null;
	abortController: AbortController | null;
};

type ProducerChunk = StreamChunk | ToolStreamChunk;

const ONE_HOUR_MS = 60 * 60 * 1000;
const registry = new Map<string, RegistryEntry>();

function getOrCreateEntry(streamId: string): RegistryEntry {
	const existing = registry.get(streamId);
	if (existing) return existing;

	const entry: RegistryEntry = {
		chunks: [],
		done: false,
		waiters: new Set(),
		startedAt: Date.now(),
		userId: null,
		threadId: null,
		abortController: null,
	};
	registry.set(streamId, entry);
	return entry;
}

function notify(entry: RegistryEntry) {
	const waiters = Array.from(entry.waiters);
	entry.waiters.clear();
	for (const waiter of waiters) waiter();
}

function cleanupIfExpired(streamId: string, entry: RegistryEntry) {
	if (!entry.done) return;
	if (Date.now() - entry.startedAt < ONE_HOUR_MS) return;
	registry.delete(streamId);
}

export function startTrainerStreamProducer(
	streamId: string,
	stream: AsyncIterable<ProducerChunk>,
	userId: string,
	threadId: string | undefined,
	abortSignal?: AbortSignal,
) {
	const entry = getOrCreateEntry(streamId);
	if (entry.chunks.length > 0 || entry.done) {
		return;
	}
	entry.userId = userId;
	entry.threadId = threadId ?? null;

	const abortController = new AbortController();
	entry.abortController = abortController;

	const combinedSignal = abortSignal
		? AbortSignal.any([abortController.signal, abortSignal])
		: abortController.signal;

	void (async () => {
		let lastPromptTokens: number | undefined;
		try {
			for await (const chunk of stream) {
				if (combinedSignal.aborted) break;
				entry.chunks.push(`data: ${JSON.stringify(chunk)}\n\n`);
				notify(entry);
				if (
					chunk.type === "RUN_FINISHED" &&
					"usage" in chunk &&
					chunk.usage &&
					typeof chunk.usage === "object" &&
					"promptTokens" in chunk.usage &&
					typeof chunk.usage.promptTokens === "number"
				) {
					lastPromptTokens = chunk.usage.promptTokens;
				}
			}
			if (!combinedSignal.aborted) {
				entry.chunks.push("data: [DONE]\n\n");
			}
		} catch (error) {
			if (combinedSignal.aborted) return;
			entry.chunks.push(
				`data: ${JSON.stringify({
					type: "RUN_ERROR",
					timestamp: Date.now(),
					error: {
						message:
							error instanceof Error ? error.message : "Unknown error occurred",
					},
				})}\n\n`,
			);
			entry.chunks.push("data: [DONE]\n\n");
		} finally {
			entry.done = true;
			entry.abortController = null;
			if (
				lastPromptTokens !== undefined &&
				lastPromptTokens > 0 &&
				entry.threadId &&
				entry.userId
			) {
				try {
					updateContextTokensStmt.run(
						lastPromptTokens,
						entry.threadId,
						entry.userId,
					);
				} catch {
					// Persisting context tokens is best-effort; don't fail the stream.
				}
			}
			notify(entry);
			setTimeout(() => cleanupIfExpired(streamId, entry), ONE_HOUR_MS);
		}
	})();
}

export function hasActiveTrainerStream(streamId: string): boolean {
	const entry = registry.get(streamId);
	return Boolean(entry && (!entry.done || entry.chunks.length > 0));
}

export function cancelTrainerStream(streamId: string): boolean {
	const entry = registry.get(streamId);
	if (!entry || entry.done) return false;
	entry.abortController?.abort();
	return true;
}

export function verifyStreamOwner(streamId: string, userId: string): boolean {
	const entry = registry.get(streamId);
	if (!entry) return false;
	return entry.userId === null || entry.userId === userId;
}

export function createTrainerStreamConsumer(
	streamId: string,
): ReadableStream<string> {
	const entry = getOrCreateEntry(streamId);
	let waiter: (() => void) | null = null;

	return new ReadableStream<string>({
		start(controller) {
			let index = 0;
			let closed = false;

			const flush = () => {
				if (closed) return;

				while (index < entry.chunks.length) {
					const chunk = entry.chunks[index];
					if (chunk === undefined) break;
					controller.enqueue(chunk);
					index++;
				}

				if (entry.done) {
					closed = true;
					if (waiter) {
						entry.waiters.delete(waiter);
					}
					controller.close();
				}
			};

			waiter = () => {
				if (!closed) {
					const currentWaiter = waiter;
					if (currentWaiter) {
						entry.waiters.add(currentWaiter);
					}
				}
				flush();
			};

			entry.waiters.add(waiter);
			flush();
		},
		cancel() {
			if (waiter) {
				entry.waiters.delete(waiter);
			}
			entry.abortController?.abort();
		},
	});
}
