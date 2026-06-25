import { Gauge, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ZoneRange, ZonesResponse } from "@fit-analyzer/shared";
import { fetchZones } from "../lib/api";

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

function formatBound(value: number): string {
	return value === Number.POSITIVE_INFINITY
		? "+"
		: value === Number.NEGATIVE_INFINITY
			? "−"
			: String(value);
}

function ZoneList({
	zones,
	colors,
	unit,
}: {
	zones: ZoneRange[];
	colors: string[];
	unit: string;
}) {
	return (
		<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-0.5">
			{zones.map((z, i) => {
				const upper = z.upper;
				const range =
					upper === Number.POSITIVE_INFINITY
						? `${z.lower}${unit}+`
						: `${z.lower}–${upper}${unit}`;
				return (
					<div key={z.name} className="flex items-center gap-1.5 text-[11px]">
						<div
							className="w-2 h-2 rounded-sm shrink-0"
							style={{ background: colors[i % colors.length] }}
						/>
						<span className="text-[#7c6fa0] truncate">{z.name}</span>
						<span className="text-[#c4b5fd] tabular-nums ml-auto whitespace-nowrap">
							{range}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function ZoneBar({ zones, colors }: { zones: ZoneRange[]; colors: string[] }) {
	// Equal-width bands since these are zone definitions, not time distributions.
	return (
		<div className="flex h-3 w-full rounded-sm overflow-hidden">
			{zones.map((z, i) => (
				<div
					key={z.name}
					className="flex-1 min-w-[2px]"
					style={{ background: colors[i % colors.length] }}
					title={z.name}
				/>
			))}
		</div>
	);
}

function ZoneBlock({
	zones,
	colors,
	unit,
	title,
	reference,
}: {
	zones: ZoneRange[];
	colors: string[];
	unit: string;
	title: string;
	reference: string;
}) {
	if (zones.length === 0) return null;
	return (
		<div className="space-y-1.5 min-w-0">
			<div className="text-[10px] text-[#7c6fa0]">
				{title} · {reference}
			</div>
			<ZoneBar zones={zones} colors={colors} />
			<ZoneList zones={zones} colors={colors} unit={unit} />
		</div>
	);
}

export function ZonesCard() {
	const [zones, setZones] = useState<ZonesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
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
	}, []);

	const hasPower = zones != null && zones.powerZones.length > 0;
	const hasHr = zones != null && zones.hrZones.length > 0;
	const empty = zones != null && !hasPower && !hasHr;
	const showBody = !loading && !error && zones != null && !empty;

	return (
		<div className="p-4 bg-[#1a1533]/70 backdrop-blur-md border border-[rgba(139,92,246,0.1)] rounded-2xl hover:border-[rgba(139,92,246,0.2)] transition-[border-color] duration-200">
			<div className="flex flex-wrap items-start gap-x-6 gap-y-3">
				<div className="flex items-center gap-3 shrink-0">
					<div
						className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
						style={{ backgroundColor: "#8b5cf620" }}
					>
						<Gauge className="w-5 h-5" style={{ color: "#8b5cf6" }} />
					</div>
					<div className="min-w-0">
						<p className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
							Zones
						</p>
						{zones != null && zones.source !== "none" && (
							<p className="text-xs text-[#64748b]">
								{zones.source === "profile" ? "From profile" : "Estimated"}
							</p>
						)}
					</div>
				</div>

				{loading && (
					<div className="flex items-center gap-2 text-[#94a3b8] py-2">
						<Loader2 className="w-4 h-4 animate-spin" />
						<span className="text-sm">Loading zones...</span>
					</div>
				)}

				{error && <p className="text-sm text-[#fca5a5] py-2">{error}</p>}

				{empty && !loading && !error && (
					<p className="text-sm text-[#64748b] py-2">
						Set FTP and max HR in settings to see your zones.
					</p>
				)}

				{showBody && zones != null && (
					<div className="flex flex-col sm:flex-row gap-x-8 gap-y-3 flex-1 min-w-0">
						{hasPower && (
							<div className="flex-1 min-w-[220px]">
								<ZoneBlock
									zones={zones.powerZones}
									colors={POWER_ZONE_COLORS}
									unit="W"
									title="Power zones"
									reference={
										zones.ftp != null ? `FTP ${formatBound(zones.ftp)} W` : ""
									}
								/>
							</div>
						)}
						{hasHr && (
							<div className="flex-1 min-w-[220px]">
								<ZoneBlock
									zones={zones.hrZones}
									colors={HR_ZONE_COLORS}
									unit=" bpm"
									title="Heart rate zones"
									reference={
										zones.maxHr != null
											? `Max HR ${formatBound(zones.maxHr)} bpm`
											: ""
									}
								/>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
