import type { StreamChunk } from "@tanstack/ai";
import type { ToolStreamChunk } from "@fit-analyzer/shared";
import { debug } from "./debug.js";

type RegistryEntry = {
	chunks: string[];
	done: boolean;
	waiters: Set<() => void>;
	startedAt: number;
	userId: string | null;
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
	};
	registry.set(streamId, entry);
	return entry;
}

function notify(entry: RegistryEntry) {
	const waiters = Array.from(entry.waiters);
	entry.waiters.clear();
	debug.log("trainer-stream", "notify", {
		waiterCount: waiters.length,
		chunkCount: entry.chunks.length,
		done: entry.done,
	});
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
) {
	const entry = getOrCreateEntry(streamId);
	if (entry.chunks.length > 0 || entry.done) {
		debug.log(
			"trainer-stream",
			"startTrainerStreamProducer skipped (already active)",
			{
				streamId,
				chunkCount: entry.chunks.length,
				done: entry.done,
			},
		);
		return;
	}
	entry.userId = userId;
	debug.log("trainer-stream", "startTrainerStreamProducer begin", {
		streamId,
		userId,
	});

	void (async () => {
		const start = Date.now();
		try {
			for await (const chunk of stream) {
				entry.chunks.push(`data: ${JSON.stringify(chunk)}\n\n`);
				notify(entry);
			}
			entry.chunks.push("data: [DONE]\n\n");
			debug.log("trainer-stream", "producer stream complete", {
				streamId,
				elapsedMs: Date.now() - start,
				chunkCount: entry.chunks.length,
			});
		} catch (error) {
			debug.error("trainer-stream", "producer stream threw", {
				streamId,
				elapsedMs: Date.now() - start,
				error: error instanceof Error ? error.message : String(error),
			});
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
			notify(entry);
			setTimeout(() => cleanupIfExpired(streamId, entry), ONE_HOUR_MS);
		}
	})();
}

export function hasActiveTrainerStream(streamId: string): boolean {
	const entry = registry.get(streamId);
	return Boolean(entry && (!entry.done || entry.chunks.length > 0));
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
	debug.log("trainer-stream", "createTrainerStreamConsumer", {
		streamId,
		chunkCount: entry.chunks.length,
		done: entry.done,
	});

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
					debug.log("trainer-stream", "consumer closed", {
						streamId,
						flushedChunks: index,
					});
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
			debug.log("trainer-stream", "consumer cancelled", { streamId });
		},
	});
}
