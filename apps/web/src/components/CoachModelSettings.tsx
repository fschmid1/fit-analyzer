import {
	AVAILABLE_MODELS,
	type CoachModelSettings as CoachModelSettingsData,
	type ModelEntry,
} from "@fit-analyzer/shared";
import { AlertCircle, Bot, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	fetchAvailableModels,
	updateCoachModelSettings,
	updateFavoriteModels,
} from "../lib/api";
import { useSettings } from "../lib/settingsContext";
import { AnimatedButton } from "./AnimatedButton";
import { ModelPicker } from "./trainer/ModelPicker";
import { SettingsCard } from "./SettingsCard";

export function CoachModelSettings() {
	const { data, loading, error } = useSettings();
	const [selected, setSelected] = useState<string>(AVAILABLE_MODELS[0].id);
	const [availableModels, setAvailableModels] = useState<ModelEntry[]>([
		...AVAILABLE_MODELS,
	]);
	const [favorites, setFavorites] = useState<string[]>([]);
	const [modelsLoading, setModelsLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		fetchAvailableModels()
			.then((models) => {
				setAvailableModels(models);
				if (data) {
					setSelected(
						models.find((m) => m.id === data.coachModel.coachModel)?.id ??
							models[0]?.id ??
							AVAILABLE_MODELS[0].id,
					);
					setFavorites(data.favoriteModels);
				}
			})
			.catch((error) => {
				setNotification({
					type: "error",
					message:
						error instanceof Error ? error.message : "Failed to load models",
				});
			})
			.finally(() => setModelsLoading(false));
	}, [data]);

	useEffect(() => {
		if (!notification) return;
		const timeoutId = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(timeoutId);
	}, [notification]);

	const currentModelId = data?.coachModel.coachModel;
	const isDirty = currentModelId !== undefined && selected !== currentModelId;

	const handleSave = async () => {
		setSaving(true);
		setNotification(null);
		try {
			const next = await updateCoachModelSettings({
				coachModel: selected,
			});
			setSelected(next.coachModel);
			setNotification({
				type: "success",
				message: "Coach model updated.",
			});
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error ? error.message : "Failed to save settings",
			});
		} finally {
			setSaving(false);
		}
	};

	const handleToggleFavorite = async (modelId: string) => {
		const next = favorites.includes(modelId)
			? favorites.filter((id) => id !== modelId)
			: [...favorites, modelId];
		setFavorites(next);
		try {
			await updateFavoriteModels(next);
		} catch {
			setFavorites(favorites);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{error && (
				<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400">
					<AlertCircle className="w-4 h-4 shrink-0" />
					{error.message}
				</div>
			)}
			{notification?.type === "success" && (
				<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
					<CheckCircle2 className="w-4 h-4 shrink-0" />
					{notification.message}
				</div>
			)}
			{notification?.type === "error" && !error && (
				<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400">
					<AlertCircle className="w-4 h-4 shrink-0" />
					{notification.message}
				</div>
			)}

			<SettingsCard
				icon={<Bot className="w-5 h-5 text-[#a78bfa]" />}
				title="Coach model"
				subtitle="Choose the AI model used by the cycling coach."
				loading={loading || modelsLoading}
			>
				{!loading && !modelsLoading && (
					<>
						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1]">Model</span>
							<ModelPicker
								currentModel={selected}
								defaultModel={null}
								availableModels={availableModels}
								onChange={setSelected}
								favorites={favorites}
								onToggleFavorite={handleToggleFavorite}
							/>
						</div>

						<div className="flex items-center justify-end gap-2 pt-1 border-t border-[rgba(139,92,246,0.1)]">
							<AnimatedButton
								onClick={handleSave}
								disabled={!isDirty || saving}
								className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{saving ? (
									<>
										<Loader2 className="w-4 h-4 animate-spin" />
										Saving…
									</>
								) : (
									"Save"
								)}
							</AnimatedButton>
						</div>
					</>
				)}
			</SettingsCard>
		</div>
	);
}
