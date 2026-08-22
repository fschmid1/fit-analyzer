import { useEffect, useState } from "react";
import type {
	ZoneRange,
	ZonesResponse,
	ZoneOverride,
} from "@fit-analyzer/shared";
import {
	POWER_ZONE_BANDS,
	HR_ZONE_BANDS,
	formatZoneRange,
} from "@fit-analyzer/shared";
import {
	AlertCircle,
	CheckCircle2,
	Gauge,
	Loader2,
	RotateCcw,
} from "lucide-react";
import {
	fetchZones,
	resetZoneOverrides,
	updateZoneOverrides,
} from "../lib/api";
import {
	notifyProfileChanged,
	subscribeProfileChanged,
} from "../lib/profileStore";
import { AnimatedButton } from "./AnimatedButton";
import { SettingsCard } from "./SettingsCard";

interface DraftZone {
	name: string;
	lower: string;
	upper: string;
}

function toDraft(zones: ZoneRange[]): DraftZone[] {
	return zones.map((z) => ({
		name: z.name,
		lower: String(z.lower),
		upper: z.upper === Number.POSITIVE_INFINITY ? "" : String(z.upper),
	}));
}

function fromDraft(draft: DraftZone[]): ZoneOverride[] {
	return draft.map((z) => ({
		name: z.name,
		lower: Number(z.lower) || 0,
		upper: z.upper.trim() === "" ? Number.POSITIVE_INFINITY : Number(z.upper),
	}));
}

