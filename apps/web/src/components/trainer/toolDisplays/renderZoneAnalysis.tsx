import type { ReactNode } from "react";

interface ZoneAnalysisDisplay {
	activityId: string;
	date: string;
	ftp: number;
	maxHr: number;
	powerZones: Array<{ zone: string; seconds: number; percent: number }>;
	hrZones: Array<{ zone: string; seconds: number; percent: number }>;
}

const POWER_ZONE_COLORS = [
	"rgb(147,197,253)",
	"rgb(96,165,250)",
	"rgb(59,130,246)",
	"rgb(37,99,235)",
	"rgb(29,78,216)",
	"rgb(30,64,175)",
	"rgb(23,37,105)",
];

const HR_ZONE_COLORS = [
	"rgb(134,239,172)",
	"rgb(74,222,128)",
	"rgb(34,197,94)",
	"rgb(22,163,74)",
	"rgb(21,128,61)",
	"rgb(22,101,52)",
];

function formatSeconds(s: number): string {
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function StackedBar({
	zones,
	colors,
}: {
	zones: Array<{ zone: string; seconds: number; percent: number }>;
	colors: string[];
}) {
	return (
		<div className="flex h-3 w-full rounded-sm overflow-hidden">
			{zones.map((z, i) => {
				if (z.percent <= 0) return null;
				return (
					<div
						key={z.zone}
						className="relative group"
						style={{
							width: `${z.percent}%`,
							background: colors[i % colors.length],
							minWidth: z.percent > 0 ? "2px" : undefined,
						}}
					/>
				);
			})}
		</div>
	);
}

function ZoneRows({
	zones,
	colors,
}: {
	zones: Array<{ zone: string; seconds: number; percent: number }>;
	colors: string[];
}) {
	return (
		<div className="space-y-0.5">
			{zones.map((z, i) => (
				<div key={z.zone} className="flex items-center gap-1.5 text-[11px]">
					<div
						className="w-2 h-2 rounded-sm shrink-0"
						style={{ background: colors[i % colors.length] }}
					/>
					<span className="text-[#7c6fa0] w-20 truncate">{z.zone}</span>
					<span className="text-[#c4b5fd]">
						{formatSeconds(z.seconds)} ({z.percent}%)
					</span>
				</div>
			))}
		</div>
	);
}

export function renderZoneAnalysis(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as ZoneAnalysisDisplay;
	if (!Array.isArray(d.powerZones) && !Array.isArray(d.hrZones)) return null;

	return (
		<div className="space-y-2.5">
			{Array.isArray(d.powerZones) && d.powerZones.length > 0 && (
				<div className="space-y-1">
					<div className="text-[10px] text-[#7c6fa0]">
						Power zones (FTP: {d.ftp}W)
					</div>
					<StackedBar zones={d.powerZones} colors={POWER_ZONE_COLORS} />
					<ZoneRows zones={d.powerZones} colors={POWER_ZONE_COLORS} />
				</div>
			)}
			{Array.isArray(d.hrZones) && d.hrZones.length > 0 && (
				<div className="space-y-1">
					<div className="text-[10px] text-[#7c6fa0]">
						HR zones (Max HR: {d.maxHr} bpm)
					</div>
					<StackedBar zones={d.hrZones} colors={HR_ZONE_COLORS} />
					<ZoneRows zones={d.hrZones} colors={HR_ZONE_COLORS} />
				</div>
			)}
		</div>
	);
}
