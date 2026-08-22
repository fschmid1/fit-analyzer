import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { ProfileChangeEntry } from "@fit-analyzer/shared";
import { PROFILE_CHANGE_SOURCE_LABELS } from "@fit-analyzer/shared";
import { fetchProfileChanges } from "../lib/api";
import { subscribeProfileChanged } from "../lib/profileStore";
import { SettingsCard } from "./SettingsCard";

function formatValue(v: unknown): string {
	if (v == null) return "—";
	if (typeof v === "number") return String(v);
	if (typeof v === "string") return v || "—";
	if (Array.isArray(v)) return `[${v.length} items]`;
	return JSON.stringify(v);
}

function formatField(field: string): string {
	const labels: Record<string, string> = {
		ftp: "FTP",
		maxHr: "Max HR",
		goalEventDate: "Goal date",
		goalEventName: "Goal event",
		goalDescription: "Goal",
		weeklyHours: "Hours/week",
		focusAreas: "Focus areas",
		location: "Location",
		powerZones: "Power zones",
		hrZones: "HR zones",
	};
	return labels[field] ?? field;
}

function sourceLabel(source: string): string {
	return (
		PROFILE_CHANGE_SOURCE_LABELS[
			source as keyof typeof PROFILE_CHANGE_SOURCE_LABELS
		] ?? source
	);
}

export function ProfileChangelogCard() {
	const [entries, setEntries] = useState<ProfileChangeEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [version, setVersion] = useState(0);

	useEffect(() => {
		return subscribeProfileChanged(() => setVersion((v) => v + 1));
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: version is intentionally included to re-fetch on profile change notifications
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const data = await fetchProfileChanges();
				if (!cancelled) setEntries(data);
			} catch {
				/* swallow — non-critical */
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [version]);

	const recent = entries.slice(0, 10);

	return (
		<SettingsCard
			icon={<History className="w-5 h-5 text-[#a78bfa]" />}
			title="Change history"
			subtitle="Recent profile and zone updates by you or the trainer."
			loading={loading}
		>
			{!loading && recent.length === 0 && (
				<p className="text-sm text-[#64748b]">No changes yet.</p>
			)}
			{recent.length > 0 && (
				<div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
					{recent.map((entry) => {
						const fields = Object.keys(entry.changes);
						return (
							<div
								key={entry.id}
								className="flex flex-col gap-1 px-3 py-2 bg-[#0f0b1a]/60 rounded-lg border border-[rgba(139,92,246,0.1)]"
							>
								<div className="flex items-center gap-2 text-[10px] text-[#64748b]">
									<span className="text-[#94a3b8] font-medium">
										{sourceLabel(entry.source)}
									</span>
									<span>·</span>
									<span>
										{new Date(entry.createdAt).toLocaleString(undefined, {
											month: "short",
											day: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
								</div>
								{fields.map((field) => {
									const change = entry.changes[field];
									return (
										<div
											key={field}
											className="flex items-center gap-2 text-[11px]"
										>
											<span className="text-[#7c6fa0] w-20 shrink-0 truncate">
												{formatField(field)}
											</span>
											<span className="text-[#94a3b8] tabular-nums">
												{formatValue(change.old)}
											</span>
											<span className="text-[#4a4468]">→</span>
											<span className="text-[#c4b5fd] tabular-nums">
												{formatValue(change.new)}
											</span>
										</div>
									);
								})}
							</div>
						);
					})}
				</div>
			)}
		</SettingsCard>
	);
}
