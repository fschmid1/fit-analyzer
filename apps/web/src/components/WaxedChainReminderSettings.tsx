import { useEffect, useState } from "react";
import { AlertCircle, BellRing, CheckCircle2, Loader2 } from "lucide-react";
import type { WaxedChainReminderSettings as WaxedChainReminderSettingsData } from "@fit-analyzer/shared";
import {
	fetchUserSettings,
	resetWaxedChainReminderProgress,
	sendWaxedChainReminderTest,
	updateWaxedChainReminderSettings,
} from "../lib/api";

function formatLastNotifiedAt(value: string | null): string {
	if (!value) return "No reminder sent yet";

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "No reminder sent yet";

	return `Last reminder sent ${date.toLocaleString()}`;
}

export function WaxedChainReminderSettings() {
	const [settings, setSettings] =
		useState<WaxedChainReminderSettingsData | null>(null);
	const [enabled, setEnabled] = useState(false);
	const [thresholdKm, setThresholdKm] = useState("300");
	const [ntfyTopic, setNtfyTopic] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [sendingTest, setSendingTest] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		fetchUserSettings()
			.then((data) => {
				setSettings(data.waxedChainReminder);
				setEnabled(data.waxedChainReminder.enabled);
				setThresholdKm(String(data.waxedChainReminder.thresholdKm));
				setNtfyTopic(data.waxedChainReminder.ntfyTopic);
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

	const handleSave = async () => {
		const parsedThresholdKm = Number(thresholdKm);

		setSaving(true);
		setNotification(null);

		try {
			const nextSettings = await updateWaxedChainReminderSettings({
				enabled,
				thresholdKm: parsedThresholdKm,
				ntfyTopic,
			});

			setSettings(nextSettings);
			setEnabled(nextSettings.enabled);
			setThresholdKm(String(nextSettings.thresholdKm));
			setNtfyTopic(nextSettings.ntfyTopic);
			setNotification({
				type: "success",
				message: "Waxed chain reminders updated.",
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

	const handleReset = async () => {
		setResetting(true);
		setNotification(null);

		try {
			const nextSettings = await resetWaxedChainReminderProgress();
			setSettings(nextSettings);
			setNotification({
				type: "success",
				message: "Waxed chain reminder progress reset.",
			});
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error
						? error.message
						: "Failed to reset reminder progress",
			});
		} finally {
			setResetting(false);
		}
	};

	const handleSendTest = async () => {
		setSendingTest(true);
		setNotification(null);

		try {
			await sendWaxedChainReminderTest();
			setNotification({
				type: "success",
				message: "Test notification sent.",
			});
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error
						? error.message
						: "Failed to send test notification",
			});
		} finally {
			setSendingTest(false);
		}
	};

	const thresholdValue = Number(thresholdKm);
	const isThresholdValid =
		Number.isFinite(thresholdValue) && thresholdValue > 0;
	const isSaveDisabled =
		saving ||
		resetting ||
		sendingTest ||
		!isThresholdValid ||
		(enabled && ntfyTopic.trim().length === 0);
	const isResetDisabled =
		resetting ||
		saving ||
		sendingTest ||
		!settings ||
		settings.accumulatedKm <= 0;
	const isSendTestDisabled =
		sendingTest || saving || resetting || !ntfyTopic.trim();

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
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 shrink-0">
						<BellRing className="w-5 h-5 text-amber-300" />
					</div>
					<div>
						<p className="text-sm font-semibold text-[#f1f5f9]">
							Waxed chain reminders
						</p>
						<p className="text-xs text-[#94a3b8]">
							Send an `ntfy` notification when newly added rides cross your
							maintenance threshold.
						</p>
					</div>
					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{!loading && (
					<>
						<div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(139,92,246,0.12)] bg-[#0f0b1a]/70 px-4 py-3">
							<div id="waxed-chain-reminders-label">
								<p className="text-sm font-medium text-[#f1f5f9]">
									Enable reminders
								</p>
								<p className="text-xs text-[#94a3b8] mt-0.5">
									Track distance from newly imported or uploaded activities.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={enabled}
								aria-labelledby="waxed-chain-reminders-label"
								onClick={() => setEnabled((value) => !value)}
								className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 cursor-pointer ${
									enabled ? "bg-emerald-500/70" : "bg-[#241b3d]"
								}`}
							>
								<span
									className={`inline-block h-5 w-5 rounded-full bg-white transition-transform duration-200 ${
										enabled ? "translate-x-6" : "translate-x-1"
									}`}
								/>
							</button>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<label className="flex flex-col gap-1.5">
								<span className="text-xs font-medium text-[#cbd5e1]">
									Reminder after km
								</span>
								<input
									type="number"
									min="1"
									step="1"
									value={thresholdKm}
									onChange={(event) => setThresholdKm(event.target.value)}
									className="px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
								/>
							</label>

							<label className="flex flex-col gap-1.5">
								<span className="text-xs font-medium text-[#cbd5e1]">
									`ntfy` topic
								</span>
								<input
									type="text"
									value={ntfyTopic}
									onChange={(event) => setNtfyTopic(event.target.value)}
									placeholder="bike-maintenance"
									className="px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
								/>
							</label>
						</div>

						{settings && (
							<div className="rounded-xl border border-[rgba(139,92,246,0.12)] bg-[#0f0b1a]/70 px-4 py-3 text-xs text-[#94a3b8] flex flex-col gap-1">
								<p>
									{settings.accumulatedKm.toFixed(1)} km tracked toward the next
									reminder. {settings.remainingKm.toFixed(1)} km remaining.
								</p>
								<p>{formatLastNotifiedAt(settings.lastNotifiedAt)}</p>
							</div>
						)}

						<div className="flex items-center justify-between gap-3 pt-1 border-t border-[rgba(139,92,246,0.1)]">
							<p className="text-xs text-[#94a3b8]">
								The `ntfy` host and token are read from the server environment.
							</p>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleSendTest}
									disabled={isSendTestDisabled}
									className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{sendingTest ? (
										<>
											<Loader2 className="w-4 h-4 animate-spin" />
											Sending…
										</>
									) : (
										"Send test"
									)}
								</button>
								<button
									type="button"
									onClick={handleReset}
									disabled={isResetDisabled}
									className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#94a3b8] bg-transparent hover:bg-red-500/10 border border-[rgba(139,92,246,0.15)] hover:border-red-500/30 rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{resetting ? (
										<>
											<Loader2 className="w-4 h-4 animate-spin" />
											Resetting…
										</>
									) : (
										"Reset counter"
									)}
								</button>
								<button
									type="button"
									onClick={handleSave}
									disabled={isSaveDisabled}
									className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{saving ? (
										<>
											<Loader2 className="w-4 h-4 animate-spin" />
											Saving…
										</>
									) : (
										"Save"
									)}
								</button>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
