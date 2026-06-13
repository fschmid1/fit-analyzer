import type { ReactNode } from "react";

interface ActivityLookupDisplay {
	id: string;
	date: string;
	summary: {
		totalTimerTime: number;
		totalDistanceKm: number | null;
		avgPower: number | null;
		normalizedPower: number | null;
		maxPower: number | null;
		avgHeartRate: number | null;
		maxHeartRate: number | null;
		avgCadence: number | null;
		totalWork: number | null;
	};
	peakPowers: {
		peak5s: number | null;
		peak30s: number | null;
		peak1min: number | null;
		peak5min: number | null;
		peak10min: number | null;
		peak20min: number | null;
		peak60min: number | null;
	};
	intervals: Array<{
		index: number;
		duration: number;
		avgPower: number | null;
	}>;
}

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function renderActivityLookup(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as ActivityLookupDisplay;
	if (!d.summary) return null;

	const s = d.summary;
	const p = d.peakPowers;

	return (
		<div className="space-y-2">
			<div className="text-[10px] text-[#7c6fa0]">Activity · {d.date}</div>
			<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
				{s.totalTimerTime > 0 && (
					<div>
						<span className="text-[#7c6fa0]">Duration </span>
						<span className="text-[#c4b5fd]">
							{formatDuration(s.totalTimerTime)}
						</span>
					</div>
				)}
				{s.totalDistanceKm != null && (
					<div>
						<span className="text-[#7c6fa0]">Distance </span>
						<span className="text-[#c4b5fd]">{s.totalDistanceKm} km</span>
					</div>
				)}
				{s.avgPower != null && (
					<div>
						<span className="text-[#7c6fa0]">Avg Power </span>
						<span className="text-[#c4b5fd]">{s.avgPower}W</span>
					</div>
				)}
				{s.normalizedPower != null && (
					<div>
						<span className="text-[#7c6fa0]">NP </span>
						<span className="text-[#c4b5fd]">{s.normalizedPower}W</span>
					</div>
				)}
				{s.avgHeartRate != null && (
					<div>
						<span className="text-[#7c6fa0]">Avg HR </span>
						<span className="text-[#c4b5fd]">{s.avgHeartRate} bpm</span>
					</div>
				)}
			</div>
			{p && (
				<div className="text-[11px]">
					<span className="text-[#7c6fa0]">Peak: </span>
					<span className="text-[#c4b5fd]">
						{[
							p.peak5s != null && `5s=${p.peak5s}W`,
							p.peak1min != null && `1m=${p.peak1min}W`,
							p.peak5min != null && `5m=${p.peak5min}W`,
							p.peak20min != null && `20m=${p.peak20min}W`,
							p.peak60min != null && `60m=${p.peak60min}W`,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</div>
			)}
			{Array.isArray(d.intervals) && d.intervals.length > 0 && (
				<div className="text-[11px]">
					<span className="text-[#7c6fa0]">
						{d.intervals.length} interval{d.intervals.length !== 1 ? "s" : ""}
					</span>
					{d.intervals.length <= 5 && (
						<span className="text-[#c4b5fd]">
							{" "}
							·{" "}
							{d.intervals
								.map(
									(i) =>
										`#${i.index} ${Math.round(i.duration)}s@${i.avgPower ?? "?"}W`,
								)
								.join(" ")}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
