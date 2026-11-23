import {
	DEFAULT_COACH_INSTRUCTIONS,
	MAX_COACH_INSTRUCTIONS_LENGTH,
} from "@fit-analyzer/shared";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { updateCoachInstructions } from "../lib/api";
import { useSettings } from "../lib/settingsContext";
import { SettingsCard } from "./SettingsCard";
import { AnimatedButton } from "./AnimatedButton";
import {
	SettingsBanner,
	useAutoNotification,
} from "../pages/settings/settingsShared";

const fieldClass =
	"w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors resize-y";

/** The athlete's own standing instructions, appended to every coach prompt. */
export function CoachInstructionsSettings() {
	const { data, loading, error, refresh } = useSettings();
	const [selected, setSelected] = useState<string>(DEFAULT_COACH_INSTRUCTIONS);
	const [saving, setSaving] = useState(false);
	const [notification, showNotification] = useAutoNotification();

	useEffect(() => {
		if (data) setSelected(data.coachInstructions);
	}, [data]);

	const current = data?.coachInstructions;
	const isDirty = current !== undefined && selected.trim() !== current;

	const handleSave = async () => {
		setSaving(true);
		showNotification(null);
		try {
			const next = await updateCoachInstructions({ instructions: selected });
			setSelected(next);
			refresh();
			showNotification({
				type: "success",
				message: "Coach instructions updated.",
			});
		} catch (error) {
			showNotification({
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
				<SettingsBanner
					notification={{ type: "error", message: error.message }}
				/>
			)}
			{notification?.type === "error" && !error && (
				<SettingsBanner notification={notification} />
			)}
			{notification?.type === "success" && (
				<SettingsBanner notification={notification} />
			)}

			<SettingsCard
				icon={<Sparkles className="w-5 h-5 text-[#a78bfa]" />}
				title="Coach instructions"
				subtitle="Your own standing instructions, appended to the coach's prompt."
				loading={loading}
			>
				<div className="flex flex-col gap-1.5">
					<label
						htmlFor="coach-instructions"
						className="text-xs font-medium text-[#cbd5e1]"
					>
						How should the coach fine-tune its answers?
					</label>
					<textarea
						id="coach-instructions"
						rows={5}
						value={selected}
						maxLength={MAX_COACH_INSTRUCTIONS_LENGTH}
						onChange={(event) => setSelected(event.target.value)}
						placeholder="e.g. Always mention how a session affects my goal event. Assume I train indoors on weekdays. Explain any acronym the first time you use it."
						className={fieldClass}
					/>
					<div className="flex items-start justify-between gap-3">
						<p className="text-[11px] text-[#64748b]">
							Applies to trainer chat, ride analysis and the weekly plan
							refresh. Verbosity still sets how long replies are.
						</p>
						<span className="shrink-0 text-[11px] font-mono text-[#4a4468]">
							{selected.length}/{MAX_COACH_INSTRUCTIONS_LENGTH}
						</span>
					</div>
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
