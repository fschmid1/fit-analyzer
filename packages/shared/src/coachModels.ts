export type Provider = "openrouter" | "ollama-cloud";

export interface ModelEntry {
	id: string;
	name: string;
	provider: Provider;
}

export const AVAILABLE_MODELS = [
	// OpenRouter models
	{
		id: "moonshotai/kimi-k2.6",
		name: "Kimi K2.6",
		provider: "openrouter" as Provider,
		vision: false,
	},
	{
		id: "z-ai/glm-5.2",
		name: "GLM 5.2",
		provider: "openrouter" as Provider,
		vision: false,
	},
	{
		id: "deepseek/deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "openrouter" as Provider,
		vision: false,
	},
	// Ollama Cloud models
	{
		id: "kimi-k2.6",
		name: "Kimi K2.6",
		provider: "ollama-cloud" as Provider,
		vision: false,
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: "ollama-cloud" as Provider,
		vision: false,
	},
] as const;

export type AvailableModelId = (typeof AVAILABLE_MODELS)[number]["id"];

export function getCoachModelDisplayName(modelId: string): string {
	const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
	return model?.name ?? modelId;
}

export function getModelProvider(modelId: string): Provider | undefined {
	return AVAILABLE_MODELS.find((m) => m.id === modelId)?.provider;
}

// Vision capability of the static model list. Returns undefined for Ollama
// models and anything not in the static list — those are "unknown" and the
// app fails open (sends images, lets the provider decide) per ADR-0001.
export function isKnownTextOnlyModel(modelId: string): boolean | undefined {
	const entry = AVAILABLE_MODELS.find((m) => m.id === modelId);
	if (!entry) return undefined;
	return entry.vision === false;
}
