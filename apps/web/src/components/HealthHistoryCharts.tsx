import { useMemo, useState } from "react";
import {
	ResponsiveContainer,
	AreaChart,
	Area,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
} from "recharts";
import {
	Wind,
	Heart,
	Activity,
	Droplets,
	Thermometer,
	Moon,
	Sunrise,
	Brain,
} from "lucide-react";
import type { HealthHistoryEntry } from "@fit-analyzer/shared";
import type { LucideIcon } from "lucide-react";

interface MetricConfig {
	key: keyof Omit<HealthHistoryEntry, "date">;
	label: string;
	unit: string;
	color: string;
	icon: LucideIcon;
	step?: number;
}

const METRICS: MetricConfig[] = [
	{ key: "rhr", label: "RHR", unit: "bpm", color: "#ef4444", icon: Heart },
	{ key: "hrv", label: "HRV", unit: "ms", color: "#8b5cf6", icon: Activity },
	{
		key: "respiratoryRate",
		label: "RR",
		unit: "rpm",
		color: "#06b6d4",
		icon: Wind,
	},
	{ key: "spo2", label: "SpO2", unit: "%", color: "#22c55e", icon: Droplets },
	{
		key: "temperature",
		label: "Temp",
		unit: "°C",
		color: "#f59e0b",
		icon: Thermometer,
	},
	{
		key: "morningHeartRate",
		label: "Morning HR",
		unit: "bpm",
		color: "#f97316",
		icon: Sunrise,
	},
	{
		key: "sleepDurationMinutes",
		label: "Sleep",
		unit: "min",
		color: "#a855f7",
		icon: Moon,
	},
	{
		key: "sleepEfficiencyPercent",
		label: "Sleep Eff.",
		unit: "%",
		color: "#a855f7",
		icon: Brain,
	},
];

function formatDateLabel(dateStr: string): string {
	const [y, m, d] = dateStr.split("-");
	return `${d}.${m}.${y.slice(2)}`;
}

function TooltipRow({
	color,
	label,
	value,
	unit,
	icon: Icon,
}: {
	color: string;
	label: string;
	value: number;
	unit: string;
	icon: LucideIcon;
}) {
	return (
		<div className="flex items-center gap-2 py-0.5">
			<Icon className="w-3 h-3 shrink-0" style={{ color }} />
			<span className="text-[#94a3b8] text-xs">{label}:</span>
			<span className="text-[#f1f5f9] text-xs font-semibold">
				{value}
				{unit}
			</span>
		</div>
	);
}

function CustomTooltipContent({
	active,
	payload,
	label,
}: {
	active?: boolean;
	payload?: Array<{
		value: number | null;
		name: string;
		color: string;
	}>;
	label?: string;
}) {
	if (!active || !payload || payload.length === 0) return null;

	const valid = payload
		.map((p) => {
			const config = METRICS.find((m) => m.label === p.name);
			if (!config || p.value == null) return null;
			return {
				config,
				value: p.value,
				color: p.color,
			};
		})
		.filter((p): p is { config: MetricConfig; value: number; color: string } => p !== null);

	if (valid.length === 0) return null;

	return (
		<div className="bg-[#1a1f2e] border border-[rgba(139,92,246,0.2)] rounded-xl px-3 py-2 shadow-lg">
			<p className="text-[#f1f5f9] text-xs font-semibold mb-1">
				{formatDateLabel(label ?? "")}
			</p>
			{valid.map((v) => {
				if (v.value == null) return null;
				return (
					<TooltipRow
						key={v.config.key}
						color={v.color}
						label={v.config.label}
						value={v.value}
						unit={v.config.unit}
						icon={v.config.icon}
					/>
				);
			})}
		</div>
	);
}

interface HealthHistoryChartsProps {
	history: HealthHistoryEntry[];
}

export function HealthHistoryCharts({ history }: HealthHistoryChartsProps) {
	const [selectedKey, setSelectedKey] = useState<MetricConfig["key"]>("rhr");

	const chartData = useMemo(() => {
		return history.map((h) => ({
			date: h.date,
			rhr: h.rhr,
			hrv: h.hrv,
			respiratoryRate: h.respiratoryRate,
			spo2: h.spo2,
			temperature: h.temperature,
			morningHeartRate: h.morningHeartRate,
			sleepDurationMinutes: h.sleepDurationMinutes,
			sleepEfficiencyPercent: h.sleepEfficiencyPercent,
			deepMinutes: h.deepMinutes,
			remMinutes: h.remMinutes,
		}));
	}, [history]);

	const activeMetric = METRICS.find((m) => m.key === selectedKey);
	if (!activeMetric) return null;

	const hasData = chartData.some((d) => d[selectedKey] != null);

	return (
		<div className="mt-8">
			<div className="flex items-center gap-2 mb-4 flex-wrap">
				{METRICS.map((metric) => {
					const Icon = metric.icon;
					const active = selectedKey === metric.key;
					return (
						<button
							type="button"
							key={metric.key}
							onClick={() => setSelectedKey(metric.key)}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
								active
									? "bg-[#1a1533]/70 text-[#f1f5f9] border-[rgba(139,92,246,0.3)]"
									: "bg-[#1a1533]/40 text-[#94a3b8] border-[rgba(139,92,246,0.1)] hover:text-[#f1f5f9]"
							}`}
						>
							<Icon
								className="w-3 h-3"
								style={{ color: active ? metric.color : undefined }}
							/>
							{metric.label}
						</button>
					);
				})}
			</div>

			{!hasData ? (
				<div className="flex items-center justify-center h-64 text-sm text-[#94a3b8]">
					No historical data available for this metric.
				</div>
			) : (
				<div className="bg-[#1a1533]/40 border border-[rgba(139,92,246,0.1)] rounded-2xl p-4">
					<h4
						className="text-sm font-semibold mb-4"
						style={{ color: activeMetric.color }}
					>
						{activeMetric.label} History
					</h4>
					<ResponsiveContainer width="100%" height={300}>
						<AreaChart
							data={chartData}
							margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
						>
							<defs>
								<linearGradient
									id={`grad-${activeMetric.key}`}
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop
										offset="0%"
										stopColor={activeMetric.color}
										stopOpacity={0.25}
									/>
									<stop
										offset="100%"
										stopColor={activeMetric.color}
										stopOpacity={0.02}
									/>
								</linearGradient>
							</defs>
							<CartesianGrid
								strokeDasharray="3 3"
								stroke="rgba(139, 92, 246, 0.06)"
								vertical={false}
							/>
							<XAxis
								dataKey="date"
								tickFormatter={formatDateLabel}
								stroke="#94a3b8"
								tick={{ fill: "#94a3b8", fontSize: 11 }}
								axisLine={{ stroke: "rgba(148,163,184,0.2)" }}
								tickLine={false}
								interval="preserveStartEnd"
								minTickGap={40}
							/>
							<YAxis
								stroke="#94a3b8"
								tick={{ fill: "#94a3b8", fontSize: 11 }}
								axisLine={{ stroke: "rgba(148,163,184,0.2)" }}
								tickLine={false}
								width={45}
							/>
							<Tooltip content={<CustomTooltipContent />} />
							<Area
								type="monotone"
								dataKey={activeMetric.key}
								name={activeMetric.label}
								stroke={activeMetric.color}
								strokeWidth={2}
								fill={`url(#grad-${activeMetric.key})`}
								connectNulls
								isAnimationActive={false}
								dot={false}
								activeDot={{
									r: 4,
									stroke: "#1a1f2e",
									strokeWidth: 2,
									fill: activeMetric.color,
								}}
							/>
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}
