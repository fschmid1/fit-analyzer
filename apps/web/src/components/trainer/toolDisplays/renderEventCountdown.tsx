import type { ReactNode } from "react";

interface EventCountdownDisplay {
	eventName: string;
	eventDate: string;
	daysRemaining: number;
	weeksRemaining: number;
	phase: string;
	phaseDescription: string;
}

const PHASE_COLORS: Record<string, string> = {
	Base: "text-blue-400",
	Build: "text-amber-400",
	Peak: "text-orange-400",
	Taper: "text-emerald-400",
	"Race week": "text-red-400",
	"Race complete": "text-[#7c6fa0]",
};

export function renderEventCountdown(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as EventCountdownDisplay;
	if (d.eventDate == null) return null;

	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-[11px] font-medium text-[#c4b5fd]">
					{d.eventName}
				</span>
				<span className="text-[10px] text-[#7c6fa0]">{d.eventDate}</span>
			</div>
			<div className="flex items-baseline gap-2">
				<span className="text-lg font-semibold text-[#f1f5f9]">
					{d.daysRemaining}
				</span>
				<span className="text-[11px] text-[#7c6fa0]">days</span>
				<span className="text-[11px] text-[#7c6fa0]">
					({d.weeksRemaining}w)
				</span>
			</div>
			<div>
				<span
					className={`text-[11px] font-semibold ${PHASE_COLORS[d.phase] ?? "text-[#c4b5fd]"}`}
				>
					{d.phase}
				</span>
				<span className="text-[10px] text-[#7c6fa0]">
					{" "}
					· {d.phaseDescription}
				</span>
			</div>
		</div>
	);
}
