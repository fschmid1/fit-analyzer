import type { ReactNode } from "react";
import { formatZoneRange, type ZoneRange } from "@fit-analyzer/shared";

interface SetZonesDisplay {
	powerZones: ZoneRange[];
	hrZones: ZoneRange[];
	powerZonesOverridden: boolean;
	hrZonesOverridden: boolean;
}

export function renderSetZones(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as SetZonesDisplay;
	if (!Array.isArray(d.powerZones) && !Array.isArray(d.hrZones)) return null;

	return (
		<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
			{Array.isArray(d.powerZones) && d.powerZones.length > 0 && (
				<span className="text-[10px] text-[#7c6fa0]">Power:</span>
			)}
			{d.powerZones.map((z) => (
				<span
					key={`p-${z.name}`}
					className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20"
				>
					{z.name}: {formatZoneRange(z, "W")}
				</span>
			))}
			{Array.isArray(d.hrZones) && d.hrZones.length > 0 && (
				<span className="text-[10px] text-[#7c6fa0] ml-1">HR:</span>
			)}
			{d.hrZones.map((z) => (
				<span
					key={`h-${z.name}`}
					className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
				>
					{z.name}: {formatZoneRange(z, " bpm")}
				</span>
			))}
		</div>
	);
}

export function renderResetZones(_display: unknown): ReactNode | null {
	return (
		<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
			<span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
				Zones reset to derived defaults
			</span>
		</div>
	);
}
