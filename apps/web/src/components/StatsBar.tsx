import { useMemo } from "react";
import { useSpring, animated } from "@react-spring/web";
import { Zap, Heart, Gauge, Clock } from "lucide-react";
import type { ActivityRecord } from "@fit-analyzer/shared";
import { computeAverages } from "../lib/stats";
import { formatElapsedTime } from "../lib/formatters";

interface StatsBarProps {
	records: ActivityRecord[];
	selectionRange: [number, number] | null;
}

function StatItem({
	icon: Icon,
	label,
	value,
	color,
}: {
	icon: typeof Zap;
	label: string;
	value: string;
	color: string;
}) {
	const [spring, api] = useSpring(() => ({
		scale: 1,
		config: { friction: 22, tension: 300 },
	}));

	return (
		<animated.div
			className="flex items-center gap-2.5 select-none"
			style={spring}
			onPointerDown={() => api.start({ scale: 0.96, immediate: true })}
			onPointerUp={() => api.start({ scale: 1 })}
			onPointerLeave={() => api.start({ scale: 1 })}
		>
			<Icon className="w-4 h-4 shrink-0" style={{ color }} />
			<div>
				<p className="text-[10px] text-[#94a3b8] uppercase tracking-wider">
					{label}
				</p>
				<p className="text-sm font-bold text-[#f1f5f9]">{value}</p>
			</div>
		</animated.div>
	);
}

export function StatsBar({ records, selectionRange }: StatsBarProps) {
	const stats = useMemo(() => {
		if (!selectionRange) return null;
		const [start, end] = selectionRange;
		return computeAverages(records.slice(start, end + 1));
	}, [records, selectionRange]);

	if (!stats) return null;

	return (
		<div className="mx-6 mb-4 p-4 bg-[#1a1533]/80 backdrop-blur-md border border-[#8b5cf6]/20 rounded-2xl shadow-[0_0_30px_rgba(139,92,246,0.1)] animate-[fadeIn_0.3s_ease-out]">
			<p className="text-xs font-medium text-[#8b5cf6] uppercase tracking-wider mb-3">
				Selected Range
			</p>
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
				<StatItem
					icon={Clock}
					label="Duration"
					value={formatElapsedTime(stats.duration)}
					color="#a78bfa"
				/>
				<StatItem
					icon={Zap}
					label="Avg Power"
					value={stats.avgPower !== null ? `${stats.avgPower} W` : "N/A"}
					color="#8b5cf6"
				/>
				<StatItem
					icon={Heart}
					label="Avg HR"
					value={
						stats.avgHeartRate !== null ? `${stats.avgHeartRate} bpm` : "N/A"
					}
					color="#ef4444"
				/>
				<StatItem
					icon={Gauge}
					label="Avg Cadence"
					value={stats.avgCadence !== null ? `${stats.avgCadence} rpm` : "N/A"}
					color="#06b6d4"
				/>
			</div>
		</div>
	);
}
