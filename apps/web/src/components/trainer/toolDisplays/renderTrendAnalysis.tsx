import type { ReactNode } from "react";
import { sparklinePath } from "./sparklineUtils";

interface TrendAnalysisDisplay {
	metric: string;
	dates: string[];
	values: number[];
	rollingAvg: number[];
	trend: {
		slope: number;
		direction: string;
		r2: number;
		changePerWeek: number;
	};
}

const DIRECTION_ARROW: Record<string, string> = {
	improving: "\u2191",
	declining: "\u2193",
	stable: "\u2192",
};

export function renderTrendAnalysis(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as TrendAnalysisDisplay;
	if (!Array.isArray(d.values) || d.values.length === 0 || !d.trend)
		return null;

	const width = 200;
	const height = 40;
	const direction = d.trend.direction ?? "stable";

	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-[11px] font-medium text-[#c4b5fd]">
					{d.metric}
				</span>
				<span className="text-[11px]">
					{DIRECTION_ARROW[direction] ?? "\u2192"}{" "}
					<span className="text-emerald-400">{direction}</span>
				</span>
			</div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className="w-full max-w-[220px] h-auto"
				style={{ display: "block" }}
				role="img"
				aria-label="Trend sparkline"
			>
				{sparklinePath(d.values, width, height) && (
					<path
						d={sparklinePath(d.values, width, height)}
						fill="none"
						stroke="rgba(139,92,246,0.7)"
						strokeWidth="1.5"
					/>
				)}
				{Array.isArray(d.rollingAvg) &&
					d.rollingAvg.length >= 2 &&
					sparklinePath(d.rollingAvg, width, height) && (
						<path
							d={sparklinePath(d.rollingAvg, width, height)}
							fill="none"
							stroke="rgba(52,211,153,0.8)"
							strokeWidth="1.5"
							strokeDasharray="3 2"
						/>
					)}
			</svg>
			<div className="text-[10px] text-[#7c6fa0]">
				R\u00B2 = {d.trend.r2.toFixed(2)} ·{" "}
				{d.trend.changePerWeek > 0 ? "+" : ""}
				{d.trend.changePerWeek.toFixed(1)}/week
			</div>
		</div>
	);
}
