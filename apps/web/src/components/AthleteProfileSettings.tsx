import { useEffect, useState } from "react";
import type { AthleteProfile } from "@fit-analyzer/shared";
import {
	AlertCircle,
	CheckCircle2,
	Flame,
	Heart,
	Calendar,
	Clock,
	Target,
	Loader2,
	MapPin,
} from "lucide-react";
import { fetchAthleteEstimates, updateAthleteProfile } from "../lib/api";
import { useSettings } from "../lib/settingsContext";
import { AnimatedButton } from "./AnimatedButton";
import { SettingsCard } from "./SettingsCard";

const FOCUS_OPTIONS = [
	"endurance",
	"threshold",
	"vo2max",
	"sprint",
	"climbing",
	"time-trial",
	"recovery",
];

const DEFAULT_PROFILE: AthleteProfile = {
	ftp: null,
	maxHr: null,
	goalEventDate: null,
	goalEventName: null,
	goalDescription: null,
	weeklyHours: null,
	focusAreas: [],
	location: null,
};

export function AthleteProfileSettings() {
	const { data, loading, error } = useSettings();
	const [estimates, setEstimates] = useState<{
		ftp: number | null;
		maxHr: number | null;
	}>({ ftp: null, maxHr: null });
	const [inferredLocation, setInferredLocation] = useState<string | null>(null);
	const [estimatesLoading, setEstimatesLoading] = useState(true);
	const [estimatesError, setEstimatesError] = useState<Error | null>(null);

	const [profile, setProfile] = useState<AthleteProfile>(DEFAULT_PROFILE);
	const [draft, setDraft] = useState<AthleteProfile>(DEFAULT_PROFILE);
	const [saving, setSaving] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		fetchAthleteEstimates()
			.then((e) => {
				setEstimates({
					ftp: e.estimatedFtp ?? null,
					maxHr: e.estimatedMaxHr ?? null,
				});
				setInferredLocation(e.inferredLocation ?? null);
			})
			.catch(setEstimatesError)
			.finally(() => setEstimatesLoading(false));
	}, []);

	useEffect(() => {
		if (!data) return;
		const p = data.athleteProfile ?? DEFAULT_PROFILE;
		setProfile(p);
		setDraft({
			...p,
			ftp: p.ftp ?? estimates.ftp,
			maxHr: p.maxHr ?? estimates.maxHr,
			location: p.location ?? inferredLocation ?? null,
		});
	}, [data, estimates, inferredLocation]);

	useEffect(() => {
		if (!notification) return;
		const timeoutId = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(timeoutId);
	}, [notification]);

	const isDirty =
		draft.ftp !== profile.ftp ||
		draft.maxHr !== profile.maxHr ||
		draft.goalEventDate !== profile.goalEventDate ||
		draft.goalEventName !== profile.goalEventName ||
		draft.goalDescription !== profile.goalDescription ||
		draft.weeklyHours !== profile.weeklyHours ||
		draft.focusAreas.length !== profile.focusAreas.length ||
		!draft.focusAreas.every((f) => profile.focusAreas.includes(f)) ||
		draft.location !== profile.location;

	const handleSave = async () => {
		setSaving(true);
		setNotification(null);
		try {
			const next = await updateAthleteProfile({
				ftp: draft.ftp,
				maxHr: draft.maxHr,
				goalEventDate: draft.goalEventDate,
				goalEventName: draft.goalEventName,
				goalDescription: draft.goalDescription,
				weeklyHours: draft.weeklyHours,
				focusAreas: draft.focusAreas,
				location: draft.location,
			});
			setProfile(next);
			setDraft(next);
			setInferredLocation(null);
			setNotification({ type: "success", message: "Athlete profile updated." });
		} catch (error) {
			setNotification({
				type: "error",
				message:
					error instanceof Error ? error.message : "Failed to save profile",
			});
		} finally {
			setSaving(false);
		}
	};

	const toggleFocus = (area: string) => {
		setDraft((prev) => ({
			...prev,
			focusAreas: prev.focusAreas.includes(area)
				? prev.focusAreas.filter((f) => f !== area)
				: [...prev.focusAreas, area],
		}));
	};

	const cardError =
		error ??
		estimatesError ??
		(notification?.type === "error" ? notification : null);

	return (
		<div className="flex flex-col gap-4">
			{cardError && (
				<div
					className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
						"message" in cardError
							? "bg-red-500/10 border border-red-500/20 text-red-400"
							: "bg-red-500/10 border border-red-500/20 text-red-400"
					}`}
				>
					<AlertCircle className="w-4 h-4 shrink-0" />
					{"message" in cardError
						? cardError.message
						: "Failed to load profile"}
				</div>
			)}
			{notification?.type === "success" && (
				<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
					<CheckCircle2 className="w-4 h-4 shrink-0" />
					{notification.message}
				</div>
			)}

			<SettingsCard
				icon={<Target className="w-5 h-5 text-[#a78bfa]" />}
				title="Athlete profile"
				subtitle="Set your goals and metrics. The coach uses these to personalize advice."
				loading={loading || estimatesLoading}
			>
				{!loading && !estimatesLoading && (
					<>
						<div className="grid grid-cols-2 gap-3">
							<div className="flex flex-col gap-1.5">
								<span className="flex items-center gap-1.5 text-xs font-medium text-[#cbd5e1]">
									<Flame className="w-3 h-3 text-[#8b5cf6]" />
									FTP (W)
								</span>
								<input
									type="number"
									min={0}
									value={draft.ftp ?? ""}
									onChange={(e) =>
										setDraft((prev) => ({
											...prev,
											ftp: e.target.value ? Number(e.target.value) : null,
										}))
									}
									placeholder={
										estimates.ftp != null
											? `${estimates.ftp} (estimated)`
											: "e.g. 265"
									}
									className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors"
								/>
								{profile.ftp == null &&
									estimates.ftp != null &&
									draft.ftp === estimates.ftp && (
										<span className="text-[10px] text-[#64748b]">
											Auto-filled from activity data
										</span>
									)}
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="flex items-center gap-1.5 text-xs font-medium text-[#cbd5e1]">
									<Heart className="w-3 h-3 text-[#ef4444]" />
									Max HR (bpm)
								</span>
								<input
									type="number"
									min={0}
									value={draft.maxHr ?? ""}
									onChange={(e) =>
										setDraft((prev) => ({
											...prev,
											maxHr: e.target.value ? Number(e.target.value) : null,
										}))
									}
									placeholder={
										estimates.maxHr != null
											? `${estimates.maxHr} (estimated)`
											: "e.g. 188"
									}
									className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors"
								/>
								{profile.maxHr == null &&
									estimates.maxHr != null &&
									draft.maxHr === estimates.maxHr && (
										<span className="text-[10px] text-[#64748b]">
											Auto-filled from activity data
										</span>
									)}
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="flex items-center gap-1.5 text-xs font-medium text-[#cbd5e1]">
									<Clock className="w-3 h-3 text-[#06b6d4]" />
									Hours/week
								</span>
								<input
									type="number"
									min={0}
									step={0.5}
									value={draft.weeklyHours ?? ""}
									onChange={(e) =>
										setDraft((prev) => ({
											...prev,
											weeklyHours: e.target.value
												? Number(e.target.value)
												: null,
										}))
									}
									placeholder="e.g. 8"
									className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors"
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="flex items-center gap-1.5 text-xs font-medium text-[#cbd5e1]">
									<Calendar className="w-3 h-3 text-[#2dd4bf]" />
									Goal event date
								</span>
								<input
									type="date"
									value={draft.goalEventDate ?? ""}
									onChange={(e) =>
										setDraft((prev) => ({
											...prev,
											goalEventDate: e.target.value || null,
										}))
									}
									className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors [color-scheme:dark]"
								/>
							</div>
						</div>

						<div className="flex flex-col gap-1.5">
							<span className="flex items-center gap-1.5 text-xs font-medium text-[#cbd5e1]">
								<MapPin className="w-3 h-3 text-[#f59e0b]" />
								Location
							</span>
							<input
								type="text"
								value={draft.location ?? ""}
								onChange={(e) =>
									setDraft((prev) => ({
										...prev,
										location: e.target.value || null,
									}))
								}
								placeholder="e.g. Boulder, CO"
								className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors"
							/>
							{profile.location == null && inferredLocation && (
								<div className="flex items-center justify-between gap-2">
									<span className="text-[10px] text-[#64748b]">
										Inferred: {inferredLocation}
									</span>
									<button
										type="button"
										onClick={() =>
											setDraft((prev) => ({
												...prev,
												location: inferredLocation,
											}))
										}
										className="text-[10px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors cursor-pointer"
									>
										Use inferred location
									</button>
								</div>
							)}
						</div>

						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1]">
								Goal event name
							</span>
							<input
								type="text"
								value={draft.goalEventName ?? ""}
								onChange={(e) =>
									setDraft((prev) => ({
										...prev,
										goalEventName: e.target.value || null,
									}))
								}
								placeholder="e.g. Gran Fondo Whistler"
								className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors"
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1]">
								Goal description
							</span>
							<input
								type="text"
								value={draft.goalDescription ?? ""}
								onChange={(e) =>
									setDraft((prev) => ({
										...prev,
										goalDescription: e.target.value || null,
									}))
								}
								placeholder="e.g. Complete in under 5 hours"
								className="w-full px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded-lg text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40 transition-colors"
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-[#cbd5e1]">
								Focus areas
							</span>
							<div className="flex flex-wrap gap-1.5">
								{FOCUS_OPTIONS.map((area) => {
									const active = draft.focusAreas.includes(area);
									return (
										<button
											key={area}
											type="button"
											onClick={() => toggleFocus(area)}
											className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all duration-200 cursor-pointer ${
												active
													? "bg-[#8b5cf6]/20 border-[#8b5cf6]/40 text-[#c4b5fd]"
													: "bg-[#0f0b1a] border-[rgba(139,92,246,0.15)] text-[#7c6fa0] hover:border-[rgba(139,92,246,0.3)] hover:text-[#94a3b8]"
											}`}
										>
											{area}
										</button>
									);
								})}
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
					</>
				)}
			</SettingsCard>
		</div>
	);
}
