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
    },
    {
        id: "z-ai/glm-5.2",
        name: "GLM 5.2",
        provider: "openrouter" as Provider,
    },
    {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "openrouter" as Provider,
    },
    // Ollama Cloud models
    {
        id: "kimi-k2.6",
        name: "Kimi K2.6",
        provider: "ollama-cloud" as Provider,
    },
    {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider: "ollama-cloud" as Provider,
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
