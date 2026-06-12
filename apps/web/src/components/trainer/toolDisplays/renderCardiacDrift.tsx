import type { ReactNode } from "react";

interface CardiacDriftBlock {
	startSeconds: number;
	endSeconds: number;
	duration: number;
	avgPower: number;
	powerVariance: number;
	firstHalfRatio: number;
	secondHalfRatio: number;
	driftPercent: number;
	interpretation: string;
}

interface CardiacDriftDisplay {
	activityId: string;
	blocks: CardiacDriftBlock[];
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

const DRIFT_COLORS: Record<string, string> = {
	excellent: "text-emerald-400",
	good: "text-blue-400",
	"moderate fatigue": "text-amber-400",
	"significant decoupling": "text-red-400",
};

export function renderCardiacDrift(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as CardiacDriftDisplay;
	if (!Array.isArray(d.blocks) || d.blocks.length === 0) return null;

	return (
		<div className="space-y-2">
			{d.blocks.map((block) => (
				<div
					key={`${block.startSeconds}-${block.endSeconds}`}
					className="space-y-0.5"
				>
					<div className="flex items-center gap-2 text-[11px]">
						<span className="text-[#7c6fa0]">
							{formatDuration(block.startSeconds)}–
							{formatDuration(block.endSeconds)}
						</span>
						<span className="text-[#c4b5fd]">
							{Math.round(block.duration / 60)}m effort
						</span>
						<span className="text-[#7c6fa0]">
							{Math.round(block.avgPower)}W
						</span>
					</div>
					<div className="flex items-center gap-2 text-[11px]">
						<span className="text-[#7c6fa0]">Drift:</span>
						<span
							className={`font-semibold ${DRIFT_COLORS[block.interpretation] ?? "text-[#c4b5fd]"}`}
						>
							{block.driftPercent > 0 ? "+" : ""}
							{block.driftPercent.toFixed(1)}%
						</span>
						<span className="text-[#7c6fa0]">({block.interpretation})</span>
					</div>
				</div>
			))}
		</div>
	);
}
