import {
	Zap,
	Heart,
	Gauge,
	Clock,
	TrendingUp,
	Flame,
	Route,
} from "lucide-react";
import { MetricCard } from "./MetricCard";
import { formatElapsedTime } from "../lib/formatters";
import type { ActivitySummary } from "@fit-analyzer/shared";

interface SummaryCardsProps {
	summary: ActivitySummary;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
	const cards = [
		{
			icon: Clock,
			label: "Duration",
			value: formatElapsedTime(summary.totalTimerTime),
			unit: "",
			color: "#a78bfa",
		},
		{
			icon: Route,
			label: "Distance",
			value: summary.totalDistanceKm ?? "N/A",
			unit: summary.totalDistanceKm !== null ? "km" : "",
			color: "#22c55e",
		},
		{
			icon: Zap,
			label: "Avg Power",
			value: summary.avgPower ?? "N/A",
			unit: summary.avgPower !== null ? "W" : "",
			subValue:
				summary.maxPower !== null ? `Max: ${summary.maxPower} W` : undefined,
			color: "#8b5cf6",
		},
		{
			icon: Heart,
			label: "Avg Heart Rate",
			value: summary.avgHeartRate ?? "N/A",
			unit: summary.avgHeartRate !== null ? "bpm" : "",
			subValue:
				summary.maxHeartRate !== null
					? `Max: ${summary.maxHeartRate} bpm`
					: undefined,
			color: "#ef4444",
		},
		{
			icon: Gauge,
			label: "Avg Cadence",
			value: summary.avgCadence ?? "N/A",
			unit: summary.avgCadence !== null ? "rpm" : "",
			color: "#06b6d4",
		},
		{
			icon: TrendingUp,
			label: "Peak 1min Power",
			value: summary.peak1minPower ?? "N/A",
			unit: summary.peak1minPower !== null ? "W" : "",
			color: "#f59e0b",
		},
		{
			icon: TrendingUp,
			label: "Peak 5min Power",
			value: summary.peak5minPower ?? "N/A",
			unit: summary.peak5minPower !== null ? "W" : "",
			color: "#f97316",
		},
		{
			icon: Flame,
			label: "Total Work",
			value:
				summary.totalWork !== null
					? Math.round(summary.totalWork / 1000)
					: "N/A",
			unit: summary.totalWork !== null ? "kJ" : "",
			color: "#ec4899",
		},
	];

	return (
		<div className="px-6 pb-6">
			<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
				{cards.map((card) => (
					<MetricCard key={card.label} {...card} />
				))}
			</div>
		</div>
	);
}
