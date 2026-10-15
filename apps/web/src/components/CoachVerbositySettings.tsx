import {
	COACH_VERBOSITIES,
	COACH_VERBOSITY_BLURBS,
	COACH_VERBOSITY_LABELS,
	type CoachVerbosity,
	DEFAULT_COACH_VERBOSITY,
} from "@fit-analyzer/shared";
import {
	AlertCircle,
	CheckCircle2,
	Loader2,
	MessageSquareText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { updateCoachVerbosity } from "../lib/api";
import { useSettings } from "../lib/settingsContext";
import { AnimatedButton } from "./AnimatedButton";
import { SettingsCard } from "./SettingsCard";

/** The athlete's Verbosity mode — how much detail every coach reply carries. */
export function CoachVerbositySettings() {
	const { data, loading, error, refresh } = useSettings();
	const [selected, setSelected] = useState<CoachVerbosity>(
		DEFAULT_COACH_VERBOSITY,
	);
	const [saving, setSaving] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		if (data) setSelected(data.coachVerbosity);
	}, [data]);

	useEffect(() => {
		if (!notification) return;
		const timeoutId = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(timeoutId);
	}, [notification]);

	const current = data?.coachVerbosity;
	const isDirty = current !== undefined && selected !== current;

	const handleSave = async () => {
		setSaving(true);
		setNotification(null);
		try {
			const next = await updateCoachVerbosity({ verbosity: selected });
			setSelected(next);
			refresh();
			setNotification({
				type: "success",
				message: "Coach verbosity updated.",
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
				icon={<MessageSquareText className="w-5 h-5 text-[#a78bfa]" />}
				title="Coach verbosity"
				subtitle="How much detail the coach writes in every reply."
				loading={loading}
			>
				<div className="flex flex-col gap-2">
					{COACH_VERBOSITIES.map((verbosity) => {
						const active = verbosity === selected;
						return (
							<button
								key={verbosity}
								type="button"
								aria-pressed={active}
								onClick={() => setSelected(verbosity)}
								className={`text-left px-3 py-2.5 rounded-xl border transition-[color,background-color,border-color] duration-200 cursor-pointer ${
									active
										? "bg-[#8b5cf6]/10 border-[#8b5cf6]/40"
										: "border-[rgba(139,92,246,0.15)] hover:border-[#8b5cf6]/25 hover:bg-[#8b5cf6]/5"
								}`}
							>
								<span
									className={`block text-sm font-medium ${
										active ? "text-[#c4b5fd]" : "text-[#cbd5e1]"
									}`}
								>
									{COACH_VERBOSITY_LABELS[verbosity]}
								</span>
								<span className="block text-xs text-[#64748b] mt-0.5">
									{COACH_VERBOSITY_BLURBS[verbosity]}
								</span>
							</button>
						);
					})}
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
			</SettingsCard>
		</div>
	);
}
