import type { ReactNode } from "react";

interface WorkoutGeneratorDisplay {
	focus: string;
	totalDuration: number;
	ftp: number;
	warmup: { duration: number; description: string } | null;
	intervals: Array<{
		description: string;
		duration: number;
		targetPower: number;
		targetPowerPercent: number;
		restDuration: number;
	}>;
	cooldown: { duration: number; description: string } | null;
}

function formatMinutes(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	if (s === 0) return `${m}m`;
	return `${m}m ${s}s`;
}

export function renderWorkoutGenerator(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as WorkoutGeneratorDisplay;
	if (!Array.isArray(d.intervals)) return null;

	const totalMin = Math.round(d.totalDuration / 60);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2 flex-wrap">
				<span className="text-[11px] font-semibold text-[#c4b5fd] capitalize">
					{d.focus?.replace(/_/g, " ")}
				</span>
				<span className="text-[10px] text-[#7c6fa0]">
					{totalMin}min · FTP {d.ftp}W
				</span>
			</div>
			{d.warmup && (
				<div className="text-[11px] text-[#7c6fa0]">
					Warmup: {formatMinutes(d.warmup.duration)} — {d.warmup.description}
				</div>
			)}
			<div className="space-y-0.5">
				{d.intervals.map((interval, i) => (
					<div
						key={`${interval.description}-${interval.duration}`}
						className="flex items-center gap-2 text-[11px]"
					>
						<span className="w-5 text-[#7c6fa0] shrink-0">{i + 1}.</span>
						<span className="text-[#c4b5fd] flex-1 truncate">
							{interval.description}
						</span>
						<span className="text-[#7c6fa0] shrink-0">
							{formatMinutes(interval.duration)} @ {interval.targetPower}W (
							{interval.targetPowerPercent}%)
						</span>
						{interval.restDuration > 0 && (
							<span className="text-[#4a4468] shrink-0">
								ri {formatMinutes(interval.restDuration)}
							</span>
						)}
					</div>
				))}
			</div>
			{d.cooldown && (
				<div className="text-[11px] text-[#7c6fa0]">
					Cooldown: {formatMinutes(d.cooldown.duration)} —{" "}
					{d.cooldown.description}
				</div>
			)}
		</div>
	);
}
