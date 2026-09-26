import { useEffect, useState } from "react";
import {
	AlertCircle,
	BellRing,
	CalendarClock,
	CheckCircle2,
	Loader2,
} from "lucide-react";
import type { PlanRefreshSettings } from "@fit-analyzer/shared";
import {
	fetchGoogleCalendarStatus,
	updateNtfyTopic,
	updatePlanRefreshSettings,
} from "../lib/api";
import { useSettings } from "../lib/settingsContext";
import { AnimatedButton } from "./AnimatedButton";
import { SettingsCard } from "./SettingsCard";

/** Human-readable label for a Refresh watermark status. */
function statusLabel(settings: PlanRefreshSettings): string {
	switch (settings.lastStatus) {
		case "success":
			return settings.refreshedAt
				? `Last refresh succeeded ${new Date(settings.refreshedAt).toLocaleString()}`
				: "Last refresh succeeded";
		case "error":
			return settings.lastError
				? `Last refresh failed: ${settings.lastError}`
				: "Last refresh failed";
		default:
			return "No refresh has run yet";
	}
}

export function PlanRefreshSettingsCard() {
	const { data, loading, error } = useSettings();
	const [settings, setSettings] = useState<PlanRefreshSettings | null>(null);
	const [enabled, setEnabled] = useState(false);
	const [ntfyTopic, setNtfyTopic] = useState("");
	const [topicSaving, setTopicSaving] = useState(false);
	const [calendarConnected, setCalendarConnected] = useState<boolean | null>(
		null,
	);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		if (!data) return;
		setSettings(data.planRefresh);
		setEnabled(data.planRefresh.enabled);
		setNtfyTopic(data.waxedChainReminder.ntfyTopic);
	}, [data]);

	useEffect(() => {
		fetchGoogleCalendarStatus()
			.then((s) => setCalendarConnected(s.connected))
			.catch(() => setCalendarConnected(false));
	}, []);

	useEffect(() => {
		if (!notification) return;
		const id = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(id);
	}, [notification]);

	const handleToggle = async (next: boolean) => {
		setNotification(null);
		try {
			const updated = await updatePlanRefreshSettings({ enabled: next });
			setSettings(updated);
			setEnabled(updated.enabled);
			setNotification({
				type: "success",
				message: next
					? "Weekly plan refresh enabled."
					: "Weekly plan refresh disabled.",
			});
		} catch (err) {
			setEnabled(!next); // revert optimistic toggle
			setNotification({
				type: "error",
				message: err instanceof Error ? err.message : "Failed to save setting",
			});
		}
	};

	const handleTopicSave = async () => {
		setTopicSaving(true);
		setNotification(null);
		try {
			const topic = await updateNtfyTopic(ntfyTopic);
			setNtfyTopic(topic);
			setNotification({
				type: "success",
				message: "Notification topic updated.",
			});
		} catch (err) {
			setNotification({
				type: "error",
				message: err instanceof Error ? err.message : "Failed to update topic",
			});
		} finally {
			setTopicSaving(false);
		}
	};

	const canEnable = calendarConnected === true;
	const toggleDisabled =
		loading || calendarConnected === null || (!enabled && !canEnable);

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
				icon={<CalendarClock className="w-5 h-5 text-[#8b5cf6]" />}
				title="Weekly plan refresh"
				subtitle="Refresh the coach's training plan every week on Sunday evening, and notify you when a new plan lands."
				loading={loading}
			>
				{!loading && (
					<>
						<div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(139,92,246,0.12)] bg-[#0f0b1a]/70 px-4 py-3">
							<div id="plan-refresh-label">
								<p className="text-sm font-medium text-[#f1f5f9]">
									Enable weekly refresh
								</p>
								<p className="text-xs text-[#94a3b8] mt-0.5">
									{calendarConnected === false
										? "Connect a Training calendar first."
										: "Runs automatically each Sunday evening in your training timezone."}
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={enabled}
								aria-labelledby="plan-refresh-label"
								disabled={toggleDisabled}
								onClick={() => handleToggle(!enabled)}
								className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 shrink-0 ${
									toggleDisabled
										? "opacity-50 cursor-not-allowed"
										: "cursor-pointer"
								} ${enabled ? "bg-emerald-500/70" : "bg-[#241b3d]"}`}
							>
								<span
									className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
										enabled ? "translate-x-6" : "translate-x-1"
									}`}
								/>
							</button>
						</div>

						<label className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1] flex items-center gap-1.5">
								<BellRing className="w-3.5 h-3.5 text-amber-300" />
								ntfy topic
							</span>
							<div className="flex items-center gap-2">
								<input
									type="text"
									value={ntfyTopic}
									onChange={(event) => setNtfyTopic(event.target.value)}
									placeholder="training-plan"
									className="flex-1 px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
								/>
								<AnimatedButton
									onClick={handleTopicSave}
									disabled={topicSaving}
									className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{topicSaving ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										"Save"
									)}
								</AnimatedButton>
							</div>
							<span className="text-xs text-[#94a3b8]">
								Shared with waxed-chain reminders — one topic per user.
							</span>
						</label>

						{settings && (
							<div className="rounded-xl border border-[rgba(139,92,246,0.12)] bg-[#0f0b1a]/70 px-4 py-3 text-xs text-[#94a3b8] flex flex-col gap-1">
								<p>
									{settings.refreshedWeek
										? `Last refreshed week: ${settings.refreshedWeek}.`
										: "No week refreshed yet."}
								</p>
								<p
									className={
										settings.lastStatus === "error" ? "text-red-400" : undefined
									}
								>
									{statusLabel(settings)}
								</p>
							</div>
						)}
					</>
				)}
			</SettingsCard>
		</div>
	);
}
