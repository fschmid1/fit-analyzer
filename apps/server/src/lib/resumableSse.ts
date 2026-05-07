import type { Publisher, Subscriber } from "resumable-stream/generic";

type Listener = (message: string) => void;

const ONE_DAY_SECONDS = 24 * 60 * 60;

class InMemoryRedisLikeStore {
	private readonly values = new Map<string, string>();
	private readonly expirations = new Map<string, number>();
	private readonly listeners = new Map<string, Set<Listener>>();

	async connect() {
		return;
	}

	async subscribe(channel: string, callback: Listener) {
		const callbacks = this.listeners.get(channel) ?? new Set<Listener>();
		callbacks.add(callback);
		this.listeners.set(channel, callbacks);
	}

	async unsubscribe(channel: string) {
		this.listeners.delete(channel);
	}

	async publish(channel: string, message: string) {
		const callbacks = this.listeners.get(channel);
		if (!callbacks) return 0;
		for (const callback of callbacks) {
			queueMicrotask(() => callback(message));
		}
		return callbacks.size;
	}

	async set(key: string, value: string, options?: { EX?: number }) {
		this.values.set(key, value);
		if (options?.EX) {
			this.expirations.set(key, Date.now() + options.EX * 1000);
		} else {
			this.expirations.delete(key);
		}
		return "OK" as const;
	}

	async get(key: string) {
		this.purgeIfExpired(key);
		return this.values.get(key) ?? null;
	}

	async incr(key: string) {
		this.purgeIfExpired(key);
		const current = this.values.get(key);
		if (current == null) {
			this.values.set(key, "1");
			this.expirations.set(key, Date.now() + ONE_DAY_SECONDS * 1000);
			return 1;
		}

		const numeric = Number.parseInt(current, 10);
		if (Number.isNaN(numeric) || String(numeric) !== current) {
			throw new Error("ERR value is not an integer or out of range");
		}

		const next = numeric + 1;
		this.values.set(key, String(next));
		if (!this.expirations.has(key)) {
			this.expirations.set(key, Date.now() + ONE_DAY_SECONDS * 1000);
		}
		return next;
	}

	private purgeIfExpired(key: string) {
		const expiresAt = this.expirations.get(key);
		if (expiresAt != null && expiresAt <= Date.now()) {
			this.expirations.delete(key);
			this.values.delete(key);
		}
	}
}

const store = new InMemoryRedisLikeStore();

export const inMemoryResumablePublisher: Publisher = {
	connect: () => store.connect(),
	publish: (channel, message) => store.publish(channel, message),
	set: (key, value, options) => store.set(key, value, options),
	get: (key) => store.get(key),
	incr: (key) => store.incr(key),
};

export const inMemoryResumableSubscriber: Subscriber = {
	connect: () => store.connect(),
	subscribe: (channel, callback) => store.subscribe(channel, callback),
	unsubscribe: (channel) => store.unsubscribe(channel),
};
