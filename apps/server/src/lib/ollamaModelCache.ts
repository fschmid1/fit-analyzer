import { env } from "../env.js";

let cachedModels: Array<{ id: string; name: string; provider: "ollama-cloud" }> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchOllamaModels(): Promise<
	Array<{ id: string; name: string; provider: "ollama-cloud" }>
> {
	const headers: Record<string, string> = {};
	if (env.OLLAMA_CLOUD_KEY) {
		headers.Authorization = `Bearer ${env.OLLAMA_CLOUD_KEY}`;
	}

	const response = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, { headers });
	if (!response.ok) {
		throw new Error(
			`Failed to fetch Ollama models: ${response.status} ${response.statusText}`,
		);
	}

	const data = (await response.json()) as {
		models?: Array<{
			name: string;
			model?: string;
		}>
	};

	return (data.models ?? []).map((m) => ({
		id: m.name,
		name: m.name,
		provider: "ollama-cloud" as const,
	}));
}

export async function getOllamaModels(): Promise<
	Array<{ id: string; name: string; provider: "ollama-cloud" }>
> {
	if (cachedModels && Date.now() - cachedAt < CACHE_TTL_MS) {
		return cachedModels;
	}

	try {
		cachedModels = await fetchOllamaModels();
		cachedAt = Date.now();
		return cachedModels;
	} catch (error) {
		console.error("[ollamaModelCache] fetch failed:", error);
		return cachedModels ?? [];
	}
}

export function isOllamaModelKnown(modelId: string): boolean {
	if (!cachedModels) return false;
	return cachedModels.some((m) => m.id === modelId);
}
