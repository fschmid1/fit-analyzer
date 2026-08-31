import { useEffect, useState } from "react";
import { Activity, ChevronRight } from "lucide-react";
import type { SettingsDomainId } from "./integrationsStatus";
import {
	ledFrom,
	useIntegrationsStatus,
	type LedState,
	type SettingsDomainId as DomainId,
} from "./integrationsStatus";
import { SETTINGS_DOMAINS } from "./domains";
import { SettingsBanner, useAutoNotification } from "./settingsShared";
import { useSettings } from "../../lib/settingsContext";

function Led({ state }: { state: LedState }) {
	const color =
		state === "ok"
			? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
			: state === "attention"
				? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]"
				: "bg-[#322b52]";
	return (
		<span
			aria-hidden="true"
			className={`inline-block w-2 h-2 rounded-full shrink-0 ${color} transition-colors`}
		/>
	);
}

function LedLabel({ state }: { state: LedState }) {
	if (state === "ok")
		return <span className="text-emerald-400">Connected</span>;
	if (state === "attention")
		return <span className="text-amber-400">Action needed</span>;
	if (state === "off") return <span className="text-[#64748b]">Off</span>;
	return <span className="text-[#4a4468]">…</span>;
}

interface RailItem {
	id: DomainId;
	name: string;
	state: LedState;
	detail: string;
}

/**
 * Desktop layout — LED status rail on the left, one section at a time on
 * the right. Hidden below xl where the Systems Board rows take over.
 */
export function HeadUnitVariant({
	renderDomain,
}: {
	renderDomain: (id: SettingsDomainId, dense?: boolean) => React.ReactNode;
}) {
	const { strava, wahoo, calendar, hae, flash } = useIntegrationsStatus();
	const { data } = useSettings();
	const [active, setActive] = useState<DomainId>("profile");
	const [notification, showNotification] = useAutoNotification();

	const waxed = data?.waxedChainReminder;
	const profile = data?.athleteProfile;
	const domain = SETTINGS_DOMAINS.find((d) => d.id === active);
	const items: RailItem[] = [
		{
			id: "strava",
			name: "Strava",
			state: ledFrom(strava?.connected ?? null),
			detail: strava?.connected
				? `Athlete #${strava.athleteId ?? "?"}`
				: "Not connected",
		},
		{
			id: "wahoo",
			name: "Wahoo",
			state: ledFrom(wahoo?.connected ?? null),
			detail: wahoo?.connected
				? `User #${wahoo.wahooUserId ?? "?"}`
				: "Not connected",
		},
		{
			id: "calendar",
			name: "Calendar",
			state: ledFrom(calendar?.connected ?? null),
			detail: calendar?.connected
				? (calendar.timezone ?? "Connected")
				: "Not connected",
		},
		{
			id: "openwearables",
			name: "OpenWearables",
			state: ledFrom((data?.openwearables.owUserId ?? null) !== null),
			detail: data?.openwearables.owUserId ? "User ID set" : "No user ID",
		},
		{
			id: "hae",
			name: "Health export",
			state: ledFrom(hae?.configured ?? null),
			detail: hae?.lastSyncAt
				? new Date(hae.lastSyncAt).toLocaleString(undefined, {
						month: "short",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					})
				: "No sync yet",
		},
		{
			id: "profile",
			name: "Athlete profile",
			state: ledFrom(profile?.ftp != null && profile?.maxHr != null),
			detail:
				profile?.ftp != null ? `${profile.ftp} W · goal set` : "FTP missing",
		},
		{
			id: "zones",
			name: "Zones",
			state: "ok",
			detail: "Power + HR",
		},
		{
			id: "coachModel",
			name: "Coach model",
			state: ledFrom(data?.coachModel.coachModel != null),
			detail: data?.coachModel.coachModel ?? "Default model",
		},
		{
			id: "waxed",
			name: "Chain reminder",
			state: ledFrom(waxed?.enabled ?? null),
			detail: waxed?.enabled ? `Every ${waxed.thresholdKm} km` : "Disabled",
		},
		{ id: "changelog", name: "History", state: "ok", detail: "Last 10 edits" },
	];

	const groups: { title: string; ids: DomainId[] }[] = [
		{
			title: "Integrations",
			ids: ["strava", "wahoo", "calendar", "openwearables", "hae"],
		},
		{ title: "Coach", ids: ["profile", "zones", "coachModel"] },
		{ title: "Maintenance", ids: ["waxed", "changelog"] },
	];

	return (
		<div className="hidden xl:flex flex-row gap-4 items-start">
			{/* Rail */}
			<nav
				aria-label="Settings sections"
				className="w-60 shrink-0 sticky top-2 rounded-2xl border border-[rgba(139,92,246,0.15)] bg-[#160f2b]/80 overflow-hidden"
			>
				<div className="px-4 pt-4 pb-2 flex items-center gap-2">
					<Activity className="w-3.5 h-3.5 text-[#8b5cf6]" aria-hidden="true" />
					<span className="text-[10px] uppercase tracking-[0.18em] text-[#7c6fa0]">
						System status
					</span>
				</div>
				{groups.map((group) => (
					<div key={group.title} className="pb-1">
						<p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4a4468]">
							{group.title}
						</p>
						{group.ids.map((id) => {
							const item = items.find((i) => i.id === id);
							if (!item) return null;
							const selected = id === active;
							return (
								<button
									key={id}
									type="button"
									onClick={() => setActive(id)}
									aria-current={selected ? "page" : undefined}
									className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors cursor-pointer ${
										selected
											? "bg-[#8b5cf6]/10 text-[#f1f5f9]"
											: "text-[#94a3b8] hover:bg-[#8b5cf6]/5"
									}`}
								>
									<Led state={item.state} />
									<span className="min-w-0 flex-1">
										<span className="block text-sm font-medium truncate">
											{item.name}
										</span>
										<span className="block text-[10px] font-mono text-[#4a4468] truncate">
											{item.detail}
										</span>
									</span>
									{selected && (
										<ChevronRight
											className="w-3.5 h-3.5 text-[#8b5cf6] shrink-0"
											aria-hidden="true"
										/>
									)}
								</button>
							);
						})}
					</div>
				))}
			</nav>

			{/* Pane */}
			<section
				className="flex-1 min-w-0 rounded-2xl border border-[rgba(139,92,246,0.15)] bg-[#160f2b]/80 p-5"
				aria-label="Selected settings section"
			>
				{flash && (
					<div className="mb-3">
						<SettingsBanner
							notification={{
								type: flash.type,
								message:
									flash.id === active
										? flash.message
										: `${flash.message} (${SETTINGS_DOMAINS.find((d) => d.id === flash.id)?.name ?? "settings"})`,
							}}
						/>
					</div>
				)}
				{notification && <SettingsBanner notification={notification} />}

				<header className="flex items-center gap-3 mb-4">
					<span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8b5cf6] border border-[rgba(139,92,246,0.3)] rounded px-1.5 py-0.5">
						{domain?.group ?? "Settings"}
					</span>
					<h3 className="text-lg font-semibold text-[#f1f5f9]">
						{domain?.name}
					</h3>
					{domain?.group === "Integrations" && (
						<span className="ml-auto text-xs">
							<LedLabel
								state={items.find((i) => i.id === active)?.state ?? "unknown"}
							/>
						</span>
					)}
				</header>

				{renderDomain(active, true)}
			</section>
		</div>
	);
}
