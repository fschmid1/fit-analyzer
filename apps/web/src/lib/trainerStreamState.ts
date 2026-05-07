import type { UIMessage } from "@tanstack/ai-react";

const ACTIVE_STREAMS_KEY = "fit-analyzer:trainer:active-streams";
const DRAFT_MESSAGES_KEY = "fit-analyzer:trainer:drafts";

type ActiveTrainerStream = {
	threadId: string;
	streamId: string;
	updatedAt: string;
};

type SerializableUIMessage = Omit<UIMessage, "createdAt"> & {
	createdAt?: string;
};

function readJson<T>(key: string): T | null {
	try {
		const raw = sessionStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		sessionStorage.removeItem(key);
		return null;
	}
}

function readPersistentJson<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		localStorage.removeItem(key);
		sessionStorage.removeItem(key);
		return null;
	}
}

function writePersistentJson(key: string, value: unknown) {
	try {
		const encoded = JSON.stringify(value);
		localStorage.setItem(key, encoded);
		sessionStorage.setItem(key, encoded);
	} catch {
		// Ignore storage failures.
	}
}

function writeJson(key: string, value: unknown) {
	try {
		sessionStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Ignore session storage failures.
	}
}

function readActiveStreams(): Record<string, ActiveTrainerStream> {
	return (
		readPersistentJson<Record<string, ActiveTrainerStream>>(
			ACTIVE_STREAMS_KEY,
		) ?? {}
	);
}

function readDrafts(): Record<string, SerializableUIMessage[]> {
	return (
		readJson<Record<string, SerializableUIMessage[]>>(DRAFT_MESSAGES_KEY) ?? {}
	);
}

export function saveActiveTrainerStream(threadId: string, streamId: string) {
	const activeStreams = readActiveStreams();
	activeStreams[threadId] = {
		threadId,
		streamId,
		updatedAt: new Date().toISOString(),
	};
	writePersistentJson(ACTIVE_STREAMS_KEY, activeStreams);
}

export function loadActiveTrainerStream(
	threadId: string,
): ActiveTrainerStream | null {
	return readActiveStreams()[threadId] ?? null;
}

export function clearActiveTrainerStream(threadId: string) {
	const activeStreams = readActiveStreams();
	delete activeStreams[threadId];
	writePersistentJson(ACTIVE_STREAMS_KEY, activeStreams);
}

export function saveTrainerDraft(threadId: string, messages: UIMessage[]) {
	const drafts = readDrafts();
	drafts[threadId] = messages.map((message) => ({
		...message,
		createdAt: message.createdAt?.toISOString(),
	}));
	writeJson(DRAFT_MESSAGES_KEY, drafts);
}

export function loadTrainerDraft(threadId: string): UIMessage[] | null {
	const draft = readDrafts()[threadId];
	if (!draft) return null;
	return draft.map((message) => ({
		...message,
		createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
	}));
}

export function clearTrainerDraft(threadId: string) {
	const drafts = readDrafts();
	delete drafts[threadId];
	writeJson(DRAFT_MESSAGES_KEY, drafts);
}