export function ZoneOverrideSettings() {
	const [zones, setZones] = useState<ZonesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [powerDraft, setPowerDraft] = useState<DraftZone[]>([]);
	const [hrDraft, setHrDraft] = useState<DraftZone[]>([]);
	const [saving, setSaving] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	const [version, setVersion] = useState(0);

	useEffect(() => {
		return subscribeProfileChanged(() => setVersion((v) => v + 1));
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: version is intentionally included to re-fetch on profile change notifications
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		(async () => {
			try {
				const data = await fetchZones();
				if (!cancelled) {
					setZones(data);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to load zones");
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [version]);

	useEffect(() => {
		if (!notification) return;
		const timeoutId = window.setTimeout(() => setNotification(null), 5000);
		return () => window.clearTimeout(timeoutId);
	}, [notification]);

	const hasOverrides =
		(zones?.powerZonesOverridden || zones?.hrZonesOverridden) ?? false;

	const startEditing = () => {
		if (!zones) return;
		setPowerDraft(toDraft(zones.powerZones));
		setHrDraft(toDraft(zones.hrZones));
		setEditing(true);
	};

	const cancelEditing = () => {
		setEditing(false);
		setPowerDraft([]);
		setHrDraft([]);
	};

	const handleSave = async () => {
		if (!zones) return;
		setSaving(true);
		setNotification(null);
		try {
			const next = await updateZoneOverrides({
				powerZones: fromDraft(powerDraft),
				hrZones: fromDraft(hrDraft),
			});
			setZones(next);
			setEditing(false);
			setNotification({ type: "success", message: "Custom zones saved." });
			notifyProfileChanged();
		} catch (err) {
			setNotification({
				type: "error",
				message: err instanceof Error ? err.message : "Failed to save zones",
			});
		} finally {
			setSaving(false);
		}
	};

	const handleReset = async () => {
		setSaving(true);
		setNotification(null);
		try {
			const next = await resetZoneOverrides();
			setZones(next);
			setEditing(false);
			setNotification({
				type: "success",
				message: "Zones reset to derived defaults.",
			});
			notifyProfileChanged();
		} catch (err) {
			setNotification({
				type: "error",
				message: err instanceof Error ? err.message : "Failed to reset zones",
			});
		} finally {
			setSaving(false);
		}
	};

	const cardError: string | null =
		error ?? (notification?.type === "error" ? notification.message : null);

	return (
		<div className="flex flex-col gap-4">
			{cardError && (
				<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400">
					<AlertCircle className="w-4 h-4 shrink-0" />
					{cardError}
				</div>
			)}
			{notification?.type === "success" && (
				<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
					<CheckCircle2 className="w-4 h-4 shrink-0" />
					{notification.message}
				</div>
			)}

			<SettingsCard
				icon={<Gauge className="w-5 h-5 text-[#a78bfa]" />}
				title="Zone overrides"
				subtitle="Custom power and heart-rate zone boundaries. Leave empty for derived defaults."
				loading={loading}
			>
				{!loading && zones && (
					<>
						{zones.source === "none" &&
							zones.powerZones.length === 0 &&
							zones.hrZones.length === 0 && (
								<p className="text-sm text-[#64748b]">
									Set FTP and max HR in your athlete profile to derive zones.
								</p>
							)}

						{editing ? (
							<div className="flex flex-col gap-4">
								<ZoneEditor
									title="Power zones (W)"
									draft={powerDraft}
									onChange={setPowerDraft}
								/>
								<ZoneEditor
									title="Heart rate zones (bpm)"
									draft={hrDraft}
									onChange={setHrDraft}
								/>
								<div className="flex items-center justify-end gap-2 pt-1 border-t border-[rgba(139,92,246,0.1)]">
									<button
										type="button"
										onClick={cancelEditing}
										className="px-3 py-1.5 text-xs text-[#94a3b8] hover:text-[#c4b5fd] rounded-lg hover:bg-[#241e3d] transition-colors cursor-pointer"
									>
										Cancel
									</button>
									<AnimatedButton
										onClick={handleSave}
										disabled={saving}
										className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{saving ? (
											<>
												<Loader2 className="w-4 h-4 animate-spin" />
												Saving…
											</>
										) : (
											"Save zones"
										)}
									</AnimatedButton>
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-4">
								<ZoneDisplay
									title="Power zones (W)"
									zones={zones.powerZones}
									bands={POWER_ZONE_BANDS}
									overridden={zones.powerZonesOverridden}
								/>
								<ZoneDisplay
									title="Heart rate zones (bpm)"
									zones={zones.hrZones}
									bands={HR_ZONE_BANDS}
									overridden={zones.hrZonesOverridden}
								/>
								<div className="flex items-center justify-end gap-2 pt-1 border-t border-[rgba(139,92,246,0.1)]">
									{hasOverrides && (
										<button
											type="button"
											onClick={handleReset}
											disabled={saving}
											className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
										>
											<RotateCcw className="w-3 h-3" />
											Reset to derived
										</button>
									)}
									<AnimatedButton
										onClick={startEditing}
										disabled={saving || zones.source === "none"}
										className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
									>
										Edit zones
									</AnimatedButton>
								</div>
							</div>
						)}
					</>
				)}
			</SettingsCard>
		</div>
	);
}

function ZoneDisplay({
	title,
	zones,
	bands,
	overridden,
}: {
	title: string;
	zones: ZoneRange[];
	bands: readonly { name: string }[];
	overridden: boolean;
}) {
	if (zones.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<span className="text-xs font-medium text-[#cbd5e1]">{title}</span>
				{overridden && (
					<span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
						Custom
					</span>
				)}
			</div>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
				{zones.map((z, i) => {
					const band = bands[i];
					return (
						<div key={z.name} className="flex items-center gap-1.5 text-[11px]">
							<span className="text-[#7c6fa0] truncate w-24">
								{band?.name ?? z.name}
							</span>
							<span className="text-[#c4b5fd] tabular-nums ml-auto whitespace-nowrap">
								{formatZoneRange(z, "")}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ZoneEditor({
	title,
	draft,
	onChange,
}: {
	title: string;
	draft: DraftZone[];
	onChange: (next: DraftZone[]) => void;
}) {
	if (draft.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium text-[#cbd5e1]">{title}</span>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
				{draft.map((z, i) => (
					<div key={z.name} className="flex items-center gap-1.5">
						<span className="text-[11px] text-[#7c6fa0] w-24 shrink-0 truncate">
							{z.name}
						</span>
						<input
							type="number"
							min={0}
							value={z.lower}
							onChange={(e) => {
								const next = [...draft];
								next[i] = { ...next[i], lower: e.target.value };
								onChange(next);
							}}
							placeholder="lower"
							className="w-16 px-2 py-1 text-[11px] bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40"
						/>
						<span className="text-[11px] text-[#4a4468]">–</span>
						<input
							type="number"
							min={0}
							value={z.upper}
							onChange={(e) => {
								const next = [...draft];
								next[i] = { ...next[i], upper: e.target.value };
								onChange(next);
							}}
							placeholder="∞"
							className="w-16 px-2 py-1 text-[11px] bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] rounded text-[#f1f5f9] placeholder-[#4a4468] outline-none focus:border-[#8b5cf6]/40"
						/>
					</div>
				))}
			</div>
		</div>
	);
}
