import type { ReactNode } from "react";

interface PowerCurveDisplay {
	activityId: string;
	activityDate: string;
	durations: Array<{
		seconds: number;
		current: number | null;
		allTimeBest: number | null;
		percentOfBest: number | null;
	}>;
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = seconds / 60;
	if (m >= 1 && Number.isInteger(m)) return `${m}m`;
	return `${Math.floor(m)}m${seconds % 60 > 0 ? ` ${seconds % 60}s` : ""}`;
}

const BAR_COLORS = [
	"rgba(244,114,182,0.8)",
	"rgba(251,146,60,0.8)",
	"rgba(250,204,21,0.8)",
	"rgba(52,211,153,0.8)",
	"rgba(96,165,250,0.8)",
	"rgba(139,92,246,0.8)",
	"rgba(248,113,113,0.8)",
];

export function renderPowerCurve(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as PowerCurveDisplay;
	if (!Array.isArray(d.durations) || d.durations.length === 0) return null;

	const maxWatts = Math.max(
		...d.durations.map((dur) =>
			Math.max(dur.current ?? 0, dur.allTimeBest ?? 0),
		),
		1,
	);

	return (
		<div className="space-y-1.5">
			<div className="text-[10px] text-[#7c6fa0]">
				Power curve · {d.activityDate}
			</div>
			{d.durations.map((dur, i) => {
				const currentPct =
					dur.current != null ? (dur.current / maxWatts) * 100 : 0;
				const bestPct =
					dur.allTimeBest != null ? (dur.allTimeBest / maxWatts) * 100 : 0;
				return (
					<div
						key={dur.seconds}
						className="flex items-center gap-2 text-[11px]"
					>
						<span className="w-10 text-right text-[#7c6fa0] shrink-0">
							{formatDuration(dur.seconds)}
						</span>
						<div className="flex-1 relative h-3.5 bg-[#1a1533] rounded-sm overflow-hidden">
							{dur.allTimeBest != null && (
								<div
									className="absolute inset-y-0 left-0 rounded-sm border border-[rgba(139,92,246,0.3)]"
									style={{
										width: `${bestPct}%`,
										background: "rgba(139,92,246,0.15)",
									}}
								/>
							)}
							{dur.current != null && (
								<div
									className="absolute inset-y-0 left-0 rounded-sm"
									style={{
										width: `${currentPct}%`,
										background: BAR_COLORS[i % BAR_COLORS.length],
									}}
								/>
							)}
						</div>
						<span className="w-16 text-right text-[#c4b5fd] shrink-0">
							{dur.current != null ? `${dur.current}W` : "—"}
							{dur.percentOfBest != null && (
								<span className="text-[#7c6fa0]"> {dur.percentOfBest}%</span>
							)}
						</span>
					</div>
				);
			})}
		</div>
	);
}
