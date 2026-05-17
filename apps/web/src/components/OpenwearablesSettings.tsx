import type { OpenwearablesSettings as OpenwearablesSettingsData } from "@fit-analyzer/shared";
import { AlertCircle, CheckCircle2, Heart, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchUserSettings, updateOpenwearablesSettings } from "../lib/api";
import { AnimatedButton } from "./AnimatedButton";

export function OpenwearablesSettings() {
	const [settings, setSettings] = useState<OpenwearablesSettingsData | null>(
		null,
	);
	const [owUserId, setOwUserId] = useState("");
	const [initialOwUserId, setInitialOwUserId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		fetchUserSettings()
			.then((data) => {
				const id = data.openwearables.owUserId ?? "";
				setSettings(data.openwearables);
				setOwUserId(id);
				setInitialOwUserId(id);
			})
			.catch((error) => {
				setSettings({ owUserId: null });
				setInitialOwUserId("");
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

	const isDirty = initialOwUserId !== null && owUserId !== initialOwUserId;

	const handleSave = async () => {
		setSaving(true);
		setNotification(null);
		try {
			const next = await updateOpenwearablesSettings({
				owUserId,
			});
			setSettings(next);
			setOwUserId(next.owUserId ?? "");
			setInitialOwUserId(next.owUserId ?? "");
			setNotification({
				type: "success",
				message: next.owUserId
					? "OpenWearables user ID saved."
					: "OpenWearables integration disabled.",
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
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 shrink-0">
						<Heart className="w-5 h-5 text-rose-300" />
					</div>
					<div>
						<p className="text-sm font-semibold text-[#f1f5f9]">
							OpenWearables
						</p>
						<p className="text-xs text-[#94a3b8]">
							Provide your OpenWearables user ID so the AI coach can access your
							RHR, sleep, and HRV data for smarter training advice.
						</p>
					</div>
					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{!loading && (
					<>
						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1]">
								User ID
							</span>
							<input
								type="text"
								value={owUserId}
								onChange={(event) => setOwUserId(event.target.value)}
								placeholder="Your OpenWearables user ID"
								className="px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
							/>
						</label>

						<div className="flex items-center justify-between gap-3 pt-1 border-t border-[rgba(139,92,246,0.1)]">
							<p className="text-xs text-[#94a3b8]">
								The API key and URL are configured on the server.
							</p>
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
