import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SettingsDomainId } from "./integrationsStatus";
import {
	ledFrom,
	useIntegrationsStatus,
	type LedState,
} from "./integrationsStatus";
import { SETTINGS_DOMAINS } from "./domains";
import { SettingsBanner } from "./settingsShared";
import { useSettings } from "../../lib/settingsContext";

function StatusChip({ state }: { state: LedState }) {
	const cls =
		state === "ok"
			? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
			: state === "attention"
				? "text-amber-300 bg-amber-500/10 border-amber-500/20"
				: state === "off"
					? "text-[#94a3b8] bg-white/0 border-[rgba(139,92,246,0.2)]"
					: "text-[#4a4468] border-[rgba(139,92,246,0.15)]";
	const label =
		state === "ok"
			? "Connected"
			: state === "attention"
				? "Action needed"
				: state === "off"
					? "Off"
					: "—";
	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium shrink-0 ${cls}`}
		>
			<span
				aria-hidden="true"
				className={`w-1.5 h-1.5 rounded-full ${
					state === "ok"
						? "bg-emerald-400"
						: state === "attention"
							? "bg-amber-400"
							: "bg-current opacity-60"
				}`}
			/>
			{label}
		</span>
	);
}

/**
 * Mobile layout — no cards: every domain is one full-width status row —
 * name, blurb, status chip — that expands in place for its controls.
 * Optimized for "is everything on?" at a glance. Hidden at xl where the
 * Head Unit rail takes over.
 */
export function BoardVariant({
	renderDomain,
}: {
	renderDomain: (id: SettingsDomainId, dense?: boolean) => React.ReactNode;
}) {
	const [expanded, setExpanded] = useState<Set<SettingsDomainId>>(
		() => new Set(["profile"]),
	);
	const { strava, wahoo, calendar, hae, flash } = useIntegrationsStatus();
	const { data } = useSettings();

	const toggle = (id: SettingsDomainId) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const chipFor = (id: SettingsDomainId): LedState => {
		switch (id) {
			case "strava":
				return ledFrom(strava?.connected ?? null);
			case "wahoo":
				return ledFrom(wahoo?.connected ?? null);
			case "calendar":
				return ledFrom(calendar?.connected ?? null);
			case "hae":
				return ledFrom(hae?.configured ?? null);
			case "openwearables":
				return ledFrom(data?.openwearables.owUserId != null);
			case "waxed":
				return ledFrom(data?.waxedChainReminder.enabled ?? null);
			case "planRefresh":
				return ledFrom(data?.planRefresh.enabled ?? null);
			default:
				return "unknown";
		}
	};

	const groups = ["Integrations", "Coach", "Maintenance"] as const;

	return (
		<div className="flex flex-col gap-8 max-w-3xl xl:hidden">
			{groups.map((group) => (
				<section key={group} aria-label={group}>
					<div className="flex items-center gap-3 mb-1">
						<h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c6fa0]">
							{group}
						</h3>
						<span
							aria-hidden="true"
							className="flex-1 h-px bg-[rgba(139,92,246,0.12)]"
						/>
					</div>
					<ul className="divide-y divide-[rgba(139,92,246,0.08)]">
						{SETTINGS_DOMAINS.filter((d) => d.group === group).map((d) => {
							const isOpen = expanded.has(d.id);
							return (
								<li key={d.id}>
									<button
										type="button"
										aria-expanded={isOpen}
										onClick={() => toggle(d.id)}
										className="w-full flex items-center gap-4 py-3.5 text-left group cursor-pointer"
									>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium text-[#f1f5f9] group-hover:text-[#e2d9f3]">
												{d.name}
											</span>
											<span className="block text-xs text-[#64748b] mt-0.5">
												{d.blurb}
											</span>
										</span>
										{group === "Integrations" ? (
											<StatusChip state={chipFor(d.id)} />
										) : null}
										<ChevronDown
											aria-hidden="true"
											className={`w-4 h-4 text-[#7c6fa0] shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
										/>
									</button>
									{isOpen && (
										<div className="pb-4 pr-2">
											{flash && flash.id === d.id && (
												<div className="mb-3">
													<SettingsBanner notification={flash} />
												</div>
											)}
											{renderDomain(d.id, true)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}
