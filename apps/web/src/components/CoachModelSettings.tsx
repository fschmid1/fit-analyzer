import {
	AVAILABLE_MODELS,
	type CoachModelSettings as CoachModelSettingsData,
	type ModelEntry,
} from "@fit-analyzer/shared";
import { AlertCircle, Bot, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	fetchAvailableModels,
	fetchUserSettings,
	updateCoachModelSettings,
	updateFavoriteModels,
} from "../lib/api";
import { AnimatedButton } from "./AnimatedButton";
import { ModelPicker } from "./trainer/ModelPicker";

export function CoachModelSettings() {
	const [settings, setSettings] = useState<CoachModelSettingsData | null>(null);
	const [selected, setSelected] = useState<string>(AVAILABLE_MODELS[0].id);
	const [availableModels, setAvailableModels] = useState<ModelEntry[]>([
		...AVAILABLE_MODELS,
	]);
	const [favorites, setFavorites] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		Promise.all([fetchUserSettings(), fetchAvailableModels()])
			.then(([settingsData, models]) => {
				setSettings(settingsData.coachModel);
				setAvailableModels(models);
				setFavorites(settingsData.favoriteModels);
				setSelected(
					models.find((m) => m.id === settingsData.coachModel.coachModel)?.id ??
						models[0]?.id ??
						AVAILABLE_MODELS[0].id,
				);
			})
			.catch((error) => {
				setNotification({
					type: "error",
					message:
						error instanceof Error ? error.message : "Failed to load settings",
				});
			})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!notification) return;
		const timeoutId = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(timeoutId);
	}, [notification]);

	const isDirty = settings !== null && selected !== settings.coachModel;

	const handleSave = async () => {
		setSaving(true);
		setNotification(null);
		try {
			const next = await updateCoachModelSettings({
				coachModel: selected,
			});
			setSettings(next);
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
			{notification && (
				<div
					className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
						notification.type === "success"
							? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
							: "bg-red-500/10 border border-red-500/20 text-red-400"
					}`}
				>
					{notification.type === "success" ? (
						<CheckCircle2 className="w-4 h-4 shrink-0" />
					) : (
						<AlertCircle className="w-4 h-4 shrink-0" />
					)}
					{notification.message}
				</div>
			)}

			<div className="p-5 bg-[#1a1533]/70 border border-[rgba(139,92,246,0.15)] rounded-xl flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#8b5cf6]/10 shrink-0">
						<Bot className="w-5 h-5 text-[#a78bfa]" />
					</div>
					<div>
						<p className="text-sm font-semibold text-[#f1f5f9]">Coach model</p>
						<p className="text-xs text-[#94a3b8]">
							Choose the AI model used by the cycling coach.
						</p>
					</div>
					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{!loading && (
					<>
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1]">Model</span>
							<ModelPicker
								currentModel={selected}
								defaultModel={null}
								availableModels={availableModels}
								onChange={setSelected}
								favorites={favorites}
								onToggleFavorite={handleToggleFavorite}
							/>
						</label>

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
			</div>
		</div>
	);
}
