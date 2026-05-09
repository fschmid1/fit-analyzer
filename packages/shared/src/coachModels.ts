export const AVAILABLE_MODELS = [
	{ id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
	{ id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
] as const;

export type AvailableModelId = (typeof AVAILABLE_MODELS)[number]["id"];

export function getCoachModelDisplayName(modelId: string): string {
	const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
	return model?.name ?? modelId;
}
