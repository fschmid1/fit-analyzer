import type { LucideIcon } from "lucide-react";
import { useSpringScale } from "../lib/useGestureSpring";
import { animated } from "@react-spring/web";
import type { HealthMetricStatus } from "@fit-analyzer/shared";

interface GaugeRange {
	min: number;
	max: number;
	optimalMin: number;
	optimalMax: number;
}

const GAUGE_RANGES: Record<string, GaugeRange> = {
	respiratoryRate: { min: 8, max: 24, optimalMin: 12, optimalMax: 20 },
	spo2: { min: 90, max: 100, optimalMin: 95, optimalMax: 100 },
	temperature: { min: 35, max: 39, optimalMin: 36.0, optimalMax: 37.5 },
};

function getGaugePosition(value: number, range: GaugeRange): number {
	const clamped = Math.max(range.min, Math.min(range.max, value));
	return ((clamped - range.min) / (range.max - range.min)) * 100;
}

const STATUS_CONFIG: Record<
	HealthMetricStatus,
	{ label: string; color: string; iconBg: string }
> = {
	normal: { label: "Normal", color: "#4ade80", iconBg: "#4ade8020" },
	lower: { label: "Lower", color: "#60a5fa", iconBg: "#60a5fa20" },
	higher: { label: "Higher", color: "#60a5fa", iconBg: "#60a5fa20" },
	elevated: { label: "Elevated", color: "#ef4444", iconBg: "#ef444420" },
};

interface HealthMonitorCardProps {
	icon: LucideIcon;
	label: string;
	value: string | number;
	unit: string;
	status: HealthMetricStatus;
	gaugeType?: string;
	gaugeValue?: number | null;
}

export function HealthMonitorCard({
	icon: Icon,
	label,
	value,
	unit,
	status,
	gaugeType,
	gaugeValue,
}: HealthMonitorCardProps) {
	const pressGesture = useSpringScale({ scaleDown: 0.97 });
	const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.normal;
	const hasData = value !== "—";

	let gaugePos = 50;
	if (gaugeType && gaugeValue != null) {
		const range = GAUGE_RANGES[gaugeType];
		if (range) {
			gaugePos = getGaugePosition(gaugeValue, range);
		}
	}

	return (
		<animated.div
			{...pressGesture}
			className="relative flex items-center gap-4 p-4 bg-[#1a1f2e] border border-[rgba(255,255,255,0.06)] rounded-2xl overflow-hidden"
		>
			{/* Gauge bar on the right — only show if has data */}
			{hasData && (
				<div className="absolute right-3 top-3 bottom-3 w-1.5 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
					<div
						className="absolute w-full rounded-full transition-all duration-500"
						style={{
							height: `${Math.min(100, Math.max(15, gaugePos))}%`,
							bottom: 0,
							backgroundColor:
								status === "normal"
									? "#4ade8080"
									: status === "elevated"
										? "#ef444480"
										: "#60a5fa80",
						}}
					/>
					<div
						className="absolute w-2.5 h-2.5 -ml-[2px] rounded-full border-2 border-[#1a1f2e] shadow-sm transition-all duration-500"
						style={{
							bottom: `${Math.min(95, Math.max(5, gaugePos))}%`,
							backgroundColor: config.color,
						}}
					/>
				</div>
			)}

			<div className={`flex-1 min-w-0 ${hasData ? "pr-6" : ""}`}>
				<div className="flex items-center gap-2 mb-1">
					<div
						className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
						style={{ backgroundColor: hasData ? config.iconBg : "#64748b20" }}
					>
						<Icon
							className="w-3.5 h-3.5"
							style={{ color: hasData ? config.color : "#64748b" }}
						/>
					</div>
					<p className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
						{label}
					</p>
				</div>
				<div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
					<p
						className={`min-w-0 font-bold text-[#f1f5f9] ${
							hasData ? "text-3xl" : "text-2xl text-[#64748b]"
						}`}
					>
						{value}
					</p>
					{hasData && <p className="text-sm text-[#94a3b8]">{unit}</p>}
				</div>
				{hasData && (
					<div className="flex items-center gap-1.5 mt-1.5">
						<div
							className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
							style={{
								color: config.color,
								backgroundColor: config.iconBg,
							}}
						>
							<svg
								className="w-3 h-3"
								fill="none"
								viewBox="0 0 24 24"
								stroke={config.color}
								strokeWidth={2.5}
							>
								<title>{config.label}</title>
								{status === "normal" && (
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M5 13l4 4L19 7"
									/>
								)}
								{status === "elevated" && (
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								)}
								{(status === "lower" || status === "higher") && (
									<circle cx="12" cy="12" r="4" fill={config.color} />
								)}
							</svg>
							{config.label}
						</div>
					</div>
				)}
			</div>
		</animated.div>
	);
}
