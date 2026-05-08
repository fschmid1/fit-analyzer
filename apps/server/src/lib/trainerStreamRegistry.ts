import type { StreamChunk } from "@tanstack/ai";

type RegistryEntry = {
	chunks: string[];
	done: boolean;
	waiters: Set<() => void>;
	startedAt: number;
};

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
	stream: AsyncIterable<StreamChunk>,
) {
	const entry = getOrCreateEntry(streamId);
	if (entry.chunks.length > 0 || entry.done) return;

	void (async () => {
		try {
			for await (const chunk of stream) {
				entry.chunks.push(`data: ${JSON.stringify(chunk)}\n\n`);
				notify(entry);
			}
			entry.chunks.push("data: [DONE]\n\n");
		} catch (error) {
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
		},
	});
}
