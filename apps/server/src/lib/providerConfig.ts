import type { ModelMessage, UIMessage } from "@tanstack/ai";
import { AVAILABLE_MODELS, getModelProvider } from "@fit-analyzer/shared";
import { env } from "../env.js";
import { getCoachModelSettings } from "./coachModelSettings.js";
import { getOllamaModels } from "./ollamaModelCache.js";

// ─── Provider config ──────────────────────────────────────────────────────────

export interface ProviderConfig {
	provider: "openrouter" | "ollama-cloud";
	apiKey: string | undefined;
	apiKeyEnvName: "OPENROUTER_KEY" | "OLLAMA_CLOUD_KEY";
	baseUrl: string;
	includeReasoning: boolean;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Resolve the provider config (API key, base URL, reasoning toggle) for a
 * given model id. Static provider hints from `AVAILABLE_MODELS` are checked
 * first; unknown ids fall back to the dynamic Ollama model cache, then to
 * OpenRouter as a last resort.
 */
export async function getProviderConfig(
	modelId: string,
): Promise<ProviderConfig> {
	const staticProvider = getModelProvider(modelId);
	if (staticProvider === "ollama-cloud") {
		return ollamaCloudConfig();
	}
	if (staticProvider === "openrouter") {
		return openrouterConfig();
	}

	// Check dynamic Ollama cache
	const ollamaModels = await getOllamaModels();
	if (ollamaModels.some((m) => m.id === modelId)) {
		return ollamaCloudConfig();
	}

	// Default: openrouter
	return openrouterConfig();
}

function ollamaCloudConfig(): ProviderConfig {
	return {
		provider: "ollama-cloud",
		apiKey: env.OLLAMA_CLOUD_KEY,
		apiKeyEnvName: "OLLAMA_CLOUD_KEY",
		baseUrl: env.OLLAMA_BASE_URL,
		includeReasoning: false,
	};
}

function openrouterConfig(): ProviderConfig {
	return {
		provider: "openrouter",
		apiKey: env.OPENROUTER_KEY,
		apiKeyEnvName: "OPENROUTER_KEY",
		baseUrl: OPENROUTER_BASE_URL,
		includeReasoning: true,
	};
}

// ─── Model resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the model to use for a thread. A thread's own `coachModel` wins if
 * it is a known model (static list or dynamic Ollama cache); otherwise the
 * user's global coach-model setting is used.
 */
export async function resolveThreadModel(
	thread: { coachModel: string | null } | undefined | null,
	userId: string,
): Promise<string> {
	if (thread?.coachModel) {
		const known = AVAILABLE_MODELS.find((m) => m.id === thread.coachModel);
		if (known) return known.id;
		const ollamaModels = await getOllamaModels();
		if (ollamaModels.some((m) => m.id === thread.coachModel)) {
			return thread.coachModel;
		}
	}
	const settings = await getCoachModelSettings(userId);
	return settings.coachModel;
}

// ─── Kimi request metadata ────────────────────────────────────────────────────

/**
 * Build the OpenRouter request metadata used by Moonshot's automatic context
 * cache. `conversationId` falls back to `threadId` when not supplied.
 */
export function getKimiRequestMetadata(
	userId: string,
	threadId?: string,
	conversationId?: string,
): Record<string, unknown> {
	const resolvedConversationId = conversationId ?? threadId;
	return {
		app: "fit-analyzer",
		feature: "trainer-chat",
		context_cache: "openrouter-moonshot-automatic",
		user_id: userId,
		...(threadId ? { thread_id: threadId } : {}),
		...(resolvedConversationId
			? { conversation_id: resolvedConversationId }
			: {}),
	};
}

// ─── Message sanitization ─────────────────────────────────────────────────────

/**
 * Strip `display` fields from tool-call part outputs before converting to
 * ModelMessages.  The `display` blob is purely for UI rendering and can
 * contain thousands of per-second data points (records, lat/lng, etc.).
 * Keeping it out of the LLM context prevents immediate context bloat.
 */
export function sanitizeMessagesForModel(
	messages: Array<UIMessage | ModelMessage>,
): Array<UIMessage | ModelMessage> {
	return messages.map((msg) => {
		if ("parts" in msg && Array.isArray(msg.parts)) {
			const parts = msg.parts.map((part) => {
				if (
					part.type === "tool-call" &&
					part.output &&
					typeof part.output === "object"
				) {
					const output = { ...part.output } as Record<string, unknown>;
					if (output.result && typeof output.result === "object") {
						const result = { ...output.result } as Record<string, unknown>;
						const { display: _, ...resultWithoutDisplay } = result;
						output.result = resultWithoutDisplay;
					}
					return { ...part, output };
				}
				return part;
			});
			return { ...msg, parts };
		}
		return msg;
	});
}

// ─── Non-streaming chat completion (for compaction) ───────────────────────────

/**
 * Non-streaming chat completion used by the compaction engine. Routes to the
 * provider-specific endpoint and returns the assistant message text.
 *
 * This is the production wiring of the compaction engine's injected
 * `fetchSummary` callback — it depends on provider config + env secrets, so
 * it lives here next to the provider config rather than in the pure
 * compaction module.
 */
export async function fetchCompactionSummary(
	providerConfig: ProviderConfig,
	model: string,
	prompt: string,
	abortSignal?: AbortSignal,
): Promise<string> {
	// Combine the caller's abort signal with the 240s timeout so either one
	// cancels the request. If the caller already aborted, the fetch fails fast.
	const timeoutSignal = AbortSignal.timeout(240_000);
	const signal = abortSignal
		? AbortSignal.any([abortSignal, timeoutSignal])
		: timeoutSignal;

	const isOllama = providerConfig.provider === "ollama-cloud";
	const endpoint = isOllama ? "/api/chat" : "/chat/completions";
	const body: Record<string, unknown> = {
		model,
		messages: [{ role: "user", content: prompt }],
	};
	if (isOllama) body.stream = false;

	const response = await fetch(`${providerConfig.baseUrl}${endpoint}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${providerConfig.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const err = await response.json().catch(() => ({}));
		throw new Error(`Compaction request failed: ${JSON.stringify(err)}`);
	}

	const data = await response.json();
	if (isOllama) {
		return data.message?.content ?? "*(Summary unavailable)*";
	}
	return data.choices?.[0]?.message?.content ?? "*(Summary unavailable)*";
}
