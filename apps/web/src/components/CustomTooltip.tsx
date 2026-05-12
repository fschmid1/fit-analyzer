import { memo } from "react";
import { formatElapsedTime } from "../lib/formatters";

interface TooltipPayloadEntry {
	color?: string;
	dataKey?: string;
	value?: number | null;
}

interface CustomTooltipProps {
	active?: boolean;
	label?: number | string;
	payload?: TooltipPayloadEntry[];
}

export const CustomTooltip = memo(function CustomTooltip({
	active,
	payload,
	label,
}: CustomTooltipProps) {
	if (!active || !payload || payload.length === 0) return null;
	const formattedLabel =
		typeof label === "number" ? formatElapsedTime(label) : formatElapsedTime(0);

	return (
		<div className="bg-[#1a1533]/95 backdrop-blur-xl border border-[rgba(139,92,246,0.2)] rounded-xl p-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
			<p className="text-xs text-[#94a3b8] mb-2 font-medium">
				{formattedLabel}
			</p>
			{payload.map(
				(entry) =>
					entry.value != null && (
						<div
							key={entry.dataKey ?? "unknown"}
							className="flex items-center gap-2 text-sm"
						>
							<div
								className="w-2 h-2 rounded-full"
								style={{ backgroundColor: entry.color ?? "#94a3b8" }}
							/>
							<span className="text-[#94a3b8] capitalize">
								{entry.dataKey === "heartRate"
									? "Heart Rate"
									: entry.dataKey === "gradient"
										? "Steigung"
										: entry.dataKey}
								:
							</span>
							<span className="font-semibold text-[#f1f5f9]">
								{entry.dataKey === "speed" || entry.dataKey === "gradient"
									? (Math.round(entry.value * 10) / 10).toFixed(1)
									: Math.round(entry.value)}
								<span className="text-xs text-[#94a3b8] ml-1">
									{entry.dataKey === "power"
										? "W"
										: entry.dataKey === "heartRate"
											? "bpm"
											: entry.dataKey === "speed"
												? "km/h"
												: entry.dataKey === "gradient"
													? "%"
													: "rpm"}
								</span>
							</span>
						</div>
					),
			)}
		</div>
	);
});
